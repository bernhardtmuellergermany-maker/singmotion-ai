import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,rmSync} from "node:fs";
import path from "node:path";
import {tmpdir} from "node:os";
import {DatabaseSync} from "node:sqlite";
import {CommerceStore} from "../lib/commerce/store.ts";
import {CreditWallet} from "../lib/commerce/credit-wallet.ts";
import {beginCustomerErasure,readErasureJob} from "../lib/commerce/customer-erasure-job.ts";
import {runCustomerErasureJobs} from "../lib/commerce/customer-erasure-runner.ts";
const env={RAILWAY_ENVIRONMENT_ID:"dfaeabed-03df-43ed-aa71-50f343a75041",STRIPE_SECRET_KEY:"sk_test_mock"};
const password="test-automated-erasure-password";
async function fixture(fn:(root:string,store:CommerceStore,id:string,other:string)=>Promise<void>){
 const root=mkdtempSync(path.join(tmpdir(),"sm-erasure-runner-"));
 mkdirSync(path.join(root,"media"));mkdirSync(path.join(root,"live-output"));
 const store=new CommerceStore(path.join(root,"commerce.sqlite"),{
  CUSTOMER_BETA_WELCOME_CREDITS_ENABLED:"false"});
 const demo=new DatabaseSync(path.join(root,"demo.sqlite"));
 demo.exec("CREATE TABLE sessions(token TEXT PRIMARY KEY,owner TEXT NOT NULL,expires INTEGER NOT NULL,admin INTEGER NOT NULL DEFAULT 0);CREATE TABLE assets(id TEXT PRIMARY KEY,owner TEXT NOT NULL,data TEXT NOT NULL);CREATE TABLE jobs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL)");
 demo.close();
 const id=store.register("owner@example.test",password),other=store.register("another@example.test",password);
 try{await fn(root,store,id,other)}
 finally{store.close();rmSync(root,{recursive:true,force:true})}
}
const mockStripe=async(input:string|URL|Request,options?:RequestInit):Promise<Response>=>{
 const url=String(input);
 if(url.includes("/checkout/sessions/"))
  return new Response(JSON.stringify({id:"cs_test_123456789abc",
   mode:"payment",livemode:false,payment_status:"paid",currency:"eur",
   amount_total:1000,payment_intent:"pi_123456789abc",
   metadata:{flow:"singmotion_credit_topup",creditTopupId:"22222222-2222-4222-8222-222222222222"}}),{status:200});
 if(url.endsWith("/refunds")&&options?.method==="POST"){
  assert.equal((options.body as URLSearchParams).get("amount"),"1000");
  return new Response(JSON.stringify({id:"re_123456789",object:"refund",
   payment_intent:"pi_123456789abc",amount:1000,currency:"eur",
   livemode:false,status:"succeeded"}),{status:200});
 }
 if(url.includes("/refunds/")||url.includes("/refunds?"))
  throw Error("Unexpected refund lookup during successful synchronous test");
 throw Error("Unsupported simulated Stripe request");
};
test("automatic empty-account erasure finishes, revokes sessions and preserves other users",async()=>{
 await fixture(async(root,store,id,other)=>{
  const token=store.login("owner@example.test",password);
  beginCustomerErasure(store,id);
  assert.equal(store.session(token),null);
  const d1=await runCustomerErasureJobs(root,{limit:2});
  assert.equal(d1.advanced,1);
  assert.equal(readErasureJob(store.db,id)?.state,"removing-media");
  const d2=await runCustomerErasureJobs(root);
  assert.equal(d2.advanced,1);
  assert.equal(readErasureJob(store.db,id)?.state,"removing-data");
  const d3=await runCustomerErasureJobs(root);
  assert.equal(d3.completed,1);
  assert.equal(readErasureJob(store.db,id)?.state,"completed");
  assert.equal(store.db.prepare("SELECT 1 FROM customer_accounts WHERE id=?").get(id),undefined);
  assert.ok(store.db.prepare("SELECT 1 FROM customer_accounts WHERE id=?").get(other));
 });
});
test("paid balance refunded once before data deletion; financial shell anonymized",async()=>{
 await fixture(async(root,store,id)=>{
  new CreditWallet(store.db);
  const purchaseId="22222222-2222-4222-8222-222222222222",subject="customer:"+id;
  store.db.prepare("INSERT INTO credit_topup_purchases(id,subject,email,credits,cents,status,request_key,stripe_session_id,created) VALUES(?,?,?,1000,1000,'paid',?,?,1)")
   .run(purchaseId,subject,"owner@example.test","req-paid","cs_test_123456789abc");
  store.db.prepare("INSERT INTO credit_wallet_ledger VALUES(?,?,?,?,?,1)")
   .run("credit-topup:"+purchaseId,subject,1000,"purchase","credit-topup:"+purchaseId);
  beginCustomerErasure(store,id);
  let payoutCalls=0;
  const stripeFetch:typeof fetch=async(input,options)=>{
   if(String(input).endsWith("/refunds")&&options?.method==="POST")payoutCalls++;
   return mockStripe(input,options);
  };
  const first=await runCustomerErasureJobs(root,{stripeFetch,env});
  assert.equal(first.advanced,1);
  assert.equal(readErasureJob(store.db,id)?.state,"refunding");
  const second=await runCustomerErasureJobs(root,{stripeFetch,env});
  assert.equal(second.advanced,1);assert.equal(payoutCalls,1);
  await runCustomerErasureJobs(root,{stripeFetch,env});
  await runCustomerErasureJobs(root,{stripeFetch,env});
  const completed=await runCustomerErasureJobs(root,{stripeFetch,env});
  assert.equal(completed.completed,1);
  assert.equal(payoutCalls,1);
  assert.equal(store.db.prepare("SELECT email FROM customer_accounts WHERE id=?").get(id),undefined);
  assert.equal(store.db.prepare("SELECT email FROM credit_topup_purchases WHERE id=?").get(purchaseId)?.email,"deleted-account@singmotion.invalid");
  const purchase=store.db.prepare("SELECT subject FROM credit_topup_purchases WHERE id=?").get(purchaseId) as {subject:string};
  assert.equal(purchase.subject.includes(id),false);
  assert.equal(store.db.prepare("SELECT COALESCE(SUM(delta),0) AS total FROM credit_wallet_ledger WHERE subject=?").get(purchase.subject)?.total,0);
 });
});
test("unknown media never triggers refund or account removal",async()=>{
 await fixture(async(root,store,id)=>{
  new CreditWallet(store.db);
  const purchaseId="22222222-2222-4222-8222-222222222222",subject="customer:"+id;
  store.db.prepare("INSERT INTO credit_topup_purchases(id,subject,email,credits,cents,status,request_key,stripe_session_id,created) VALUES(?,?,?,1000,1000,'paid',?,?,1)")
   .run(purchaseId,subject,"owner@example.test","req-paid","cs_test_123456789abc");
  store.db.prepare("INSERT INTO credit_wallet_ledger VALUES(?,?,?,?,?,1)")
   .run("credit-topup:"+purchaseId,subject,1000,"purchase","credit-topup:"+purchaseId);
  const media=new DatabaseSync(path.join(root,"demo.sqlite"));
  media.exec("CREATE TABLE future_media(payload TEXT)");
  media.prepare("INSERT INTO future_media VALUES(?)").run(JSON.stringify({owner:"customer-"+id}));
  media.close();
  beginCustomerErasure(store,id);
  let calls=0;
  await runCustomerErasureJobs(root,{env,stripeFetch:(async()=>{calls++;throw Error("Forbidden")}) as typeof fetch});
  assert.equal(calls,0,"refund must never precede a safe media preflight");
  assert.equal(readErasureJob(store.db,id)?.state,"requested");
  assert.ok(store.db.prepare("SELECT 1 FROM customer_accounts WHERE id=?").get(id));
 });
});
