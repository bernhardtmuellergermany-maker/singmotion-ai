import {test} from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {configuredStripePaymentMode,stripeSessionIdMatchesMode} from "../lib/commerce/stripe-payment-mode.ts";
import {verifyStripePaymentEvent,stripeCheckoutAdapter,verifiedStripeCheckoutSession} from "../lib/commerce/stripe-webhook.ts";
import {CommerceStore} from "../lib/commerce/store.ts";

const stage="dfaeabed-03df-43ed-aa71-50f343a75041";
const production="36adc41d-7e54-4396-ad1a-fd432ba0441d";
const orderId="11111111-1111-4111-8111-111111111111";
const secret="whsec_mock_signature_fixtures";
const liveEnv={
 RAILWAY_ENVIRONMENT_ID:production,
 STRIPE_LIVE_CHECKOUT_ENABLED:"true",
 PUBLIC_CUSTOMER_LAUNCH_APPROVED:"true",
 STRIPE_ACCOUNT_LIVE_REVIEW_APPROVED:"true",
 STRIPE_SECRET_KEY:"sk_live_fictional_only",
 STRIPE_WEBHOOK_SECRET:secret,
};
const liveEvent={id:"evt_mock_paid_1",livemode:true,type:"checkout.session.completed",
 data:{object:{id:"cs_live_mock_paid",object:"checkout.session",
  mode:"payment",payment_status:"paid",currency:"eur",amount_total:250,
  metadata:{orderId}}}};
function signed(value:unknown,key=secret){
 const raw=Buffer.from(JSON.stringify(value));
 const t=String(Math.floor(Date.now()/1000));
 return {raw,signature:"t="+t+",v1="+createHmac("sha256",key)
  .update(Buffer.concat([Buffer.from(t+"."),raw])).digest("hex")};
}
test("Stripe checkout mode is locked to the exact Railway environment",()=>{
 assert.equal(configuredStripePaymentMode({}),null);
 assert.equal(configuredStripePaymentMode(liveEnv),"live");
 assert.equal(configuredStripePaymentMode({...liveEnv,RAILWAY_ENVIRONMENT_ID:stage}),null);
 assert.equal(configuredStripePaymentMode({...liveEnv,STRIPE_SECRET_KEY:"sk_test_mock"}),null);
 assert.equal(configuredStripePaymentMode({...liveEnv,STRIPE_LIVE_CHECKOUT_ENABLED:"false"}),null);
 assert.equal(configuredStripePaymentMode({...liveEnv,PUBLIC_CUSTOMER_LAUNCH_APPROVED:"false"}),null);
 assert.equal(configuredStripePaymentMode({...liveEnv,STRIPE_ACCOUNT_LIVE_REVIEW_APPROVED:"false"}),null);
 assert.equal(configuredStripePaymentMode({...liveEnv,STRIPE_WEBHOOK_SECRET:""}),null);
 const testEnv={RAILWAY_ENVIRONMENT_ID:stage,STRIPE_CHECKOUT_ENABLED:"true",
  STRIPE_SECRET_KEY:"sk_test_fixture",STRIPE_WEBHOOK_SECRET:secret};
 assert.equal(configuredStripePaymentMode(testEnv),"test");
 assert.equal(configuredStripePaymentMode({...testEnv,RAILWAY_ENVIRONMENT_ID:production}),null);
 assert.equal(configuredStripePaymentMode({...testEnv,STRIPE_SECRET_KEY:liveEnv.STRIPE_SECRET_KEY}),null);
 assert.equal(stripeSessionIdMatchesMode("cs_live_mock_paid","live"),true);
 assert.equal(stripeSessionIdMatchesMode("cs_live_mock_paid","test"),false);
 assert.equal(stripeSessionIdMatchesMode("cs_test_mock_paid","live"),false);
});
test("Stripe mode and signed event must match; never mix sandbox with live",async()=>{
 const {raw,signature}=signed(liveEvent);
 assert.equal(verifyStripePaymentEvent(raw,signature,secret,"live").livemode,true);
 assert.throws(()=>verifyStripePaymentEvent(raw,signature,secret,"test"),/mode mismatch/);
 await assert.rejects(stripeCheckoutAdapter(secret,"test").verify(raw,signature),/mode mismatch/);
 const receipt=await stripeCheckoutAdapter(secret,"live").verify(raw,signature);
 assert.deepEqual({orderId:receipt.orderId,price:receipt.cents,evidence:receipt.evidence},
  {orderId,price:250,evidence:"cs_live_mock_paid"});
 const tampered=signed({...liveEvent,livemode:false});
 assert.throws(()=>verifyStripePaymentEvent(tampered.raw,tampered.signature,secret,"live"),/mode mismatch/);
 const mismatchedId=signed({...liveEvent,data:{object:{...liveEvent.data.object,id:"cs_test_mock_paid"}}});
 await assert.rejects(stripeCheckoutAdapter(secret,"live").verify(mismatchedId.raw,mismatchedId.signature),/not eligible/);
 const unpaid=signed({...liveEvent,data:{object:{...liveEvent.data.object,payment_status:"unpaid"}}});
 await assert.rejects(stripeCheckoutAdapter(secret,"live").verify(unpaid.raw,unpaid.signature),/not eligible/);
 await assert.rejects(stripeCheckoutAdapter(secret,"live").verify(raw,signature+"f"),/signature/);
});
test("Signed delayed payment succeeds only with final paid status",async()=>{
 const settled=signed({...liveEvent,id:"evt_mock_async_succeeded_1",
  type:"checkout.session.async_payment_succeeded"});
 const receipt=await stripeCheckoutAdapter(secret,"live").verify(settled.raw,settled.signature);
 assert.equal(receipt.evidence,"cs_live_mock_paid");
 assert.equal(receipt.cents,250);
 const pending=signed({...liveEvent,id:"evt_mock_async_pending_1",
  data:{object:{...liveEvent.data.object,payment_status:"unpaid"}}});
 await assert.rejects(stripeCheckoutAdapter(secret,"live").verify(pending.raw,pending.signature),/not eligible/);
});
test("Live Checkout sessions require actual live metadata, cents and strict Stripe host",()=>{
 const valid={id:"cs_live_mock_paid",livemode:true,url:"https://checkout.stripe.com/c/pay/cs_live_mock_paid",
  mode:"payment",currency:"eur",amount_total:250,metadata:{orderId}};
 assert.deepEqual(verifiedStripeCheckoutSession(valid,orderId,250,"live"),
  {id:valid.id,url:valid.url});
 for(const bad of [
  {...valid,livemode:false},
  {...valid,id:"cs_test_mock_paid"},
  {...valid,amount_total:499},
  {...valid,metadata:{orderId:"22222222-2222-4222-8222-222222222222"}},
  {...valid,mode:"subscription"},
  {...valid,currency:"usd"},
  {...valid,url:"https://checkout.stripe.com.evil.test/pay"},
  {...valid,url:"http://checkout.stripe.com/pay"},
 ]){
  assert.throws(()=>verifiedStripeCheckoutSession(bad,orderId,250,"live"));
 }
 assert.throws(()=>verifiedStripeCheckoutSession(valid,orderId,250,"test"));
});
test("Verified live receipt can settle only its immutable live-bound order once",async()=>{
 const store=new CommerceStore(":memory:");
 try{
  const order=store.order({account:null,email:"customer@example.test",
   project:"project-live-fixture",cents:250,quoteEvidence:"immutable-reviewed-fixture-evidence",key:"live-fixture"});
  store.bindStripeCheckout(order.id,"cs_live_mock_paid");
  assert.throws(()=>store.bindStripeCheckout(order.id,"cs_test_mock_paid"),/conflict/);
  const {raw,signature}=signed({...liveEvent,data:{object:{
   ...liveEvent.data.object,metadata:{orderId:order.id}}}});
  const adapter=stripeCheckoutAdapter(secret,"live");
  await store.webhook(raw,signature,adapter);
  await store.webhook(raw,signature,adapter);
  assert.equal(store.db.prepare("SELECT status FROM customer_orders WHERE id=?").get(order.id)?.status,"paid");
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM payment_events").get()?.n,1);
  assert.equal(store.db.prepare("SELECT state FROM customer_fulfillment_queue WHERE order_id=?").get(order.id)?.state,"pending");
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM customer_fulfillment_queue").get()?.n,1);
 }finally{store.close()}
});
