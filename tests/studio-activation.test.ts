import { test, after, beforeEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  stat,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
import net from "node:net";
import tls from "node:tls";
import { LiveTestStore } from "../lib/live/store.ts";
import {
  activationEvidence,
  prepareActivationPolicy,
  recoveryHealth,
} from "../lib/live/studio-activation.ts";
import {
  planUpperBoundMicroUsd,
  upperBoundMicroUsd,
} from "../lib/live/contract.ts";
import { validateStudioPolicy } from "../lib/live/studio-policy.ts";
const root = await mkdtemp(path.join(tmpdir(), "studio activation "));
await mkdir(path.join(root, "live-output"));
const file = path.join(root, "live-output", "sample.mp4");
execFileSync("ffmpeg", [
  "-nostdin",
  "-v",
  "error",
  "-i",
  "public/media/demo.mp4",
  "-t",
  "5",
  "-c",
  "copy",
  file,
]);
const store = new LiveTestStore(path.join(root, "live-test.sqlite"));
const owner = "cms-staff-17";
const a = store.prepare(
  {
    sourceJobId: "success",
    owner,
    audioPath: "private",
    imagePath: "private",
    audioSha256: "a".repeat(64),
    imageSha256: "b".repeat(64),
    durationSeconds: 4.872,
    prompt: "Sing",
    promptLanguageConfirmed: true,
  },
  null,
  null,
);
store.db
  .prepare("UPDATE live_attempts SET data=?, reserved_micro_usd=? WHERE id=?")
  .run(
    JSON.stringify({
      ...a,
      state: "completed",
      providerJobId: "2062100414",
      outputPath: file,
    }),
    420000,
    a.id,
  );
store.claimFirstTest(a.id, "original");
store.recordFirstTestResult(a.id, {
  taskId: "2062100414",
  downloaded: true,
  outputPath: file,
  hostnameVerified: "operator-reviewed",
  approvedHostname: "cdn.example.test",
  video_url: "https://cdn.example.test/video?private=secret",
  outputApprovalDigest: "review",
});
store.db.prepare("INSERT INTO live_output_reviews VALUES (?,?,?,?)").run(
  a.id,
  "review",
  JSON.stringify({
    hostname: "cdn.example.test",
    minDurationSeconds: 1,
    maxDurationSeconds: 6,
    acknowledgment: "APPROVE_EXACT_HOST_AND_MEDIA_POLICY",
  }),
  Date.now(),
);
after(async () => {
  store.close();
  await rm(root, { recursive: true, force: true });
});
beforeEach((context) => {
  const t = context as TestContext,
    deny = () => {
      throw Error("Network forbidden");
    };
  t.mock.method(globalThis, "fetch", deny);
  t.mock.method(net.Socket.prototype, "connect", deny);
  t.mock.method(tls, "connect", deny);
});
test("offline inspection derives actual output metadata, enforces owned success and hides URLs/paths", async () => {
  const e = await activationEvidence(root, owner);
  assert.equal(e.taskId, "2062100414");
  assert.equal(e.reservedMicroUsd, 420000);
  assert.equal(e.output.videoCodec, "h264");
  assert.equal(e.output.audioCodec, "aac");
  assert.ok(e.output.fps > 0);
  assert.ok(e.outputSeconds <= 6);
  assert.ok(!JSON.stringify(e).includes("private=secret"));
  assert.ok(!JSON.stringify(e).includes(root));
  await assert.rejects(
    activationEvidence(root, "cms-staff-other"),
    /Owned successful/,
  );
});
test("policy needs independent ceiling and explicit confirmation; saves privately without overwriting ledger/media", async () => {
  const e = await activationEvidence(root, owner),
    before = await readFile(file),
    record = store.get(a.id),
    slot = store.firstTest();
  const input = {
    digest: e.digest,
    ceilingMicroUsd: 1000000,
    evidence:
      "Mock independent inclusive bound and 4–5s acceptance evidence; not vendor tax.",
    confirmation: "APPROVE_SHORT_STUDIO_POLICY_WITH_PROVISIONAL_UPLIFT",
  };
  for (const bad of [
    { ...input, confirmation: "" },
    { ...input, digest: "wrong" },
    { ...input, evidence: "" },
    { ...input, ceilingMicroUsd: 420000 },
  ])
    await assert.rejects(prepareActivationPolicy(root, owner, bad));
  await prepareActivationPolicy(root, owner, input);
  const p = validateStudioPolicy(
    JSON.parse(
      await readFile(path.join(root, "studio-live-policy.json"), "utf8"),
    ),
  );
  assert.equal(p.contract.billing.taxBasisPointsUpperBound, null);
  assert.equal(p.contract.billing.fixedFeeMicroUsd, null);
  assert.equal(p.contract.pilotAdmission!.planningUpliftBasisPoints, 1900);
  assert.equal(planUpperBoundMicroUsd(4.872, p.contract), 1000000);
  const boundary = structuredClone(p.contract);
  boundary.pilotAdmission!.inclusiveMaxMicroUsd = 499800;
  assert.equal(planUpperBoundMicroUsd(4.872, boundary), 499800);
  boundary.pilotAdmission!.inclusiveMaxMicroUsd = 499799;
  assert.throws(() => planUpperBoundMicroUsd(4.872, boundary));
  assert.throws(() => planUpperBoundMicroUsd(5.001, p.contract));
  assert.throws(() => upperBoundMicroUsd(6, p.contract.billing));
  assert.equal(p.contract.output.maxDurationSeconds, 6);
  await assert.rejects(
    prepareActivationPolicy(root, owner, input),
    /already exists/,
  );
  assert.deepEqual(store.get(a.id), record);
  assert.deepEqual(store.firstTest(), slot);
  assert.deepEqual(await readFile(file), before);
  if (process.platform !== "win32")
    assert.equal(
      (await stat(path.join(root, "studio-live-policy.json"))).mode & 0o777,
      0o600,
    );
});
test("recovery health rejects missing, failed, future and stale worker evidence", async () => {
  assert.equal((await recoveryHealth(root)).healthy, false);
  for (const data of [
    { at: Date.now() - 180001, status: "ready" },
    { at: Date.now() + 60000, status: "ready" },
    { at: Date.now(), status: "error" },
  ]) {
    await writeFile(
      path.join(root, "studio-recovery-health.json"),
      JSON.stringify(data),
    );
    assert.equal((await recoveryHealth(root)).healthy, false);
  }
  await writeFile(
    path.join(root, "studio-recovery-health.json"),
    JSON.stringify({ at: Date.now(), status: "ready" }),
  );
  assert.equal((await recoveryHealth(root)).healthy, true);
});

test("recovery loop emits health without submitting or touching completed operator tasks", async () => {
  const { pollStudioProjects } = await import("../lib/live/studio-worker.ts");
  const before = store.get(a.id),
    env = process.env.BYTEPLUS_STUDIO_RECOVERY_ENABLED;
  process.env.BYTEPLUS_STUDIO_RECOVERY_ENABLED = "true";
  try {
    await pollStudioProjects(root);
    assert.equal((await recoveryHealth(root)).healthy, true);
    assert.deepEqual(store.get(a.id), before);
  } finally {
    if (env === undefined) delete process.env.BYTEPLUS_STUDIO_RECOVERY_ENABLED;
    else process.env.BYTEPLUS_STUDIO_RECOVERY_ENABLED = env;
  }
});

test("admin duration bands require explicit independent review and preserve short policy, budget and history", async () => {
  const { inspectDurationPolicy, saveDurationBand } =
    await import("../lib/live/studio-duration-admin.ts");
  const { selectStudioPolicy } = await import("../lib/live/studio-policy.ts");
  const dir = await mkdtemp(path.join(tmpdir(), "duration policy "));
  try {
    const original = JSON.parse(
      await readFile(path.join(root, "studio-live-policy.json"), "utf8"),
    );
    original.eurBudget = {
      evidence: "existing private FX review, preserved verbatim",
    };
    await writeFile(
      path.join(dir, "studio-live-policy.json"),
      JSON.stringify(original),
    );
    const initial = await inspectDurationPolicy(dir);
    const review = {
      minInputSeconds: 5,
      maxInputSeconds: 15,
      maxGeneratedSeconds: 16,
      ceilingUsd: 2,
      billingEvidence:
        "MOCK ONLY: independently reviewed inclusive bound covering all fees.",
      durationEvidence:
        "MOCK ONLY: verified entire input range and maximum generated duration.",
      outputEvidence:
        "MOCK ONLY: exact host and h264/aac 720p FPS acceptance review.",
      transferEvidence:
        "MOCK ONLY: independently reviewed download byte and timeout caps.",
      maxBytes: 30 * 1024 * 1024,
      timeoutSeconds: 120,
      hosts: original.contract.outputHosts.join("\n"),
      width: original.contract.output.width,
      height: original.contract.output.height,
      fps: original.contract.output.fps,
      videoCodec: "h264",
      audioCodec: "aac",
      toleranceSeconds: 2,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };
    const input = {
      digest: initial.digest,
      index: 0,
      review,
      confirmation: "APPROVE_REVIEWED_DURATION_BAND",
    };
    for (const [field, bad, explanation] of [
      ["durationEvidence", "", /durationEvidence/],
      ["billingEvidence", "", /billingEvidence/],
      ["ceilingUsd", 1, /ceilingUsd/],
      ["maxGeneratedSeconds", 6, /maxGeneratedSeconds/],
      ["maxBytes", 300 * 1024 * 1024, /maxBytes/],
      ["timeoutSeconds", 181, /timeoutSeconds/],
      ["hosts", "*.example.test", /Host\/media/],
      ["hosts", "127.0.0.1", /Host\/media/],
      ["videoCodec", "unknown", /codecs/],
    ] as const)
      await assert.rejects(
        saveDurationBand(dir, owner, {
          ...input,
          review: { ...review, [field]: bad },
        }),
        explanation,
      );
    await assert.rejects(
      saveDurationBand(dir, owner, { ...input, confirmation: "" }),
      /approval/,
    );
    assert.deepEqual((await inspectDurationPolicy(dir)).policy, original);
    const record = store.get(a.id),
      video = await readFile(file);
    await saveDurationBand(dir, owner, input);
    const saved = await inspectDurationPolicy(dir);
    const { durationBands, ...unchanged } = saved.policy;
    assert.deepEqual(unchanged, original);
    assert.equal(durationBands!.length, 1);
    assert.equal(
      selectStudioPolicy(saved.policy, 5).contract.maxDurationSeconds,
      5,
    );
    assert.equal(
      planUpperBoundMicroUsd(15, selectStudioPolicy(saved.policy, 15).contract),
      2000000,
    );
    assert.equal(
      durationBands![0].contract.billing.taxBasisPointsUpperBound,
      null,
    );
    assert.throws(() => selectStudioPolicy(saved.policy, 15.01), /No reviewed/);
    await assert.rejects(saveDurationBand(dir, owner, input), /Policy changed/);
    await assert.rejects(
      saveDurationBand(dir, owner, {
        ...input,
        digest: saved.digest,
        index: 1,
        review: {
          ...review,
          minInputSeconds: 10,
          maxInputSeconds: 20,
          maxGeneratedSeconds: 21,
        },
      }),
      /Bands overlap/,
    );
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        saveDurationBand(dir, owner, { ...input, digest: saved.digest }),
      ),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.deepEqual(store.get(a.id), record);
    assert.deepEqual(await readFile(file), video);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("experimental planning is labeled, separately acknowledged and never relaxes output safety", async () => {
  const {
    reviewedDurationBand,
    saveDurationBand,
    inspectDurationPolicy,
    durationReview,
  } = await import("../lib/live/studio-duration-admin.ts");
  const { validateOutput, downloadValidatedOutput } =
    await import("../lib/live/output.ts");
  const base = JSON.parse(
    await readFile(path.join(root, "studio-live-policy.json"), "utf8"),
  );
  const review = {
    reviewMode: "experimental",
    experimental: {
      kind: "operator-planning-v1",
      unknownDurationAccepted: true,
      unknownFeesAccepted: true,
      unknownMediaAccepted: true,
      hostEvidence:
        "MOCK retained exact-host approval from successful private test.",
    },
    minInputSeconds: 5,
    maxInputSeconds: 15,
    maxGeneratedSeconds: 20,
    ceilingUsd: 3,
    billingEvidence:
      "Operator assumes a conservative reservation; fees remain unknown.",
    durationEvidence:
      "Operator selects a validation cap; generated duration is unknown.",
    outputEvidence:
      "Operator selects h264/aac 720p acceptance limits; properties unknown.",
    transferEvidence:
      "Operator assumes bounded transfer resources; oversized files rejected.",
    maxBytes: 30 * 1024 * 1024,
    timeoutSeconds: 120,
    hosts: base.contract.outputHosts.join("\n"),
    width: base.contract.output.width,
    height: base.contract.output.height,
    fps: base.contract.output.fps,
    videoCodec: "h264",
    audioCodec: "aac",
    toleranceSeconds: 2,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
  for (const key of [
    "unknownDurationAccepted",
    "unknownFeesAccepted",
    "unknownMediaAccepted",
  ] as const)
    assert.throws(
      () =>
        reviewedDurationBand(
          { ...review, experimental: { ...review.experimental, [key]: false } },
          owner,
          base,
        ),
      /separate acknowledgment/,
    );
  assert.throws(
    () =>
      reviewedDurationBand(
        { ...review, hosts: "new-host.example.test" },
        owner,
        base,
      ),
    /already approved/,
  );
  assert.throws(
    () => reviewedDurationBand({ ...review, maxInputSeconds: 16 }, owner, base),
    /maxInputSeconds/,
  );
  assert.throws(
    () =>
      reviewedDurationBand({ ...review, ceilingUsd: Infinity }, owner, base),
    /ceilingUsd/,
  );
  const band = reviewedDurationBand(review, owner, base);
  assert.match(band.billingEvidence, /OPERATOR PLANNING ASSUMPTION/);
  assert.equal(band.contract.billing.taxBasisPointsUpperBound, null);
  assert.equal(planUpperBoundMicroUsd(15, band.contract), 3000000);
  assert.equal(durationReview(band).reviewMode, "experimental");
  const bad = structuredClone(band);
  (
    bad.contract.pilotAdmission!.experimental as unknown as {
      unknownFeesAccepted: boolean;
    }
  ).unknownFeesAccepted = false;
  assert.throws(() => validateStudioPolicy(bad));
  await assert.rejects(
    validateOutput(file, 5, {
      ...band.contract,
      output: { ...band.contract.output, maxDurationSeconds: 4 },
    }),
    /OUTPUT_DURATION_MISMATCH/,
  );
  await assert.rejects(
    validateOutput(file, 5, {
      ...band.contract,
      output: { ...band.contract.output, fps: 99 },
    }),
    /OUTPUT_FRAMERATE_MISMATCH/,
  );
  await assert.rejects(
    downloadValidatedOutput(
      `https://${base.contract.outputHosts[0]}/video`,
      path.join(root, "oversized.mp4"),
      5,
      {
        ...band.contract,
        output: {
          ...band.contract.output,
          transfer: {
            maxBytes: 8,
            timeoutMs: 1000,
            evidence: "mock transfer cap",
          },
        },
      },
      async () =>
        new Response(Buffer.alloc(9), { headers: { "content-length": "9" } }),
    ),
    /length|size|large/,
  );
  const dir = await mkdtemp(path.join(tmpdir(), "experimental policy "));
  try {
    await writeFile(
      path.join(dir, "studio-live-policy.json"),
      JSON.stringify(base),
    );
    const { digest } = await inspectDurationPolicy(dir);
    await assert.rejects(
      saveDurationBand(dir, owner, {
        digest,
        index: 0,
        review,
        confirmation: "APPROVE_REVIEWED_DURATION_BAND",
      }),
      /approval/,
    );
    await saveDurationBand(dir, owner, {
      digest,
      index: 0,
      review,
      confirmation: "APPROVE_EXPERIMENTAL_PLANNING_BAND",
    });
    const { durationBands, ...unchanged } = (await inspectDurationPolicy(dir))
      .policy;
    assert.deepEqual(unchanged, base);
    assert.equal(
      durationBands![0].contract.pilotAdmission!.experimental!
        .unknownFeesAccepted,
      true,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
