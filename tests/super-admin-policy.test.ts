import test from "node:test";
import assert from "node:assert/strict";
import { superAdminStudioPolicy } from "../lib/live/super-admin-policy.ts";
import { planUpperBoundMicroUsd } from "../lib/live/contract.ts";
import type { StudioPolicy } from "../lib/live/studio-policy.ts";

const root: StudioPolicy = {
  reviewedBy: "Prior operator review",
  reviewedAt: "2026-01-01T00:00:00Z",
  expiresAt: "2026-10-01T00:00:00Z",
  billingEvidence: "Five-second pilot price only",
  outputEvidence: "Existing exact output host and transport confirmed for the pilot",
  contract: {
    revision: "test-contract-v1", model: "OmniHuman 2.0",
    documentationUrl: "https://example.test/docs", maxDurationSeconds: 300,
    promptSupported: true, inputFetchWindowSeconds: 44100,
    generatedDurationBound: { minInputSeconds: 4, maxInputSeconds: 5, maxAdditionalSeconds: 1, evidence: "Short-range only" },
    billing: { microUsdPerSecond: 70000, minimumBillableMs: null, billingQuantumMs: null, minimumChargeMicroUsd: null, fixedFeeMicroUsd: null, taxBasisPointsUpperBound: null },
    output: { videoCodec: "h264", audioCodec: "aac", width: 720, height: 1280, fps: 24, durationToleranceSeconds: 0,
      maxDurationSeconds: 6 },
    outputHosts: ["media.example.test"],
    pilotAdmission: { maxGeneratedSeconds: 6, inclusiveMaxMicroUsd: 499800, planningUpliftBasisPoints: 1900, evidence: "Short pilot allowance", durationEvidence: "Prior short pilot duration review" }
  }
};
test("super-admin server-owned policy supports 300 seconds without inheriting expired test-budget admission", () => {
  const policy = superAdminStudioPolicy(root);
  assert.equal(policy.durationBands, undefined);
  assert.equal(policy.contract.generatedDurationBound?.maxInputSeconds, 300);
  assert.equal(policy.contract.pilotAdmission?.maxGeneratedSeconds, 300);
  assert.equal(policy.contract.pilotAdmission?.inclusiveMaxMicroUsd, 24990000);
  assert.equal(planUpperBoundMicroUsd(300, policy.contract), 24990000);
  assert.equal(policy.contract.outputHosts[0], "media.example.test");
  assert.equal(policy.contract.output.transfer?.maxBytes, 100 * 1024 * 1024);
  assert.equal(root.contract.generatedDurationBound?.maxInputSeconds, 5);
});
