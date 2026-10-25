import test from "node:test";
import assert from "node:assert/strict";
import { euroBudget } from "../lib/live/studio-budget.ts";
import {
  outputTransferLimits,
  downloadValidatedOutput,
} from "../lib/live/output.ts";
const proof = {
  eurPerUsdUpperPpm: 1000000,
  fxFeesMaxMicroEur: 1000000,
  evidence: "Mock rate and fee evidence",
  reviewedBy: "Mock",
  reviewedAt: new Date().toISOString(),
  validUntil: new Date(Date.now() + 86400000).toISOString(),
};
test("EUR 50 bound counts all reservations and retains the stricter USD cap", () => {
  assert.equal(euroBudget(proof, 49000000, 50000000).remainingMicroUsd, 0);
  assert.equal(euroBudget(proof, 49000000, 50000000).remainingMicroEur, 0);
  assert.equal(euroBudget(proof, 840000, 1000000).remainingMicroUsd, 160000);
  assert.equal(
    euroBudget({ ...proof, eurPerUsdUpperPpm: 1500000 }, 1, 50000000)
      .remainingMicroEur,
    48999998,
  );
  for (const p of [
    undefined,
    { ...proof, validUntil: "2000-01-01" },
    { ...proof, eurPerUsdUpperPpm: 0 },
    { ...proof, evidence: "" },
  ])
    assert.throws(
      () => euroBudget(p, 840000, 50000000),
      /EUR50_REVIEW_REQUIRED/,
    );
});
test("reviewed transfer bounds stay finite and reject oversize before writing", async () => {
  const c = {
    outputHosts: ["cdn.example.test"],
    output: {
      width: 1280,
      height: 720,
      fps: 25,
      durationToleranceSeconds: 1,
      transfer: {
        maxBytes: 128 * 1024 * 1024,
        timeoutMs: 150000,
        evidence: "Mock longer-media acceptance",
      },
    },
  };
  assert.equal(outputTransferLimits(c).maxBytes, 128 * 1024 * 1024);
  for (const limits of [
    { ...c.output.transfer, evidence: "" },
    { ...c.output.transfer, maxBytes: 257 * 1024 * 1024 },
    { ...c.output.transfer, timeoutMs: 180001 },
  ])
    assert.throws(() =>
      outputTransferLimits({ ...c, output: { ...c.output, transfer: limits } }),
    );
  let canceled = false;
  await assert.rejects(
    downloadValidatedOutput(
      "https://cdn.example.test/v.mp4",
      "/must-not-be-created.mp4",
      60,
      c,
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              canceled = true;
            },
          }),
          { headers: { "content-length": String(129 * 1024 * 1024) } },
        ),
    ),
    /too large/,
  );
  assert.equal(canceled, true);
});
