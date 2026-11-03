import {test} from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {verifyStripeSandboxEvent,stripeCheckoutAdapter,readBoundedStripeWebhookBody,StripeWebhookPayloadTooLarge} from "../lib/commerce/stripe-webhook.ts";

const secret="whsec_test_signing_secret_2026";
const event=(livemode=false)=>({id:"evt_test_signed_1",type:"checkout.session.completed",livemode,
 data:{object:{object:"checkout.session",id:"cs_test_signed_1",mode:"payment",
 payment_status:"paid",currency:"eur",amount_total:250,
 metadata:{orderId:"11111111-1111-4111-8111-111111111111"}}}});
function signed(value:unknown,when=Math.floor(Date.now()/1000)){
 const raw=Buffer.from(JSON.stringify(value));
 const digest=createHmac("sha256",secret).update(Buffer.concat([Buffer.from(String(when)+"."),raw])).digest("hex");
 return {raw,signature:"t="+when+",v1="+digest};
}
test("correct signed sandbox checkout yields server-verified payment receipt",async()=>{
 const {raw,signature}=signed(event());
 const actual=await stripeCheckoutAdapter(secret).verify(raw,signature);
 assert.equal(actual.cents,250);
 assert.equal(actual.evidence,"cs_test_signed_1");
});
test("Stripe webhook rejects modified payload, wrong key, stale signature and live events",()=>{
 const good=signed(event());
 assert.throws(()=>verifyStripeSandboxEvent(Buffer.from(JSON.stringify(event(true))),good.signature,secret),/signature/);
 assert.throws(()=>verifyStripeSandboxEvent(good.raw,good.signature,"whsec_wrong"),/signature/);
 const stale=signed(event(),Math.floor(Date.now()/1000)-400);
 assert.throws(()=>verifyStripeSandboxEvent(stale.raw,stale.signature,secret),/signature/);
 const live=signed(event(true));
 assert.throws(()=>verifyStripeSandboxEvent(live.raw,live.signature,secret),/sandbox/);
});
test("a signed unpaid checkout is not a verified payment",async()=>{
 const unpaid=event();
 unpaid.data.object.payment_status="unpaid";
 const {raw,signature}=signed(unpaid);
 await assert.rejects(stripeCheckoutAdapter(secret).verify(raw,signature),/not eligible/);
});

test("bounded Stripe webhook reader rejects oversized or dishonest content-length before processing",async()=>{
 const large=Buffer.alloc(128*1024+1,0x61);
 await assert.rejects(readBoundedStripeWebhookBody(new Request("https://example.test/webhook",{
  method:"POST",body:large
 })),StripeWebhookPayloadTooLarge);
 const claimed=new Request("https://example.test/webhook",{method:"POST",body:"small",
  headers:{"content-length":String(128*1024+1)}});
 await assert.rejects(readBoundedStripeWebhookBody(claimed),StripeWebhookPayloadTooLarge);
 const malformed=new Request("https://example.test/webhook",{method:"POST",body:"small",
  headers:{"content-length":"untrusted"}});
 await assert.rejects(readBoundedStripeWebhookBody(malformed),StripeWebhookPayloadTooLarge);
 const payload=Buffer.from("signed-stripe-sandbox-fixture");
 assert.deepEqual(Buffer.from(await readBoundedStripeWebhookBody(new Request(
  "https://example.test/webhook",{method:"POST",body:payload
 }))),payload);
});
test("Stripe webhook streamed body limit holds without content-length",async()=>{
 let cancelled=false;
 const stream=new ReadableStream<Uint8Array>({
  start(controller){
   controller.enqueue(new Uint8Array(80000));
   controller.enqueue(new Uint8Array(80000));
  },
  cancel(){cancelled=true;}
 });
 await assert.rejects(readBoundedStripeWebhookBody(new Request(
  "https://example.test/webhook",{method:"POST",body:stream,duplex:"half"} as RequestInit
 )),StripeWebhookPayloadTooLarge);
 assert.equal(cancelled,true);
});
