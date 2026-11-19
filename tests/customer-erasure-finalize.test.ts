import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import path from "node:path";
import {tmpdir} from "node:os";
import {CommerceStore} from "../lib/commerce/store.ts";
import {CreditWallet} from "../lib/commerce/credit-wallet.ts";
import {ensureDeletionRefundIntents} from "../lib/commerce/customer-erasure-refund-intents.ts";
import {finalizeErasedCustomerData,AccountErasureFinalizationBlocked} from "../lib/commerce/customer-erasure-finalize.ts";

const pass="safe-cleanup-test-password";
const valid=(row:unknown)=>Boolean(row);
function fixture(fn:(s:CommerceStore,id:string,other:string)=>void){
 const root=mkdtempSync(path.join(tmpdir(),"sm-erasure-final-"));
 const store=new CommerceStore(path.join(root,"commerce.sqlite"),{CUSTOMER_BETA_WELCOME_CREDITS_ENABLED:"false"});
 const id=store.register("one@example.test",pass),other=store.register("other@example.test",pass);
 store.db.prepare("INSERT INTO customer_erasure_jobs(account_id,token_hash,state,created_at,updated_at) VALUES(?,?,'removing-data',?,?)")
  .run(id,"frozen-token",Date.now(),Date.now());
 try{fn(store,id,other)}finally{store.close();rmSync(root,{recursive:true,force:true})}
}
test("identity and all login sessions are removed, unrelated customers remain",()=>{
 fixture((store,id,other)=>{
  const token=store.login("one@example.test",pass);
  assert.equal(store.session(token),id);
  assert.equal(finalizeErasedCustomerData(store,id),true);
  assert.equal(finalizeErasedCustomerData(store,id),true);
  assert.equal(store.db.prepare("SELECT 1 FROM customer_accounts WHERE id=?").get(id),undefined);
  assert.equal(store.session(token),null);
  assert.ok(store.db.prepare("SELECT 1 FROM customer_accounts WHERE id=?").get(other));
  assert.equal(store.db.prepare("SELECT state FROM customer_erasure_jobs WHERE account_id=?").get(id)?.state,"completed");
 });
});
test("paid Credits are not erased before a verified refund",()=>{
 fixture((store,id)=>{
  new CreditWallet(store.db);
  const subject="customer:"+id,purchaseId="22222222-2222-4222-8222-222222222222";
  const sessionId="cs_test_123456789";
  store.db.prepare("INSERT INTO credit_topup_purchases(id,subject,email,credits,cents,status,request_key,stripe_session_id,created) VALUES(?,?,?,1000,1000,'paid',?,?,1)")
   .run(purchaseId,subject,"one@example.test","request-paid",sessionId);
  store.db.prepare("INSERT INTO credit_wallet_ledger VALUES(?,?,?,?,?,1)").run(
   "credit-topup:"+purchaseId,subject,1000,"purchase","credit-topup:"+purchaseId);
  assert.throws(()=>finalizeErasedCustomerData(store,id),
   (e:unknown)=>e instanceof AccountErasureFinalizationBlocked&&e.code==="MISSING_REFUND_EVIDENCE");
  assert.ok(store.db.prepare("SELECT 1 FROM customer_accounts WHERE id=?").get(id));
  ensureDeletionRefundIntents(store.db);
  store.db.prepare("INSERT INTO customer_erasure_refund_intents VALUES(?,?,?,1000,1000,'pending',NULL,NULL,1,1)")
   .run(purchaseId,id,sessionId);
  assert.throws(()=>finalizeErasedCustomerData(store,id),
   (e:unknown)=>e instanceof AccountErasureFinalizationBlocked&&e.code==="UNSETTLED_REFUND");
  store.db.prepare("UPDATE customer_erasure_refund_intents SET state='succeeded',refund_id='re_123abc'").run();
  assert.equal(finalizeErasedCustomerData(store,id),true);
  assert.equal(store.db.prepare("SELECT 1 FROM customer_accounts WHERE id=?").get(id),undefined);
  const purchase=store.db.prepare("SELECT email,subject,cents FROM credit_topup_purchases WHERE id=?").get(purchaseId) as {email:string;subject:string;cents:number};
  assert.equal(purchase.email,"deleted-account@singmotion.invalid");
  assert.equal(purchase.subject,"erased:"+id);
  assert.equal(purchase.cents,1000);
  assert.equal(store.db.prepare("SELECT subject FROM credit_wallet_ledger WHERE kind='purchase'").get()?.subject,"erased:"+id);
  assert.equal(store.db.prepare("SELECT state FROM customer_erasure_refund_intents WHERE purchase_id=?").get(purchaseId)?.state,"succeeded");
 });
});
test("paid video order loses customer email, guest secret and raw prompt but retains price",()=>{
 fixture((store,id)=>{
  store.db.prepare("INSERT INTO customer_orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(
   "paid-1",id,"private-guest-secret",123456,"one@example.test","project-private",499,
   "eur","paid",JSON.stringify({prompt:"PRIVATE PHOTO DATA"}),"req-paid-1",1);
  assert.equal(finalizeErasedCustomerData(store,id),true);
  const row=store.db.prepare("SELECT account_id,email,guest_hash,project_id,quote_evidence,price_cents FROM customer_orders WHERE id='paid-1'").get() as
   {account_id:string|null;email:string;guest_hash:string|null;project_id:string;quote_evidence:string;price_cents:number};
  assert.equal(row.account_id,null);
  assert.equal(row.guest_hash,null);
  assert.equal(row.email,"deleted-account@singmotion.invalid");
  assert.equal(row.project_id,"erased:paid-1");
  assert.equal(row.quote_evidence,"{}");
  assert.equal(row.price_cents,499);
 });
});
test("unknown customer references and active subscriptions are not silently deleted",()=>{
 fixture((store,id)=>{
  store.db.exec("CREATE TABLE future_storage(payload TEXT)");
  store.db.prepare("INSERT INTO future_storage VALUES(?)").run(JSON.stringify({owner:"customer-"+id}));
  assert.throws(()=>finalizeErasedCustomerData(store,id),
   (e:unknown)=>e instanceof AccountErasureFinalizationBlocked&&e.code==="UNKNOWN_ACCOUNT_REFERENCE");
  assert.ok(store.db.prepare("SELECT 1 FROM customer_accounts WHERE id=?").get(id));
 });
 fixture((store,id)=>{
  store.db.prepare("INSERT INTO customer_subscriptions(account_id,plan,provider,provider_subscription_id,status,current_period_end,updated_at) VALUES(?,'hobby','stripe','sub_123','active',?,?)")
   .run(id,Date.now()+10000,Date.now());
  assert.throws(()=>finalizeErasedCustomerData(store,id),
   (e:unknown)=>e instanceof AccountErasureFinalizationBlocked&&e.code==="ACTIVE_SUBSCRIPTION");
  assert.ok(store.db.prepare("SELECT 1 FROM customer_accounts WHERE id=?").get(id));
 });
});
