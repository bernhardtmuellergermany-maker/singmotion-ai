import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewedVideoInputDigest, reviewedVideoQuoteDigest } from "../lib/commerce/reviewed-video.ts";
import type { PreparedMedia } from "../lib/live/store.ts";

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
