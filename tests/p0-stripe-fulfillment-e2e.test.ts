import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {CommerceStore} from "../lib/commerce/store.ts";
import {stripeCheckoutAdapter} from "../lib/commerce/stripe-webhook.ts";
import {submitReviewedPaidVideo} from "../lib/commerce/paid-video-worker.ts";
import type {PreparedMedia} from "../lib/live/store.ts";

const signingSecret="whsec_offline_p0_fixture_only";
const price=250;
const accountPassword="Test customer 2026 20+ characters";
function signedPayment(orderId:string,sessionId:string,eventId:string,kind="checkout.session.completed"){
 const event={id:eventId,livemode:false,type:kind,data:{object:{
  id:sessionId,object:"checkout.session",mode:"payment",payment_status:"paid",
  currency:"eur",amount_total:price,metadata:{orderId}
 }}};
 const raw=Buffer.from(JSON.stringify(event));
 const t=String(Math.floor(Date.now()/1000));
 const signature="t="+t+",v1="+createHmac("sha256",signingSecret).update(t+".").update(raw).digest("hex");
 return {raw,signature};
}
const media=(owner:string):PreparedMedia=>({
 owner,audioPath:"/private/audio.mp3",imagePath:"/private/photo.png",
 audioSha256:"a".repeat(64),imageSha256:"b".repeat(64),
 durationSeconds:10,prompt:"Sing clearly, static camera.",outputFormat:"9:16",
} as PreparedMedia);

test("P0 checkout -> signed payment -> bounded single provider submission -> private delivery; replays cannot charge twice",async()=>{
 const store=new CommerceStore(":memory:");
 try{
  const account=store.register("customer-p0@example.test",accountPassword);
  const another=store.register("attacker-p0@example.test",accountPassword);
  assert.equal(store.emailVerified(account),false);
  const verification=store.issueEmailVerification(account,Date.now())!;
  assert.equal(store.verifyEmailToken(verification.token),true);
  assert.equal(store.emailVerified(account),true);
  const created=store.preparedVideoOrder({account,email:"customer-p0@example.test",project:"p0-verified-song",
   cents:price,quoteEvidence:"verified-audited-sandbox-quote-2026",key:"p0-fulfillment-test",
   media:media("customer-"+account)});
  const id=created.id,checkout="cs_test_p0_e2e_customer";
  store.bindStripeCheckout(id,checkout);
  const accepted=signedPayment(id,checkout,"evt_p0_first");
  const adapter=stripeCheckoutAdapter(signingSecret,"test");
  await store.webhook(accepted.raw,accepted.signature,adapter);
  await store.webhook(accepted.raw,accepted.signature,adapter);
  const delayed=signedPayment(id,checkout,"evt_p0_delayed","checkout.session.async_payment_succeeded");
  await store.webhook(delayed.raw,delayed.signature,adapter);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM payment_events").get()?.n,2);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM customer_fulfillment_queue WHERE order_id=?").get(id)?.n,1);
  let submitted=0;
  const ops={
   providerCost:{inclusiveMaxMicroUsd:700000,dailyCapMicroUsd:5000000,lifetimeCapMicroUsd:25000000,reviewEvidence:"offline-reviewed-provider-cost-policy"},
   verify:async()=>{},submit:async()=>{submitted++;return "byteplus-p0-test-job"},
  };
  assert.equal(await submitReviewedPaidVideo(store,id,ops),"submitted");
  assert.equal(await submitReviewedPaidVideo(store,id,ops),"already-claimed");
  assert.equal(submitted,1);
  assert.equal(store.recordPaidVideoDelivery(id,"private-asset-p0-001","verified-r2-private-asset-2026"),true);
  assert.equal(store.finalizePaidFulfillment(id,{state:"delivered",deliveryEvidence:"sha256-reviewed-private-video-delivery"}),true);
  assert.equal(store.ownedDeliveredVideoAsset(id,account),"private-asset-p0-001");
  assert.throws(()=>store.ownedDeliveredVideoAsset(id,another),/unavailable/i);
  assert.equal(store.claimPaidFulfillment(id),false);
  await store.webhook(accepted.raw,accepted.signature,adapter);
  assert.equal(store.db.prepare("SELECT state FROM customer_fulfillment_queue WHERE order_id=?").get(id)?.state,"delivered");
 }finally{store.close()}
});
test("P0 refund and dispute before provider submission stop fulfillment; delayed paid notifications never reactivate",async()=>{
 const store=new CommerceStore(":memory:");
 try{
  for(const kind of ["refund","dispute"] as const){
   const order=store.order({account:null,email:"buyer-p0@example.test",project:"p0-reversal-"+kind,
    cents:price,quoteEvidence:"verified-reviewed-reversal-pricing",key:"p0-"+kind});
   const checkout="cs_test_p0_"+kind, id=order.id;
   store.bindStripeCheckout(id,checkout);
   const adapter=stripeCheckoutAdapter(signingSecret,"test");
   const first=signedPayment(id,checkout,"evt_p0_pay_"+kind);
   await store.webhook(first.raw,first.signature,adapter);
   if(kind==="refund"){
    const proof={orderId:id,stripeCheckoutId:checkout,refundId:"re_p0_verified",refundedCents:price,evidence:"verified-independent-stripe-refund-evidence"};
    assert.equal(store.reconcileVerifiedStripeRefund(proof),true);
    assert.equal(store.reconcileVerifiedStripeRefund(proof),false);
   }else{
    const proof={orderId:id,stripeCheckoutId:checkout,disputeId:"dp_p0_verified",evidence:"verified-independent-stripe-dispute-evidence"};
    assert.equal(store.reconcileVerifiedStripeDispute(proof),true);
    assert.equal(store.reconcileVerifiedStripeDispute(proof),false);
   }
   const delayed=signedPayment(id,checkout,"evt_p0_paid_late_"+kind);
   await store.webhook(delayed.raw,delayed.signature,adapter);
   assert.equal(store.claimPaidFulfillment(id),false);
   assert.equal(store.db.prepare("SELECT state FROM customer_fulfillment_queue WHERE order_id=?").get(id)?.state,"failed");
   assert.equal(store.db.prepare("SELECT status FROM customer_orders WHERE id=?").get(id)?.status,
    kind==="refund"?"refunded":"disputed");
  }
 }finally{store.close()}
});


test("P0 ambiguous BytePlus acceptance never repeats a paid provider request after duplicate Stripe events",async()=>{
 const store=new CommerceStore(":memory:");
 try{
  const account=store.register("ambiguous-p0@example.test",accountPassword);
  const verify=store.issueEmailVerification(account,Date.now())!;
  assert.equal(store.verifyEmailToken(verify.token),true);
  const order=store.preparedVideoOrder({
   account,email:"ambiguous-p0@example.test",project:"p0-ambiguous-video",
   cents:price,quoteEvidence:"verified-offline-customer-quote-2026",
   key:"p0-ambiguous-once",media:media("customer-"+account),
  });
  const checkout="cs_test_p0_ambiguous";
  store.bindStripeCheckout(order.id,checkout);
  const adapter=stripeCheckoutAdapter(signingSecret,"test");
  const paid=signedPayment(order.id,checkout,"evt_p0_ambiguous_paid");
  await store.webhook(paid.raw,paid.signature,adapter);
  let providerSubmissions=0;
  const ops={
   providerCost:{
    inclusiveMaxMicroUsd:700000,
    dailyCapMicroUsd:5000000,
    lifetimeCapMicroUsd:25000000,
    reviewEvidence:"offline-reviewed-cost-reservation-p0",
   },
   verify:async()=>{},
   submit:async()=>{
    providerSubmissions++;
    // The remote request may have been accepted before its response was lost.
    throw Error("synthetic lost provider response");
   },
  };
  assert.equal(await submitReviewedPaidVideo(store,order.id,ops),"submission-uncertain");
  // A second signed Stripe event and a direct retry must not dispatch again.
  const replay=signedPayment(order.id,checkout,"evt_p0_ambiguous_async",
   "checkout.session.async_payment_succeeded");
  await store.webhook(replay.raw,replay.signature,adapter);
  await store.webhook(paid.raw,paid.signature,adapter);
  assert.equal(await submitReviewedPaidVideo(store,order.id,ops),"already-claimed");
  assert.equal(providerSubmissions,1);
  assert.ok(!store.ownedDeliveredVideoAsset(order.id,account));
 }finally{store.close()}
});
