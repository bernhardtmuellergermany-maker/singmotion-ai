import {test} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {CreditWallet} from "../lib/commerce/credit-wallet.ts";
import {stageDeletionRefundIntents,advanceDeletionRefundIntent} from "../lib/commerce/customer-erasure-refund-intents.ts";

const id="11111111-1111-4111-8111-111111111111",subject="customer:"+id;
const purchase="22222222-2222-4222-8222-222222222222";
const session="cs_test_123456789abcdef";
const env={RAILWAY_ENVIRONMENT_ID:"dfaeabed-03df-43ed-aa71-50f343a75041",STRIPE_SECRET_KEY:"sk_test_mock"};
const refund={id:"re_123abc",object:"refund",payment_intent:"pi_123456789",amount:500,
 currency:"eur",status:"succeeded",livemode:false,
 metadata:{erasure_intent:"sm-erasure-v1-"+purchase,erasure_purchase:purchase}};
function fixture(){
 const db=new DatabaseSync(":memory:");new CreditWallet(db);
 db.prepare("INSERT INTO credit_topup_purchases(id,subject,email,credits,cents,status,request_key,stripe_session_id,created) VALUES(?,?,?,1000,1000,'paid',?,?,1)")
  .run(purchase,subject,"owner@example.test","request-1",session);
 return db;
}
const line=[{purchaseId:purchase,sessionId:session,credits:500,cents:500}];
function sender(opts:{mismatch?:boolean;networkFailure?:boolean;recover?:boolean;missing?:boolean}={}){
 const calls:string[]=[];
 const mock=async(input:string|URL|Request,init?:RequestInit)=>{
  const url=String(input),method=init?.method||"GET";calls.push(method+" "+url);
  if(url.includes("checkout/sessions/")){
   return new Response(JSON.stringify({id:session,mode:"payment",livemode:false,
    payment_status:"paid",currency:"eur",amount_total:1000,payment_intent:"pi_123456789",
    metadata:{flow:"singmotion_credit_topup",creditTopupId:opts.mismatch?"other":purchase}}),{status:200});
  }
  if(url.endsWith("/refunds")&&method==="POST"){
   assert.equal((init?.headers as Record<string,string>)?.["Idempotency-Key"],"sm-erasure-v1-"+purchase);
   assert.equal((init?.body as URLSearchParams).get("amount"),"500");
   if(opts.networkFailure)throw Error("Simulated lost Stripe response");
   return new Response(JSON.stringify(refund),{status:200});
  }
  if(url.includes("/refunds?")){
   return new Response(JSON.stringify({has_more:false,data:opts.missing?[]:[refund]}),{status:200});
  }
  if(url.includes("/refunds/"+refund.id))
   return new Response(JSON.stringify(refund),{status:200});
  throw Error("Unexpected Stripe API endpoint "+url);
 };
 return {calls,mock:mock as typeof fetch};
}
test("refund intents store a snapshot only for the exact paid purchase and account",()=>{
 const db=fixture();
 try{
  const saved=stageDeletionRefundIntents(db,id,line);
  assert.equal(saved[0].state,"ready");
  assert.equal(saved[0].cents,500);
  assert.equal(stageDeletionRefundIntents(db,id,line)[0].cents,500);
  assert.throws(()=>stageDeletionRefundIntents(db,id,[{...line[0],cents:200}]),/differs from paid ledger|idempotency/);
  assert.throws(()=>stageDeletionRefundIntents(db,"33333333-3333-4333-8333-333333333333",line),/differs/);
  assert.throws(()=>stageDeletionRefundIntents(db,id,[{...line[0],cents:2000}]),/differs/);
 }finally{db.close();}
});
test("verified Stripe checkout receives exactly one partial refund",async()=>{
 const db=fixture();
 try{
  stageDeletionRefundIntents(db,id,line);
  const x=sender();
  const result=await advanceDeletionRefundIntent(db,purchase,env,x.mock);
  assert.equal(result.state,"succeeded");
  assert.equal(result.refundId,refund.id);
  assert.equal(x.calls.filter(c=>c.startsWith("POST ")).length,1);
  assert.equal((await advanceDeletionRefundIntent(db,purchase,env,x.mock)).state,"succeeded");
  assert.equal(x.calls.filter(c=>c.startsWith("POST ")).length,1);
 }finally{db.close();}
});
test("uncertain network response is recovered by listing the matching refund, never another POST",async()=>{
 const db=fixture();
 try{
  stageDeletionRefundIntents(db,id,line);
  const lost=sender({networkFailure:true});
  await assert.rejects(()=>advanceDeletionRefundIntent(db,purchase,env,lost.mock),/lost Stripe/);
  assert.equal(db.prepare("SELECT state,refund_id FROM customer_erasure_refund_intents WHERE purchase_id=?").get(purchase)?.state,"pending");
  const recovered=sender();
  assert.equal((await advanceDeletionRefundIntent(db,purchase,env,recovered.mock)).state,"succeeded");
  assert.equal(recovered.calls.filter(c=>c.startsWith("POST ")).length,0);
 }finally{db.close();}
});
test("missing or unverified payout cannot accidentally be sent twice",async()=>{
 const db=fixture();
 try{
  stageDeletionRefundIntents(db,id,line);
  await assert.rejects(()=>advanceDeletionRefundIntent(db,purchase,env,sender({networkFailure:true}).mock));
  const unknown=sender({missing:true});
  await assert.rejects(()=>advanceDeletionRefundIntent(db,purchase,env,unknown.mock),/pending independent verification/);
  assert.equal(unknown.calls.filter(c=>c.startsWith("POST ")).length,0);
  assert.equal(db.prepare("SELECT state FROM customer_erasure_refund_intents WHERE purchase_id=?").get(purchase)?.state,"pending");
 }finally{db.close();}
});
test("unverified checkout or environment mismatch blocks before any refund",async()=>{
 const db=fixture();
 try{
  stageDeletionRefundIntents(db,id,line);
  const wrong=sender({mismatch:true});
  await assert.rejects(()=>advanceDeletionRefundIntent(db,purchase,env,wrong.mock),/does not match/);
  assert.equal(wrong.calls.filter(c=>c.startsWith("POST ")).length,0);
  const normal=sender();
  await assert.rejects(()=>advanceDeletionRefundIntent(db,purchase,{...env,RAILWAY_ENVIRONMENT_ID:"production"},normal.mock),/environment mismatch/);
  assert.equal(normal.calls.length,0);
 }finally{db.close();}
});
