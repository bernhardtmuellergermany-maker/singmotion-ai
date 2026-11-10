import {test} from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {CommerceStore} from "../lib/commerce/store.ts";
import {stripeCheckoutAdapter} from "../lib/commerce/stripe-webhook.ts";
import {submitReviewedPaidVideo} from "../lib/commerce/paid-video-worker.ts";
import {ownedCustomerOrderStatuses,customerOrderStatusFilter} from "../lib/commerce/customer-orders-query.ts";
import {retryVideoReadyNotifications,videoReadyEmailText,orderReference,videoReference} from "../lib/commerce/video-ready-notifications.ts";
import {requestGuestOrderRecovery,redeemGuestOrderRecovery} from "../lib/commerce/guest-video-recovery.ts";
import type {PreparedMedia} from "../lib/live/store.ts";

const guestOwner="92319732-158d-4795-afbb-fb94b0f43918";
const env={
 RAILWAY_ENVIRONMENT_ID:"dfaeabed-03df-43ed-aa71-50f343a75041",
 CUSTOMER_ACCOUNTS_ENABLED:"true",APP_ORIGIN:"https://singmotion-ai-staging.up.railway.app",
 RESEND_API_KEY:"re_synthetic_offline",ACCOUNT_EMAIL_FROM:"SingMotion <noreply@example.test>",
};
const media:PreparedMedia={owner:guestOwner,audioPath:"/private/audio.mp3",imagePath:"/private/img.png",
 audioSha256:"a".repeat(64),imageSha256:"b".repeat(64),durationSeconds:10,
 prompt:"Natural singing performance",outputFormat:"9:16"} as PreparedMedia;
const secret="whsec_guest_mail_tests";
function payment(orderId:string,checkout:string){
 const event={id:"evt_video_ready_"+orderId.replaceAll("-",""),livemode:false,
  type:"checkout.session.completed",data:{object:{id:checkout,object:"checkout.session",
    mode:"payment",payment_status:"paid",currency:"eur",amount_total:250,metadata:{orderId}}}};
 const raw=Buffer.from(JSON.stringify(event)),t=String(Math.floor(Date.now()/1000));
 const signature="t="+t+",v1="+createHmac("sha256",secret).update(t+".").update(raw).digest("hex");
 return {raw,signature};
}
async function prepareDeliveredGuest(store:CommerceStore){
 const order=store.preparedVideoOrder({account:null,email:"buyer@example.test",
  project:"video-mail",cents:250,quoteEvidence:"verified-guest-billing-snapshot-2026",
  key:"video-mail-unique-guest",media});
 const checkout="cs_test_guest_mail";
 store.bindStripeCheckout(order.id,checkout);
 const paid=payment(order.id,checkout);
 await store.webhook(paid.raw,paid.signature,stripeCheckoutAdapter(secret));
 assert.equal(await submitReviewedPaidVideo(store,order.id,{
  verify:async()=>{},
  providerCost:{inclusiveMaxMicroUsd:700000,dailyCapMicroUsd:5000000,
   lifetimeCapMicroUsd:25000000,reviewEvidence:"reviewed-offline-guest-generation-cost"},
  submit:async()=> "byteplus-guest-mail-verified",
 }),"submitted");
 store.recordPaidVideoDelivery(order.id,"private-guest-video-001","sha256-readback-verified-private-mp4");
 assert.equal(store.finalizePaidFulfillment(order.id,{
  state:"delivered",deliveryEvidence:"private-r2-verified-byteplus-guest-output-2026"}),true);
 return order;
}
test("Completion email is sent only after validated paid delivery, once across worker retries",async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),"sm-video-ready-"));
 const file=path.join(dir,"commerce.sqlite");
 const sent:Array<{to:string[];text:string;subject:string}>=[];
 const sender:typeof fetch=async(_url,opts)=>{
  const mail=JSON.parse(String(opts?.body));
  sent.push(mail);
  return new Response(null,{status:202});
 };
 try{
  const store=new CommerceStore(file);
  const order=store.preparedVideoOrder({account:null,email:"buyer@example.test",
   project:"not-ready",cents:250,quoteEvidence:"verified-incomplete-guest-video-2026",
   key:"guest-not-ready",media});
  assert.deepEqual(await retryVideoReadyNotifications(file,env,sender),{attempted:0,sent:0});
  assert.equal(sent.length,0);
  const delivered=await prepareDeliveredGuest(store);
  assert.deepEqual(await retryVideoReadyNotifications(file,env,sender),{attempted:1,sent:1});
  assert.equal(sent.length,1);
  assert.deepEqual(sent[0].to,["buyer@example.test"]);
  for(const ref of [orderReference(delivered.id),videoReference(delivered.id),"/orders/"+delivered.id])
   assert.ok(sent[0].text.includes(ref));
  assert.ok(!sent[0].text.includes(delivered.guestToken!),"bearer guest access must never be emailed");
  assert.deepEqual(await retryVideoReadyNotifications(file,env,sender),{attempted:0,sent:0});
  assert.equal(sent.length,1);
  assert.ok(!sent[0].text.includes(order.id),"unfulfilled order must never appear in completed mail");
  store.close();
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test("Guest recovery token rotates private link; verified matching account can claim only with secret proof",async()=>{
 const store=new CommerceStore(":memory:");
 try{
  const guest=store.preparedVideoOrder({account:null,email:"buyer@example.test",
   project:"recovery",cents:250,quoteEvidence:"verified-guest-video-recovery-2026",
   key:"guest-recovery-fixture",media});
  const messages:string[]=[];
  const sender:typeof fetch=async(_url,opts)=>{
   const body=JSON.parse(String(opts?.body));
   messages.push(body.text);return new Response(null,{status:202});
  };
  assert.equal(await requestGuestOrderRecovery(store,guest.id,"wrong@example.test",env,sender),false);
  assert.equal(messages.length,0);
  assert.equal(await requestGuestOrderRecovery(store,guest.id,"buyer@example.test",env,sender),true);
  const match=messages[0].match(/#recover=([A-Za-z0-9_-]{43})/);
  assert.ok(match);
  assert.equal(redeemGuestOrderRecovery(store,guest.id,"invalid"),null);
  const renewed=redeemGuestOrderRecovery(store,guest.id,match![1]);
  assert.ok(renewed);
  assert.equal(redeemGuestOrderRecovery(store,guest.id,match![1]),null);
  assert.throws(()=>store.ownedOrder(guest.id,null,guest.guestToken!),/unavailable/);
  assert.equal(store.ownedOrder(guest.id,null,renewed!).id,guest.id);
  const other=store.register("other@example.test","Very secure user password 2026");
  const buyer=store.register("buyer@example.test","Very secure user password 2026");
  const verify=store.issueEmailVerification(buyer)!;
  assert.equal(store.verifyEmailToken(verify.token),true);
  assert.throws(()=>store.claimGuestOrder(guest.id,other,renewed!),/matching customer email/);
  assert.equal(store.claimGuestOrder(guest.id,buyer,renewed!),true);
  assert.equal(store.claimGuestOrder(guest.id,buyer,renewed!),false);
  assert.equal(store.guestMediaOwner(guest.id),guestOwner,"do not mutate paid video ownership");
  assert.equal(store.ownedOrder(guest.id,buyer).id,guest.id);
  assert.throws(()=>store.ownedOrder(guest.id,other),/unavailable/);
  const mine=ownedCustomerOrderStatuses(store.db,buyer,customerOrderStatusFilter(guest.id,null));
  assert.equal(mine.length,1);
  assert.equal(mine[0].orderId,guest.id);
  assert.equal(ownedCustomerOrderStatuses(store.db,other,customerOrderStatusFilter(guest.id,null)).length,0);
 }finally{store.close()}
});
test("Completion email never leaks secret URL or BytePlus task identifiers",()=>{
 const id="a26d977e-37da-442a-955e-63ce505ac3b1";
 const text=videoReadyEmailText(id,"https://www.singmotion.ai",true);
 assert.match(text,/VID-/);
 assert.match(text,/SM-/);
 assert.doesNotMatch(text,/#access=|#recover=|tiktokcdn|byteplus-task/i);
});
