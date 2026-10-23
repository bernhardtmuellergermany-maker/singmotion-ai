import {
  LiveTestStore,
  confirmationPhrase,
  type PreparedMedia,
} from "../lib/live/store.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertBytePlusVerified,
  bytePlusVerification,
  planUpperBoundMicroUsd,
  type VerifiedContract,
} from "../lib/live/contract.ts";
import { enforceCap, liveTestConfig } from "../lib/live/config.ts";

// Fictional inclusive contract solely for arithmetic tests. Neither the tax
// assumption nor this duration envelope is a verified production contract.
const contract: VerifiedContract = {
  revision: "fictional-billing",
  model: "OmniHuman 2.0",
  documentationUrl: "https://example.test/mock",
  maxDurationSeconds: 300,
  promptSupported: true,
  inputFetchWindowSeconds: 44100,
  generatedDurationBound: {
    evidence: "mock exact-case review",
    minInputSeconds: 5,
    maxInputSeconds: 5,
    maxAdditionalSeconds: 1,
  },
  billing: {
    microUsdPerSecond: 70000,
    minimumBillableMs: 0,
    billingQuantumMs: 1000,
    minimumChargeMicroUsd: 0,
    fixedFeeMicroUsd: 0,
    taxBasisPointsUpperBound: 0,
  },
  output: { width: 1280, height: 720, fps: 25, durationToleranceSeconds: 1 },
  outputHosts: ["example.test"],
};

test("generated-video bound, not input duration, determines mock reservation", () => {
  assert.equal(planUpperBoundMicroUsd(5, contract), 420000);
  assert.equal(
    planUpperBoundMicroUsd(5, {
      ...contract,
      billing: { ...contract.billing, taxBasisPointsUpperBound: 1900 },
    }),
    499800,
  );
  const config = {
    ...liveTestConfig({}),
    maxJobMicroUsd: 420000,
    maxTotalMicroUsd: 420000,
  };
  enforceCap(config, 5, 420000);
  assert.throws(() =>
    enforceCap({ ...config, maxJobMicroUsd: 419999 }, 5, 420000),
  );
});

test("five-second example cannot price other inputs or encoded MP3 overrun", () => {
  for (const duration of [4, 4.999, 5.000001, 5.04, 6, NaN, Infinity])
    assert.throws(
      () => planUpperBoundMicroUsd(duration, contract),
      /duration bound/,
    );
  for (const bound of [
    null,
    { ...contract.generatedDurationBound!, evidence: "" },
    { ...contract.generatedDurationBound!, maxAdditionalSeconds: -1 },
  ])
    assert.throws(
      () =>
        planUpperBoundMicroUsd(5, {
          ...contract,
          generatedDurationBound: bound,
        }),
      /duration bound/,
    );
});

test("operator evidence does not install an inclusive production contract", () => {
  assert.equal(bytePlusVerification.contract, null);
  assert.equal(bytePlusVerification.verified, false);
  assert.throws(assertBytePlusVerified, /not verified/);
  // An old persisted contract without a generated duration bound fails closed.
  const legacy = { ...contract };
  delete (legacy as Partial<VerifiedContract>).generatedDurationBound;
  assert.throws(() => planUpperBoundMicroUsd(5, legacy), /duration bound/);
});

test("unknown inclusive taxes cannot be converted into a zero-tax quote", () => {
  const billing = { ...contract.billing };
  delete (billing as Partial<typeof billing>).taxBasisPointsUpperBound;
  assert.throws(() => planUpperBoundMicroUsd(5, { ...contract, billing }));
});

test("uncovered plans remain unpriced; expanded video costs exhaust cumulative allowance", () => {
  const store = new LiveTestStore(":memory:");
  const media: PreparedMedia = {
    sourceJobId: "first",
    owner: "owner",
    audioPath: "mock.mp3",
    imagePath: "mock.png",
    audioSha256: "a".repeat(64),
    imageSha256: "b".repeat(64),
    durationSeconds: 5,
    prompt: "Sing naturally",
    promptLanguageConfirmed: true,
  };
  const config = {
    ...liveTestConfig({}),
    demoMode: false,
    enabled: true,
    operatorSecret: "s".repeat(32),
    maxJobMicroUsd: 420000,
    maxTotalMicroUsd: 839999,
  };
  try {
    const unpriced = store.prepare(
      { ...media, sourceJobId: "overrun", durationSeconds: 5.04 },
      null,
      null,
    );
    assert.throws(
      () =>
        store.pricePrepared(unpriced.id, media.owner, unpriced.media, contract),
      /duration bound/,
    );
    assert.equal(store.get(unpriced.id).upperBoundMicroUsd, null);
    assert.throws(
      () =>
        store.authorize(
          unpriced.id,
          config,
          config.operatorSecret,
          confirmationPhrase(unpriced),
        ),
      /unknown billing/,
    );
    const first = store.prepare(media, null, null);
    const priced = store.pricePrepared(first.id, media.owner, media, contract);
    assert.equal(priced.upperBoundMicroUsd, 420000);
    store.authorize(
      priced.id,
      config,
      config.operatorSecret,
      confirmationPhrase(priced),
    );
    const secondMedia = { ...media, sourceJobId: "second" };
    const second = store.prepare(secondMedia, null, null);
    const secondPriced = store.pricePrepared(
      second.id,
      media.owner,
      secondMedia,
      contract,
    );
    assert.throws(
      () =>
        store.authorize(
          second.id,
          config,
          config.operatorSecret,
          confirmationPhrase(secondPriced),
        ),
      /Total live-test spending cap/,
    );
    // Exact two-job boundary succeeds; no provider or network dependency exists.
    store.authorize(
      second.id,
      { ...config, maxTotalMicroUsd: 840000 },
      config.operatorSecret,
      confirmationPhrase(secondPriced),
    );
  } finally {
    store.close();
  }
});

test("Technical Support: floor generated seconds, with one second for positive subsecond output", async () => {
  const { reportedBaseChargeMicroUsd } =
    await import("../lib/live/contract.ts");
  for (const [seconds, charge] of [
    [0.001, 70000],
    [0.999, 70000],
    [1, 70000],
    [1.999, 70000],
    [5, 350000],
    [5.3, 350000],
    [5.999999, 350000],
    [6, 420000],
    [300, 21000000],
  ])
    assert.equal(reportedBaseChargeMicroUsd(seconds), charge);
  for (const invalid of [0, -1, NaN, Infinity, 301])
    assert.throws(() => reportedBaseChargeMicroUsd(invalid));
  assert.equal(bytePlusVerification.contract, null); // Base-only evidence cannot establish taxes/inclusive approval.
});
