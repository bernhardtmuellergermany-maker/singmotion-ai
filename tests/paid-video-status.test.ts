import {test} from "node:test";
import assert from "node:assert/strict";
import {CommerceStore} from "../lib/commerce/store.ts";
import type {PreparedMedia} from "../lib/live/store.ts";
import {pollPaidVideoStatus} from "../lib/commerce/paid-video-status.ts";

test("paid status lookup never calls BytePlus without acknowledged job", async()=>{
 const store=new CommerceStore(":memory:");
 try {
  const id="11111111-1111-4111-8111-111111111111";
  let reads=0;
  assert.equal(await pollPaidVideoStatus(store,id,async()=>{reads++;return "done";}),"awaiting-submission-review");
  assert.equal(reads,0);
 }finally{store.close()}
});
test("read-only paid status reports uncertainty without dispatching or recording delivery",async()=>{
 const store=new CommerceStore(":memory:");
 try {
  const id=store.preparedVideoOrder({account:null,email:"buyer@example.test",project:"poll-demo",cents:1250,quoteEvidence:"reviewed-verified-quote-2026",key:"read-only-status-test",media:{
    owner:"sample",audioPath:"/private/audio.mp3",imagePath:"/private/image.png",
    audioSha256:"a".repeat(64),imageSha256:"b".repeat(64),
    durationSeconds:5,prompt:"natural performance",outputFormat:"9:16"
  } as PreparedMedia}).id;
  store.bindStripeCheckout(id,"cs_test_readonly");
  await store.webhook(new Uint8Array(),"signed",{async verify(){return {
   provider:"stripe",eventId:"evt_readonly",orderId:id,cents:1250,
   currency:"EUR" as const,evidence:"cs_test_readonly"
  }}});
  assert.equal(store.claimPaidFulfillment(id),true);
  assert.equal(store.beginPaidProviderSubmission(id),true);
  store.recordPaidProviderJob(id,"byteplus","task_readonly");
  assert.equal(await pollPaidVideoStatus(store,id,async job=>{assert.equal(job,"task_readonly");return "generating";}),"pending");
  assert.equal(await pollPaidVideoStatus(store,id,async()=> "done"),"provider-completed");
  assert.equal(await pollPaidVideoStatus(store,id,async()=> "expired"),"outcome-unverified");
  assert.equal(await pollPaidVideoStatus(store,id,async()=>{throw Error("network unavailable")}),"outcome-unverified");
  assert.equal(store.db.prepare("SELECT state FROM customer_fulfillment_queue WHERE order_id=?").get(id)?.state,"processing");
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM customer_video_deliveries").get()?.n,0);
 }finally{store.close()}
});
