import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewedVideoInputDigest, reviewedVideoQuoteDigest } from "../lib/commerce/reviewed-video.ts";
import type { PreparedMedia } from "../lib/live/store.ts";
import { CommerceStore } from "../lib/commerce/store.ts";
import { submitReviewedPaidVideo } from "../lib/commerce/paid-video-worker.ts";

const media = {
  audioSha256: "a".repeat(64), imageSha256: "b".repeat(64),
  durationSeconds: 8.1234, prompt: "Sing naturally, camera static.", outputFormat: "9:16",
} as PreparedMedia;

test("review commitments include actual prepared audio, image, prompt and output format", () => {
  const a = reviewedVideoInputDigest(media);
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.equal(a, reviewedVideoInputDigest({...media}));
  for (const change of [
    {audioSha256:"c".repeat(64)}, {imageSha256:"c".repeat(64)},
    {prompt:"Move the camera."}, {durationSeconds:9.5}, {outputFormat:"16:9" as const},
  ]) assert.notEqual(a,reviewedVideoInputDigest({...media,...change}));
  const quote = reviewedVideoQuoteDigest(a,1250,"verified-inclusive-price-2026");
  assert.notEqual(quote,reviewedVideoQuoteDigest(a,1300,"verified-inclusive-price-2026"));
  assert.throws(()=>reviewedVideoInputDigest({...media,audioSha256:"browser-id"}),/reviewed/i);
  assert.throws(()=>reviewedVideoQuoteDigest(a,0,"verified-inclusive-price-2026"),/reviewed/i);
});

test("server-owned quote controls binding of actual prepared media to customer order", () => {
  const store = new CommerceStore(":memory:");
  try {
    const id = store.order({
      account:null,email:"customer@example.test",project:"studio-reviewed-project",
      cents:1250,quoteEvidence:"verified-inclusive-price-2026",key:"prepared-media-binding",
    }).id;
    assert.equal(store.reviewedOrderReadyForCheckout(id), false);
    assert.equal(store.bindPreparedOrderMedia(id, media), true);
    assert.equal(store.reviewedOrderReadyForCheckout(id), true);
    assert.equal(store.bindPreparedOrderMedia(id, media), false);
    assert.throws(() => store.bindPreparedOrderMedia(id, {...media,prompt:"different performance"}), /conflict/);
    const actual = store.db.prepare("SELECT input_digest,review_digest FROM customer_order_inputs WHERE order_id=?").get(id);
    const digest = reviewedVideoInputDigest(media);
    assert.equal(actual?.input_digest, digest);
    assert.equal(actual?.review_digest, reviewedVideoQuoteDigest(digest,1250,"verified-inclusive-price-2026"));
  } finally { store.close(); }
});

test("trusted checkout preparation is atomic for validated media and reviewed quote", () => {
  const store = new CommerceStore(":memory:");
  try {
    const request = {account:null,email:"buyer@example.test",project:"verified-project",
      cents:1250,quoteEvidence:"verified-inclusive-price-2026",key:"atomic-prepared-order",media};
    assert.throws(() => store.preparedVideoOrder({...request,media:{...media,audioSha256:"invalid"}}),/prepared/);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM customer_orders").get()?.n,0);
    const created = store.preparedVideoOrder(request);
    assert.equal(store.reviewedOrderReadyForCheckout(created.id),true);
    assert.throws(() => store.preparedVideoOrder({...request,media:{...media,prompt:"Different camera"}}),/conflict/);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM customer_orders").get()?.n,1);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM customer_order_inputs").get()?.n,1);
  } finally {store.close();}
});

test("paid customer media cannot be changed after review before BytePlus dispatch", async () => {
  const store = new CommerceStore(":memory:");
  try {
    const created = store.preparedVideoOrder({
      account:null,email:"buyer@example.test",project:"verified-video",
      cents:1250,quoteEvidence:"verified-inclusive-price-2026",
      key:"verified-paid-dispatch",media,
    });
    const id = created.id;
    assert.throws(() => store.assertPaidOrderMediaUnchanged(id,media),/Claimed/);
    store.bindStripeCheckout(id,"cs_test_verified_dispatch");
    await store.webhook(new Uint8Array(),"signed",{async verify(){return {
      provider:"stripe",eventId:"evt_verified_dispatch",orderId:id,
      cents:1250,currency:"EUR" as const,evidence:"cs_test_verified_dispatch",
    };}});
    assert.equal(store.claimPaidFulfillment(id),true);
    assert.doesNotThrow(() => store.assertPaidOrderMediaUnchanged(id,media));
    assert.throws(() => store.assertPaidOrderMediaUnchanged(id,{...media,prompt:"Modified camera"}),/changed/);
    assert.throws(() => store.assertPaidOrderMediaUnchanged(id,{...media,imageSha256:"c".repeat(64)}),/changed/);
    assert.equal(store.paidSubmissionStatus(id),null);
  } finally {store.close();}
});

test("trusted worker dispatches verified paid media exactly once", async () => {
  const store=new CommerceStore(":memory:");
  try {
    const id=store.preparedVideoOrder({account:null,email:"buyer@example.test",
      project:"verified-worker",cents:1250,quoteEvidence:"verified-inclusive-price-2026",
      key:"verified-worker",media}).id;
    store.bindStripeCheckout(id,"cs_test_worker");
    await store.webhook(new Uint8Array(),"signed",{async verify(){return {
      provider:"stripe",eventId:"evt_worker",orderId:id,cents:1250,
      currency:"EUR" as const,evidence:"cs_test_worker",
    };}});
    let submits=0;
    const ops={prepare:async()=>media,submit:async()=>{submits++;return "provider_job_123";}};
    assert.equal(await submitReviewedPaidVideo(store,id,ops),"submitted");
    assert.equal(await submitReviewedPaidVideo(store,id,ops),"already-claimed");
    assert.equal(submits,1);
    assert.equal(store.paidProviderJob(id)?.jobId,"provider_job_123");
  } finally {store.close();}
});
