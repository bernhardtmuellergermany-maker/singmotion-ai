import {test} from "node:test";
import assert from "node:assert/strict";
import {CommerceStore} from "../lib/commerce/store.ts";
import {deliverReviewedPaidVideo,deliveredPaidVideoDurationSeconds} from "../lib/commerce/paid-video-delivery.ts";
import type {OutputValidationContract} from "../lib/live/output.ts";

test("private paid MP4 ingestion refuses an unpaid order before any download",async()=>{
 const store=new CommerceStore(":memory:");
 try{
  const id=store.order({account:"11111111-1111-4111-8111-111111111111",email:"customer@example.test",project:"safe-output",cents:1250,
   quoteEvidence:"verified-output-quote-2026",key:"unpaid-output-rejection"}).id;
  let calls=0;
  await assert.rejects(deliverReviewedPaidVideo(store,id,"https://example.org/result.mp4","/tmp",{} as OutputValidationContract,
   async()=>{calls++;throw Error("Unexpected provider download");}),/Paid customer order required/);
  assert.equal(calls,0);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM customer_video_deliveries").get()?.n,0);
 }finally{store.close()}
});
test("private paid MP4 ingestion requires a confirmed claimed provider job",async()=>{
 const store=new CommerceStore(":memory:");
 try{
  const id=store.order({account:"11111111-1111-4111-8111-111111111111",email:"customer@example.test",project:"unclaimed-output",cents:1250,
   quoteEvidence:"verified-output-quote-2026",key:"unclaimed-output-rejection"}).id;
  store.bindStripeCheckout(id,"cs_test_output_gate");
  await store.webhook(new Uint8Array(),"signed",{async verify(){return {
   provider:"stripe",eventId:"evt_output_gate",orderId:id,cents:1250,
   currency:"EUR" as const,evidence:"cs_test_output_gate"
  }}});
  let calls=0;
  await assert.rejects(deliverReviewedPaidVideo(store,id,"https://example.org/result.mp4","/tmp",{} as OutputValidationContract,
   async()=>{calls++;throw Error("Unexpected provider download");}),/Acknowledged, claimed BytePlus job required/);
  assert.equal(calls,0);
 }finally{store.close()}
});


test("a restored 0.9x customer MP4 is stored with original playback duration, not billed provider duration",()=>{
 const originalSeconds=90;
 const providerSeconds=100;
 assert.equal(deliveredPaidVideoDurationSeconds({durationSeconds:providerSeconds,
  tempo:{rate:0.9,originalDuration:originalSeconds}}),originalSeconds);
 assert.equal(deliveredPaidVideoDurationSeconds({durationSeconds:5.556,
  tempo:{rate:0.9,originalDuration:5}}),5);
 assert.equal(deliveredPaidVideoDurationSeconds({durationSeconds:299.999}),299.999);
 assert.equal(deliveredPaidVideoDurationSeconds({durationSeconds:5}),5);
});

test("customer MP4 metadata rejects corrupt or unreviewed restored duration without changing a paid order",()=>{
 for(const [durationSeconds,originalDuration,rate] of [
  [100,89,0.9],[100,91,0.9],[100,90,1],[100,301,0.9],
  [300,0,0.9],[Infinity,5,0.9],[100,NaN,0.9],
 ] as const){
  assert.throws(()=>deliveredPaidVideoDurationSeconds({durationSeconds,
   tempo:{rate,originalDuration}}),/customer video duration|tempo duration/i);
 }
 for(const seconds of [0,4.99,301,NaN,Infinity])
  assert.throws(()=>deliveredPaidVideoDurationSeconds({durationSeconds:seconds}),
   /Invalid restored customer video duration/);
});
