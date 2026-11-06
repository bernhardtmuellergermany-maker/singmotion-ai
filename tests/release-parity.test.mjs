import { test } from "node:test";
import assert from "node:assert/strict";
import { assessPromotion } from "../scripts/release-parity.mjs";

const a = "a".repeat(40);
const b = "b".repeat(40);
const valid = {
  stagingSha: a, candidateSha: a, stagingStatus: "SUCCESS",
  stagingBuilder: "RAILPACK", productionBuilder: "RAILPACK",
};
test("only the exact successfully deployed staging commit is promotable", () => {
  assert.equal(assessPromotion(valid).permitted, true);
  assert.equal(assessPromotion({ ...valid, candidateSha: b }).permitted, false);
  assert.equal(assessPromotion({ ...valid, stagingSha: "main" }).permitted, false);
  assert.equal(assessPromotion({ ...valid, stagingStatus: "BUILDING" }).permitted, false);
  assert.equal(assessPromotion({ ...valid, stagingStatus: "FAILED" }).permitted, false);
});
test("different build systems, unknown metadata or mismatched images fail closed", () => {
  assert.equal(assessPromotion({ ...valid, productionBuilder: "NIXPACKS" }).permitted, false);
  assert.equal(assessPromotion({ ...valid, stagingBuilder: "" }).permitted, false);
  assert.equal(assessPromotion({ ...valid, stagingImageDigest: "sha256:" + "1".repeat(64) }).permitted, false);
  assert.equal(assessPromotion({
    ...valid,
    stagingImageDigest: "sha256:" + "1".repeat(64),
    candidateImageDigest: "sha256:" + "2".repeat(64),
  }).permitted, false);
  assert.equal(assessPromotion({
    ...valid,
    stagingImageDigest: "sha256:" + "1".repeat(64),
    candidateImageDigest: "sha256:" + "1".repeat(64),
  }).permitted, true);
  assert.equal(assessPromotion().permitted, false);
});
