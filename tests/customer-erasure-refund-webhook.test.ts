import {test} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {CreditWallet} from "../lib/commerce/credit-wallet.ts";
import {ensureDeletionRefundIntents} from "../lib/commerce/customer-erasure-refund-intents.ts";
import {reconcileVerifiedErasureRefund} from "../lib/commerce/customer-erasure-refund-webhook.ts";
const accountId="11111111-1111-4111-8111-111111111111",purchaseId="22222222-2222-4222-8222-222222222222";
const sessionId="cs_test_12345abcd";
function fixture(){
 const db=new DatabaseSync(":memory:");new CreditWallet(db);ensureDeletionRefundIntents(db);
 db.prepare("INSERT INTO credit_topup_purchases(id,subject,email,credits,cents,status,request_key,stripe_session_id,created) VALUES(?,?,?,?,?,'paid',?,?,?)")
  .run(purchaseId,"customer:"+accountId,"customer@example.test",1000,1000,"request-1",sessionId,1);
 db.prepare("INSERT INTO customer_erasure_refund_intents VALUES(?,?,?,500,500,'pending',NULL,?,1,1)")
  .run(purchaseId,accountId,sessionId,Date.now());
 return db;
}
const refund={id:"pyr_123abc",object:"refund",status:"succeeded",amount:500,currency:"eur",
 payment_intent:"pi_123abc",livemode:false,
 metadata:{erasure_intent:"sm-erasure-v1-"+purchaseId,erasure_purchase:purchaseId}};
const session={id:sessionId,payment_intent:"pi_123abc",mode:"payment",payment_status:"paid",currency:"eur",livemode:false,
 metadata:{flow:"singmotion_credit_topup",creditTopupId:purchaseId}};
test("partial refund event reconciles only its bound intent and is idempotent",()=>{
 const db=fixture();try{
  assert.equal(reconcileVerifiedErasureRefund(db,refund,session,"test"),true);
  assert.equal(reconcileVerifiedErasureRefund(db,refund,session,"test"),true);
  const intent=db.prepare("SELECT state,refund_id FROM customer_erasure_refund_intents WHERE purchase_id=?").get(purchaseId);
  assert.equal(intent?.state,"succeeded");
  assert.equal(intent?.refund_id,"pyr_123abc");
  const purchase=db.prepare("SELECT credits,status FROM credit_topup_purchases WHERE id=?").get(purchaseId);
  assert.equal(purchase?.credits,1000,"other 500 Credits must not be reversed");
  assert.equal(purchase?.status,"paid");
 }finally{db.close()}
});
test("mismatched charge/Checkout, amount and metadata never update intent",()=>{
 const db=fixture();try{
  assert.throws(()=>reconcileVerifiedErasureRefund(db,{...refund,amount:999},session,"test"),/differs/);
  assert.throws(()=>reconcileVerifiedErasureRefund(db,refund,{...session,id:"cs_test_other"},"test"),/differs/);
  assert.throws(()=>reconcileVerifiedErasureRefund(db,refund,session,"live"),/differs/);
  assert.equal(reconcileVerifiedErasureRefund(db,{...refund,metadata:{...refund.metadata,erasure_purchase:"another"}},session,"test"),false);
  assert.equal(db.prepare("SELECT state FROM customer_erasure_refund_intents WHERE purchase_id=?").get(purchaseId)?.state,"pending");
 }finally{db.close()}
});
test("unrelated refunds are not intercepted from the legacy full-refund handler",()=>{
 const db=fixture();try{
  assert.equal(reconcileVerifiedErasureRefund(db,{...refund,metadata:{}},session,"test"),false);
  assert.equal(db.prepare("SELECT state FROM customer_erasure_refund_intents WHERE purchase_id=?").get(purchaseId)?.state,"pending");
 }finally{db.close()}
});
