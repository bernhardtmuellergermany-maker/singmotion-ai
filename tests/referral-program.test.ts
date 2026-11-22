import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {CommerceStore} from "../lib/commerce/store.ts";
import {CreditWallet} from "../lib/commerce/credit-wallet.ts";
import {ReferralProgram,ReferralError} from "../lib/commerce/referral-program.ts";
import {auditCreditLedger} from "../lib/commerce/credit-ledger-integrity.ts";

function fixture(){
 const root=mkdtempSync(path.join(tmpdir(),"sm-referral-"));
 const store=new CommerceStore(path.join(root,"commerce.sqlite"),{});
 const wallet=new CreditWallet(store.db);
 const referral=new ReferralProgram(store.db);
 const create=(name:string,code?:string)=>{
  const id=store.register(name+"@example.test","sample-secure-pass-123",code);
  store.db.prepare("UPDATE customer_email_verifications SET verified_at=? WHERE account_id=?").run(Date.now(),id);
  return id;
 };
 const enable=(changes:Partial<ReturnType<ReferralProgram["settings"]>>={})=>
  referral.saveSettings({...referral.settings(),...changes,enabled:true},"admin");
 const purchase=(customerId:string,credits=500,when=Date.now(),status:"paid"|"reversed"="paid")=>{
  const id=randomUUID(),subject="customer:"+customerId;
  const email=store.db.prepare("SELECT email FROM customer_accounts WHERE id=?").get(customerId) as {email:string};
  store.db.prepare("INSERT INTO credit_topup_purchases(id,subject,email,credits,cents,status,request_key,stripe_session_id,created,paid_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
   .run(id,subject,email.email,credits,credits,status,randomUUID(),"cs_test_"+id.replaceAll("-",""),when,when);
  if(status==="paid")
   store.db.prepare("INSERT INTO credit_wallet_ledger(id,subject,delta,kind,reference,created) VALUES(?,?,?,?,?,?)")
    .run("credit-topup:"+id,subject,credits,"purchase","credit-topup:"+id,when);
  return id;
 };
 return {store,wallet,referral,create,enable,purchase,close(){
  store.close();rmSync(root,{recursive:true,force:true});
 }};
}
test("off by default: no invitation, no attribution, no bonus on first real purchase",()=>{
 const f=fixture();try{
  assert.equal(f.referral.settings().enabled,false);
  const owner=f.create("owner");
  assert.deepEqual(f.referral.customerView(owner),{enabled:false});
  const friend=f.create("friend","not-a-valid-ref");
  f.purchase(friend);
  assert.deepEqual(f.referral.reconcile(),{queued:0,awarded:0,cancelled:0,review:0});
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM referral_rewards").get()!.n,0);
 }finally{f.close();}
});
test("only newly created, verified accounts can bind the link; existing Google/password account cannot be claimed",()=>{
 const f=fixture();try{
  const a=f.create("owner");f.enable();
  const view=f.referral.customerView(a) as {code:string};
  assert.match(view.code,/^[A-Za-z0-9_-]{16}$/);
  assert.equal(f.referral.accepts(view.code),true);
  assert.equal(f.referral.accepts("unknown-invalid-code"),false);
  const friend=f.create("friend",view.code);
  assert.equal(f.store.db.prepare("SELECT referrer_id FROM referral_attributions WHERE referred_id=?").get(friend)!.referrer_id,a);
  assert.equal(f.referral.bindNewCustomer(friend,view.code),false);
  assert.equal(f.referral.bindNewCustomer(a,view.code),false);
  f.referral.saveSettings({...f.referral.settings(),enabled:false},"admin");
  assert.equal(f.referral.accepts(view.code),false);
  assert.equal(f.referral.customerView(a).enabled,false);
 }finally{f.close();}
});
test("first verified paid purchase creates a delayed one-time dual bonus with ledger audit",()=>{
 const f=fixture();try{
  const owner=f.create("owner");f.enable();
  const code=(f.referral.customerView(owner) as {code:string}).code;
  const friend=f.create("friend",code);
  const now=Date.now(),id=f.purchase(friend,500,now);
  assert.deepEqual(f.referral.reconcile(now+60000),{queued:1,awarded:0,cancelled:0,review:0});
  assert.equal(f.referral.reconcile(now+7*86400000).awarded,0);
  assert.equal(f.referral.reconcile(now+15*86400000).awarded,1);
  assert.equal(f.wallet.total("customer:"+owner),125);
  assert.equal(f.wallet.total("customer:"+friend),600);
  assert.deepEqual(f.referral.reconcile(now+16*86400000),{queued:0,awarded:0,cancelled:0,review:0});
  const entries=f.store.db.prepare("SELECT COUNT(*) n FROM credit_wallet_ledger WHERE kind='referral-bonus'").get() as {n:number};
  assert.equal(entries.n,2);
  assert.equal(f.store.db.prepare("SELECT status FROM referral_rewards WHERE purchase_id=?").get(id)!.status,"awarded");
  assert.equal(auditCreditLedger(f.store.db).ok,true);
  const customerView=JSON.stringify(f.referral.customerView(owner));
  assert.equal(customerView.includes("friend@example.test"),false);
  assert.equal(customerView.includes(friend),false);
 }finally{f.close();}
});
test("pending refund before award is cancelled with zero bonus, even after retry",()=>{
 const f=fixture();try{
  const owner=f.create("owner");f.enable();const friend=f.create("friend",(f.referral.customerView(owner) as {code:string}).code);
  const now=Date.now(),id=f.purchase(friend);
  assert.equal(f.referral.reconcile(now).queued,1);
  f.store.db.prepare("UPDATE credit_topup_purchases SET status='reversed' WHERE id=?").run(id);
  assert.equal(f.referral.reconcile(now+15*86400000).cancelled,1);
  assert.equal(f.referral.reconcile(now+16*86400000).awarded,0);
  assert.equal(f.wallet.total("customer:"+owner),0);
  assert.equal(f.store.db.prepare("SELECT status FROM referral_rewards WHERE purchase_id=?").get(id)!.status,"cancelled");
 }finally{f.close();}
});
test("after payout a chargeback is flagged for human review, not silently debited",()=>{
 const f=fixture();try{
  const owner=f.create("owner");f.enable();const friend=f.create("friend",(f.referral.customerView(owner) as {code:string}).code);
  const now=Date.now(),id=f.purchase(friend);
  f.referral.reconcile(now);f.referral.reconcile(now+15*86400000);
  f.store.db.prepare("UPDATE credit_topup_purchases SET status='reversed' WHERE id=?").run(id);
  assert.equal(f.referral.reconcile(now+16*86400000).review,1);
  assert.equal(f.referral.reconcile(now+17*86400000).review,0);
  assert.equal(f.wallet.total("customer:"+owner),125);
  assert.equal((f.referral.customerView(owner) as {earnedCredits:number}).earnedCredits,125);
  assert.equal(f.store.db.prepare("SELECT status FROM referral_rewards WHERE purchase_id=?").get(id)!.status,"review");
 }finally{f.close();}
});
test("admin may adjust both rewards; old pending commitments retain their amounts after campaign pause",()=>{
 const f=fixture();try{
  const owner=f.create("owner");f.enable({referrerCredits:70,friendCredits:20,holdDays:1,maxTotalCredits:300});
  const code=(f.referral.customerView(owner) as {code:string}).code;
  const friend=f.create("friend",code);
  const now=Date.now(),id=f.purchase(friend);
  assert.equal(f.referral.reconcile(now).queued,1);
  const old=f.referral.settings();
  assert.throws(()=>f.referral.saveSettings({...old,revision:old.revision-1},"admin"),ReferralError);
  f.referral.saveSettings({...old,enabled:false,referrerCredits:200,friendCredits:0},"admin");
  assert.equal(f.referral.reconcile(now+2*86400000).awarded,1);
  const award=f.store.db.prepare("SELECT referrer_credits,friend_credits FROM referral_rewards WHERE purchase_id=?").get(id) as {referrer_credits:number;friend_credits:number};
  assert.deepEqual([award.referrer_credits,award.friend_credits],[70,20]);
  assert.equal(f.wallet.total("customer:"+owner),70);
 }finally{f.close();}
});
test("no second bonus after an earlier paid purchase, and per-referrer budget caps are atomic",()=>{
 const f=fixture();try{
  const owner=f.create("owner");f.enable({maxPerReferrer:1,maxTotalCredits:225});
  const code=(f.referral.customerView(owner) as {code:string}).code;
  const first=f.create("friend",code),second=f.create("friend2",code);
  const t=Date.now();
  const old=f.purchase(first,500,t-3600000);
  f.purchase(first,500,t);
  f.purchase(second,500,t+1000);
  assert.equal(f.referral.reconcile(t+2000).queued,1);
  assert.equal(f.store.db.prepare("SELECT purchase_id FROM referral_rewards").get()!.purchase_id,old);
  assert.equal(f.referral.adminStats()!.committedCredits,225);
  assert.equal(f.referral.reconcile(t+15*86400000).awarded,1);
  assert.equal(f.wallet.total("customer:"+second),500);
 }finally{f.close();}
});
test("unverified or deleted referrer cannot obtain automatic credit rewards",()=>{
 const f=fixture();try{
  const owner=f.create("owner");f.enable();
  const code=(f.referral.customerView(owner) as {code:string}).code;
  f.store.db.prepare("UPDATE customer_email_verifications SET verified_at=NULL WHERE account_id=?").run(owner);
  assert.equal(f.referral.customerView(owner).enabled,false);
  const friend=f.create("friend",code);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM referral_attributions WHERE referred_id=?").get(friend)!.n,0);
  f.purchase(friend);
  assert.equal(f.referral.reconcile().queued,0);
 }finally{f.close();}
});

test("Google OAuth creates attribution only for a genuinely new verified identity",()=>{
 const f=fixture();try{
  const referrer=f.create("owner");f.enable();
  const code=(f.referral.customerView(referrer) as {code:string}).code;
  const newcomer=f.store.googleLogin("1234567890123","new-google@example.test",code);
  assert.equal(f.store.db.prepare("SELECT referrer_id FROM referral_attributions WHERE referred_id=?").get(newcomer.id)!.referrer_id,referrer);
  assert.equal(f.store.emailVerified(newcomer.id),true);
  const second=f.create("other");
  const otherCode=(f.referral.customerView(second) as {code:string}).code;
  const returning=f.store.googleLogin("1234567890123","new-google@example.test",otherCode);
  assert.equal(returning.id,newcomer.id);
  assert.equal(f.store.db.prepare("SELECT referrer_id FROM referral_attributions WHERE referred_id=?").get(newcomer.id)!.referrer_id,referrer);
 }finally{f.close();}
});
