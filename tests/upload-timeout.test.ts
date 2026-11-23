import { test } from "node:test";
import assert from "node:assert/strict";
import {
  uploadRequestTimeoutMs,
  SMALL_UPLOAD_TIMEOUT_MS,
  LARGE_UPLOAD_TIMEOUT_MS,
  LARGE_UPLOAD_THRESHOLD_BYTES,
} from "../lib/upload-timeout.ts";

test("45 MiB WAV can remain connected while the server verifies it", () => {
  assert.equal(uploadRequestTimeoutMs(45 * 1024 * 1024), 12 * 60 * 1000);
  assert.equal(uploadRequestTimeoutMs(50 * 1024 * 1024), LARGE_UPLOAD_TIMEOUT_MS);
});

test("small audio and images keep the shorter XMLHttpRequest deadline", () => {
  assert.equal(uploadRequestTimeoutMs(3 * 1024 * 1024), SMALL_UPLOAD_TIMEOUT_MS);
  assert.equal(uploadRequestTimeoutMs(LARGE_UPLOAD_THRESHOLD_BYTES - 1), SMALL_UPLOAD_TIMEOUT_MS);
  assert.equal(uploadRequestTimeoutMs(LARGE_UPLOAD_THRESHOLD_BYTES), LARGE_UPLOAD_TIMEOUT_MS);
});

test("large-browser timeout stays under Railway's 15-minute request maximum", () => {
  assert.ok(LARGE_UPLOAD_TIMEOUT_MS < 15 * 60 * 1000);
});
