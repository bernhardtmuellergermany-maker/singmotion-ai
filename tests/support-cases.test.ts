import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {mkdtempSync,rmSync} from "node:fs";
import path from "node:path";
import {tmpdir} from "node:os";
import {randomUUID} from "node:crypto";
import {CommerceStore} from "../lib/commerce/store.ts";
import {CreditWallet} from "../lib/commerce/credit-wallet.ts";
import {SupportCases} from "../lib/commerce/support-cases.ts";
import {retrySupportCaseEmails,queueFailedOutputSupportEmails} from "../lib/commerce/support-notifications.ts";
import {requestSupportStripeRefund} from "../lib/commerce/support-stripe-refund.ts";

const actor="cms-staff-123";
const note="Video was permanently rejected; refund authorized after operator review.";
const env={RAILWAY_ENVIRONMENT_ID:"dfaeabed-03df-43ed-aa71-50f343a75041",
 STRIPE_SECRET_KEY:"sk_test_offline",STRIPE_WEBHOOK_SECRET:"whsec_offline",
 RESEND_API_KEY:"re_offline",ACCOUNT_EMAIL_FROM:"support@singmotion.ai"};

function fixture(){
 const root=mkdtempSync(path.join(tmpdir(),"support-cases-"));
 const store=new CommerceStore(path.join(root,"commerce.sqlite"));
 const liveFile=path.join(root,"live-test.sqlite");
 const live=new DatabaseSync(liveFile);
 live.exec("CREATE TABLE live_attempts(id TEXT PRIMARY KEY,data TEXT NOT NULL)");
 return {store,live,liveFile,root,close(){
  live.close();store.close();rmSync(root,{recursive:true,force:true});
 }};
}
function liveFailure(f:ReturnType<typeof fixture>,id:string,code:string,state="failed"){
 f.live.prepare("INSERT INTO live_attempts VALUES(?,?)").run(id,
  JSON.stringify({state,failureCode:code,outputPath:null,media:{owner:"customer-owner"}}));
}
test("Super Admin exact-ID lookup: no arbitrary names, media, or raw provider refs",()=>{
 const f=fixture();try{
  const support=new SupportCases(f.store.db);
  assert.throws(()=>support.lookup("somebody@example.com",f.liveFile),/UUID/);
  assert.throws(()=>support.lookup("' OR 1=1 --",f.liveFile),/UUID/);
  assert.equal(support.lookup(randomUUID(),f.liveFile),null);
 }finally{f.close()}
});
test("terminal failed provider job credits refund exactly once, with owner email notification",()=>{
 const f=fixture();try{
  const id=randomUUID(),owner="cust42",subject="customer:"+owner;
  f.store.db.prepare("INSERT INTO customer_accounts(id,email,password_hash,created) VALUES(?,?,?,?)")
    .run(owner,"test@example.org","offline-hash",Date.now());
  const wallet=new CreditWallet(f.store.db);
  const topup=wallet.pending({subject,email:"test@example.org",customerId:owner},500,randomUUID());
  wallet.bind(topup.id,"cs_test_support_credit","https://checkout.stripe.com/c/test");
  wallet.settle({id:topup.id,sessionId:"cs_test_support_credit",amount:500,currency:"eur",paymentStatus:"paid",livemode:false});
  wallet.reserveVideo(id,subject,125);
  liveFailure(f,id,"PROVIDER_JOB_FAILED");
  const support=new SupportCases(f.store.db);
  const before=support.lookup(id,f.liveFile)!;
  assert.equal(before.type,"credit-video");assert.equal(before.refundable,true);
  assert.equal(before.customerEmail,"test@example.org");
  const after=support.refundCredit(id,actor,note,f.liveFile);
  assert.equal(after.details.creditReservation,"released");
  assert.equal(wallet.available(subject),500);
  assert.throws(()=>support.refundCredit(id,actor,note,f.liveFile),/already released|Credits already released/);
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM credit_wallet_ledger WHERE kind='support-video-refund'").get().n,1);
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM support_case_mail_outbox").get().n,1);
 }finally{f.close()}
});
test("no money returned for active, uncertain or malformed MP4 jobs",()=>{
 for(const [status,code] of [["processing","PROVIDER_JOB_FAILED"],["uncertain","SUBMISSION_OUTCOME_UNKNOWN"],["failed","INVALID_OUTPUT"],["failed","TEMPO_RESTORATION_FAILED"]] as const){
  const f=fixture();try{
   const job=randomUUID();
   const w=new CreditWallet(f.store.db);
   // A persisted reservation is enough; this test must not require Stripe.
   f.store.db.prepare("INSERT INTO credit_video_reservations VALUES(?,?,?,'review',?,?)")
    .run(job,"customer:owner",125,Date.now(),Date.now());
   liveFailure(f,job,code,status);
   const support=new SupportCases(f.store.db);
   assert.equal(support.lookup(job,f.liveFile)?.refundable,false);
   assert.throws(()=>support.refundCredit(job,actor,note,f.liveFile));
   assert.equal(w.videoReservation(job)?.state,"review");
  }finally{f.close()}
 }
});
test("settled failed video Credit refund reverses final debit once",()=>{
 const f=fixture();try{
  const job=randomUUID();
  const wallet=new CreditWallet(f.store.db),subject="customer:owner";
  const topup=wallet.pending({subject,email:"cust@example.test",customerId:"owner"},500,randomUUID());
  wallet.bind(topup.id,"cs_test_wallet_refund","https://checkout.stripe.com/c/pay/offline");
  wallet.settle({id:topup.id,sessionId:"cs_test_wallet_refund",amount:500,currency:"eur",paymentStatus:"paid",livemode:false});
  wallet.reserveVideo(job,subject,125);
  wallet.reconcileVideo(job,"completed");
  liveFailure(f,job,"PROVIDER_JOB_FAILED");
  assert.equal(wallet.total(subject),375);
  const support=new SupportCases(f.store.db);
  support.refundCredit(job,actor,note,f.liveFile);
  assert.equal(wallet.total(subject),500);
  assert.equal(wallet.videoReservation(job)?.state,"released");
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM credit_wallet_ledger WHERE reference=?")
    .get("support-video-refund:"+job).n,1);
 }finally{f.close()}
});
test("resolution is idempotent, auditable, and email retries after a failure",async()=>{
 const f=fixture();try{
  const id=randomUUID(),project=randomUUID();
  f.store.db.prepare("INSERT INTO customer_orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
   .run(id,null,null,null,"buyer@example.test",project,0,"EUR","cancelled","offline",randomUUID(),Date.now());
  const support=new SupportCases(f.store.db);
  support.markResolved(id,actor,note,f.liveFile);
  support.markResolved(id,actor,note,f.liveFile);
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM support_case_mail_outbox").get().n,1);
  const sent:string[]=[];
  const sender=(async(_url:RequestInfo|URL,init?:RequestInit)=>{
    sent.push(String(init?.headers&&
     (init.headers as Record<string,string>)["Idempotency-Key"]));
    return new Response(JSON.stringify({id:"em_mock"}),{status:200});
  }) as typeof fetch;
  assert.deepEqual(await retrySupportCaseEmails(path.join(f.root,"commerce.sqlite"),env,sender),{attempted:1,sent:1});
  assert.deepEqual(await retrySupportCaseEmails(path.join(f.root,"commerce.sqlite"),env,sender),{attempted:0,sent:0});
  assert.equal(sent.length,1);
 }finally{f.close()}
});
test("Stripe refund is explicitly confirmed, environment-bound and idempotent",async()=>{
 const f=fixture();try{
  const order=randomUUID(),project=randomUUID(),session="cs_test_support_order",intent="pi_offline_order";
  f.store.db.prepare("INSERT INTO customer_orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
   .run(order,null,null,null,"test@example.org",project,125,"EUR","paid","offline",randomUUID(),Date.now());
  f.store.db.prepare("INSERT INTO customer_fulfillment_queue VALUES(?,'failed',?)").run(order,Date.now());
  f.store.db.prepare("INSERT INTO stripe_checkout_sessions VALUES(?,?,?)").run(order,session,Date.now());
  const calls:string[]=[];
  const sender=(async(url:RequestInfo|URL,opts?:RequestInit)=>{
   const u=String(url);
   calls.push((opts?.method??"GET")+" "+u);
   if(u.endsWith("/checkout/sessions/"+session)){
    return Response.json({id:session,livemode:false,mode:"payment",payment_status:"paid",
      amount_total:125,currency:"eur",payment_intent:intent,metadata:{orderId:order}});
   }
   if(u.endsWith("/refunds")&&opts?.method==="POST"){
    assert.equal((opts.headers as Record<string,string>)["Idempotency-Key"],"singmotion-support-full-refund-"+order);
    return Response.json({id:"re_offline_full",object:"refund",livemode:false,
      payment_intent:intent,amount:125,currency:"eur",status:"succeeded"});
   }
   throw Error("Unexpected network request");
  }) as typeof fetch;
  await assert.rejects(()=>requestSupportStripeRefund(f.store,order,actor,note,"wrong",env,sender),/Type REFUND/);
  assert.equal(calls.length,0);
  const result=await requestSupportStripeRefund(f.store,order,actor,note,"REFUND "+order.toUpperCase(),env,sender);
  assert.equal(result.status,"succeeded");
  assert.equal(f.store.db.prepare("SELECT status FROM customer_orders WHERE id=?").get(order).status,"refunded");
  assert.equal(f.store.db.prepare("SELECT status FROM support_stripe_refund_intents WHERE order_id=?").get(order).status,"succeeded");
  await requestSupportStripeRefund(f.store,order,actor,note,"REFUND "+order.toUpperCase(),env,sender);
  assert.equal(calls.length,2,"duplicate operator click cannot call Stripe again");
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM customer_stripe_refunds WHERE order_id=?").get(order).n,1);
 }finally{f.close()}
});

test("invalid MP4 alerts Support once with a safe ID and never refunds Credits",()=>{
 const f=fixture();try{
  const id=randomUUID();
  liveFailure(f,id,"INVALID_OUTPUT");
  const added=queueFailedOutputSupportEmails(path.join(f.root,"commerce.sqlite"),f.liveFile);
  assert.equal(added,1);
  assert.equal(queueFailedOutputSupportEmails(path.join(f.root,"commerce.sqlite"),f.liveFile),0);
  const mail=f.store.db.prepare("SELECT recipient,body FROM support_case_mail_outbox WHERE reference=?").get(id) as {recipient:string;body:string};
  assert.equal(mail.recipient,"support@singmotion.ai");
  assert.match(mail.body,new RegExp(id));
  assert.doesNotMatch(mail.body,/signed|\/private\/|api_key/i);
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM credit_wallet_ledger").get().n,0);
 }finally{f.close()}
});
test("a failed charged video cannot be marked resolved before refund verification",()=>{
 const f=fixture();try{
  const id=randomUUID(),project=randomUUID();
  f.store.db.prepare("INSERT INTO customer_orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
   .run(id,null,null,null,"buyer@example.test",project,125,"EUR","paid","offline",randomUUID(),Date.now());
  f.store.db.prepare("INSERT INTO customer_fulfillment_queue VALUES(?,'failed',?)").run(id,Date.now());
  const support=new SupportCases(f.store.db);
  assert.throws(()=>support.markResolved(id,actor,note,f.liveFile),/cannot be closed/);
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM support_cases").get().n,0);
 }finally{f.close()}
});
