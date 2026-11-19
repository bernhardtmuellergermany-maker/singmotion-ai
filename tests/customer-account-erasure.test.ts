import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {CommerceStore} from "../lib/commerce/store.ts";
import {CreditWallet} from "../lib/commerce/credit-wallet.ts";
import {assessCustomerErasure,eraseEmptyCustomerAccount} from "../lib/commerce/customer-account-erasure.ts";

const password="long-unique-account-deletion-password";
function fixture(fn:(store:CommerceStore,media:DatabaseSync,root:string)=>void){
 const dir=mkdtempSync(path.join(tmpdir(),"sm-erasure-"));
 const store=new CommerceStore(path.join(dir,"commerce.sqlite"),{
  CUSTOMER_BETA_WELCOME_CREDITS_ENABLED:"false"
 });
 const media=new DatabaseSync(path.join(dir,"demo.sqlite"));
 media.exec("CREATE TABLE sessions(token TEXT PRIMARY KEY,owner TEXT NOT NULL,expires INTEGER NOT NULL,admin INTEGER NOT NULL DEFAULT 0);CREATE TABLE assets(id TEXT PRIMARY KEY,owner TEXT NOT NULL,data TEXT NOT NULL)");
 try{fn(store,media,dir)}finally{media.close();store.close();rmSync(dir,{recursive:true,force:true})}
}
test("confirmed empty account erasure revokes all own devices, leaves unrelated users intact",()=>{
 fixture((store,media,dir)=>{
  const id=store.register("one@example.test",password);
  const other=store.register("other@example.test",password);
  const t1=store.login("one@example.test",password);
  const t2=store.login("one@example.test",password);
  const t3=store.login("other@example.test",password);
  media.prepare("INSERT INTO sessions VALUES (?,?,?,0)").run("first","customer-"+id,Date.now()+100000);
  media.prepare("INSERT INTO sessions VALUES (?,?,?,0)").run("second","customer-"+id,Date.now()+100000);
  media.prepare("INSERT INTO sessions VALUES (?,?,?,0)").run("other","customer-"+other,Date.now()+100000);
  assert.equal(store.verifyCustomerPassword(id,password),true);
  assert.equal(store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='credit_wallet_ledger'").get(),undefined);
  assert.equal(assessCustomerErasure(store,dir,id).eligible,true);
  assert.equal(store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='credit_wallet_ledger'").get(),undefined,
   "read-only preflight must not create a wallet schema for an empty customer");
  assert.equal(eraseEmptyCustomerAccount(store,dir,id).eligible,true);
  assert.equal(store.session(t1),null);
  assert.equal(store.session(t2),null);
  assert.equal(store.session(t3),other);
  assert.equal(store.db.prepare("SELECT 1 FROM customer_accounts WHERE id=?").get(id),undefined);
  assert.equal(media.prepare("SELECT 1 FROM sessions WHERE owner=?").get("customer-"+id),undefined);
  assert.ok(media.prepare("SELECT 1 FROM sessions WHERE owner=?").get("customer-"+other));
 });
});
test("free promotional gift may be removed, but paid Credits are never forfeited",()=>{
 fixture((store,media,dir)=>{
  const id=store.register("gift@example.test",password);
  const wallet=new CreditWallet(store.db);
  const subject="customer:"+id,ref="beta-welcome:v1:"+id;
  store.db.prepare("INSERT INTO credit_wallet_ledger VALUES(?,?,?,?,?,?)")
   .run(ref,subject,250,"beta-welcome",ref,Date.now());
  assert.equal(assessCustomerErasure(store,dir,id).eligible,true);
  store.db.prepare("INSERT INTO credit_wallet_ledger VALUES(?,?,?,?,?,?)")
   .run("purchase-unit-test",subject,1000,"purchase","topup-unit-test",Date.now());
  const blocked=eraseEmptyCustomerAccount(store,dir,id);
  assert.equal(blocked.eligible,false);
  assert.equal(blocked.code,"CREDITS_OR_PAYMENTS");
  assert.equal(wallet.total(subject),1250);
  assert.ok(store.db.prepare("SELECT 1 FROM customer_accounts WHERE id=?").get(id));
  store.db.prepare("DELETE FROM credit_wallet_ledger WHERE id=?").run("purchase-unit-test");
  assert.equal(eraseEmptyCustomerAccount(store,dir,id).eligible,true);
  assert.equal(wallet.total(subject),0);
 });
});
test("top-ups, holds, media, and unknown foreign-key or JSON references block erasure",()=>{
 fixture((store,media,dir)=>{
  const id=store.register("paid@example.test",password);
  const wallet=new CreditWallet(store.db);
  store.db.prepare("INSERT INTO credit_topup_purchases(id,subject,email,credits,cents,status,request_key,created) VALUES(?,?,?,? ,?,'pending',?,?)")
   .run("id-topup","customer:"+id,"paid@example.test",250,499,"request-key",Date.now());
  assert.equal(assessCustomerErasure(store,dir,id).code,"CREDITS_OR_PAYMENTS");
  store.db.prepare("DELETE FROM credit_topup_purchases").run();
  media.prepare("INSERT INTO assets VALUES(?,?,?)").run("asset-01","customer-"+id,"{}");
  assert.equal(eraseEmptyCustomerAccount(store,dir,id).code,"MEDIA_OR_ORDERS");
  media.prepare("DELETE FROM assets").run();
  store.db.exec("CREATE TABLE IF NOT EXISTS account_future_schema(id TEXT PRIMARY KEY,payload TEXT)");
  store.db.prepare("INSERT INTO account_future_schema VALUES(?,?)")
   .run("future-record",JSON.stringify({owner:"customer-"+id}));
  assert.equal(assessCustomerErasure(store,dir,id).eligible,false);
  assert.ok(store.db.prepare("SELECT 1 FROM customer_accounts WHERE id=?").get(id));
 });
});
test("an unknown live provider record blocks deletion even if it embeds only owner JSON",()=>{
 fixture((store,_media,dir)=>{
  const id=store.register("video@example.test",password);
  const live=new DatabaseSync(path.join(dir,"live-test.sqlite"));
  try{
   live.exec("CREATE TABLE live_attempts(id TEXT PRIMARY KEY,data TEXT)");
   live.prepare("INSERT INTO live_attempts VALUES(?,?)")
    .run("attempt-1",JSON.stringify({media:{owner:"customer-"+id},state:"processing"}));
   assert.equal(assessCustomerErasure(store,dir,id).code,"MEDIA_OR_ORDERS");
   assert.equal(eraseEmptyCustomerAccount(store,dir,id).eligible,false);
  }finally{live.close();}
 });
});
test("customer erasure is never a GET mutation; POST demands origin, session, password and exact phrase",()=>{
 const route=readFileSync(new URL("../app/(site)/api/customer-account-erasure/route.ts",import.meta.url),"utf8");
 const page=readFileSync(new URL("../app/(site)/account/settings/page.tsx",import.meta.url),"utf8");
 assert.match(route,/export async function GET/);
 assert.match(route,/export async function POST/);
 assert.match(route,/req.headers.get\("origin"\)!==origin/);
 assert.match(route,/store.session\(req.cookies.get\("sm_customer"\)/);
 assert.match(route,/verifyCustomerPassword\(id,input.password\)/);
 assert.match(route,/input.confirmation!=="DELETE MY ACCOUNT"/);
 assert.match(route,/response.cookies.delete\("sm_customer"\)/);
 assert.match(page,/Permanently delete my account/);
 assert.match(page,/deleteConfirmation!=="DELETE MY ACCOUNT"/);
 assert.doesNotMatch(route,/stripe\.com\/v1\/refunds/);
});
