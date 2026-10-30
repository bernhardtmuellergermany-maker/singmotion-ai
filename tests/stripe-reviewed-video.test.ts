import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewedVideoInputDigest, reviewedVideoQuoteDigest } from "../lib/commerce/reviewed-video.ts";
import type { PreparedMedia } from "../lib/live/store.ts";
import { CommerceStore } from "../lib/commerce/store.ts";

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
    assert.equal(store.bindPreparedOrderMedia(id, media), true);
    assert.equal(store.bindPreparedOrderMedia(id, media), false);
    assert.throws(() => store.bindPreparedOrderMedia(id, {...media,prompt:"different performance"}), /conflict/);
    const actual = store.db.prepare("SELECT input_digest,review_digest FROM customer_order_inputs WHERE order_id=?").get(id);
    const digest = reviewedVideoInputDigest(media);
    assert.equal(actual?.input_digest, digest);
    assert.equal(actual?.review_digest, reviewedVideoQuoteDigest(digest,1250,"verified-inclusive-price-2026"));
  } finally { store.close(); }
});
