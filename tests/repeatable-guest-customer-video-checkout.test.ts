import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {CommerceStore} from "../lib/commerce/store.ts";
import {stripeCheckoutAdapter} from "../lib/commerce/stripe-webhook.ts";
import {resolveVideoCheckoutOwner} from "../lib/commerce/video-checkout-owner.ts";
import type {PreparedMedia} from "../lib/live/store.ts";

/**
 * Offline, no-card/no-provider acceptance regression:
 * repeated independent paid video orders must work for account and guest
 * without a lifetime video-count quota. This intentionally does NOT assert
 * unbounded concurrency, free provider usage or public Production approval.
 */
const secret="whsec_repeatable_offline_fixture";
const costCents=250;
function media(owner:string,index:number):PreparedMedia {
 return {
  owner,audioPath:"/private/audio-"+index+".mp3",
  imagePath:"/private/portrait-"+index+".png",
  audioSha256:index.toString(16).padStart(64,"a"),
  imageSha256:index.toString(16).padStart(64,"b"),
  durationSeconds:10,prompt:"Natural singing performance",outputFormat:"9:16",
 } as PreparedMedia;
}
function payment(orderId:string,checkoutId:string,index:number) {
 const event={
  id:"evt_repeat_video_"+index,livemode:false,
  type:"checkout.session.completed",
  data:{object:{
   id:checkoutId,object:"checkout.session",mode:"payment",
   payment_status:"paid",currency:"eur",amount_total:costCents,
   metadata:{orderId},
  }},
 };
 const raw=Buffer.from(JSON.stringify(event));
 const timestamp=String(Math.floor(Date.now()/1000));
 const signature="t="+timestamp+",v1="+createHmac("sha256",secret)
  .update(timestamp+".").update(raw).digest("hex");
 return {raw,signature};
}

test("multiple independent guest and account video checkouts remain available, isolated, and replay-safe",async()=>{
 const store=new CommerceStore(":memory:");
 try {
  const account=store.register("repeatable@example.test","Long test password 2026!");
  const verifier=store.issueEmailVerification(account)!;
  assert.equal(store.verifyEmailToken(verifier.token),true);
  const other=store.register("unrelated@example.test","Another long test password 2026!");
  const guestOwner="aabbccdd-1111-4222-8333-444455556666";
  const guestTokens:string[]=[];
  const orderIds=new Set<string>();
  const adapter=stripeCheckoutAdapter(secret,"test");
  for(let index=0;index<12;index++){
   const guest=index%2===0;
   const created=store.preparedVideoOrder({
    account:guest?null:account,
    email:guest?"repeat-guest@example.test":"repeatable@example.test",
    project:"repeat-project-"+index,
    cents:costCents,
    quoteEvidence:"offline-reviewed-quote-"+index,
    key:"repeat-video-order-"+index,
    media:media(guest?guestOwner:"customer-"+account,index),
   });
   assert.ok(!orderIds.has(created.id),"each fresh request key creates a new order");
   orderIds.add(created.id);
   if(guest){
    assert.ok(created.guestToken);
    guestTokens.push(created.guestToken!);
    assert.equal(resolveVideoCheckoutOwner(store,created.id,other,created.guestToken!).kind,"guest");
    assert.throws(()=>resolveVideoCheckoutOwner(store,created.id,other,undefined),/owner required/);
   }else{
    assert.equal(resolveVideoCheckoutOwner(store,created.id,account,undefined).kind,"account");
    assert.throws(()=>resolveVideoCheckoutOwner(store,created.id,other,undefined),/owner required/);
   }
   const checkoutId="cs_test_repeat_video_"+index;
   store.bindStripeCheckout(created.id,checkoutId);
   const signed=payment(created.id,checkoutId,index);
   await store.webhook(signed.raw,signed.signature,adapter);
   await store.webhook(signed.raw,signed.signature,adapter);
   assert.equal(store.db.prepare(
    "SELECT COUNT(*) AS n FROM customer_fulfillment_queue WHERE order_id=?"
   ).get(created.id)?.n,1,"replayed payment must not queue twice");
  }
  assert.equal(orderIds.size,12);
  assert.equal(guestTokens.length,6);
  assert.equal(new Set(guestTokens).size,6,"guest orders must have independent capabilities");
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM customer_fulfillment_queue").get()?.n,12);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM payment_events").get()?.n,12);
 }finally{store.close()}
});
