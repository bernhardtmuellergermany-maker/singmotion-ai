import assert from "node:assert/strict";
import { test } from "node:test";
import { studioFailedProjectStage } from "../lib/live/studio.ts";

test("failed Studio project exposes a safe durable provider code", () => {
  assert.match(studioFailedProjectStage("PROVIDER_JOB_FAILED", null), /\[PROVIDER_JOB_FAILED\]/);
  assert.match(studioFailedProjectStage("CONTENT_PREFILTER_REJECTED", null), /BytePlus rejected/);
  assert.match(studioFailedProjectStage("MISSING_OUTPUT", null), /output URL/);
});
test("failed Studio project never leaks legacy raw diagnostics", () => {
  const message = studioFailedProjectStage("SENSITIVE:http://example.net/token", "user-token https://signed.example/key");
  assert.match(message, /\[FAILED_WITHOUT_CODE\]/);
  assert.doesNotMatch(message, /signed\.example|user-token|http:/);
  assert.match(message, /Do not submit the same paid task again/);
});
