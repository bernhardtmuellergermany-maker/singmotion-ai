import {
  BytePlusProtocol,
  DocumentedBytePlusProvider,
  type InputLease,
} from "../lib/live/byteplus.ts";
import { providerRequest } from "../lib/live/timeout.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { copyFile, writeFile, rm } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  liveTestConfig,
  authorizeOperator,
  enforceCap,
} from "../lib/live/config.ts";
import {
  bytePlusVerification,
  assertBytePlusVerified,
  upperBoundMicroUsd,
  type VerifiedContract,
} from "../lib/live/contract.ts";
import {
  LiveTestStore,
  confirmationPhrase,
  type PreparedMedia,
} from "../lib/live/store.ts";
import { LiveTestRunner, type ReviewedProvider } from "../lib/live/runner.ts";
import {
  sha256File,
  revalidateMedia,
  prepareExistingJob,
  validateReference,
} from "../lib/live/media.ts";
import {
  validateOutputUrl,
  validateOutput,
  downloadValidatedOutput,
} from "../lib/live/output.ts";
import { validateAudio } from "../lib/media.ts";
// Fictional fixture terms exercise policy math, NOT BytePlus billing evidence.
const contract: VerifiedContract = {
  revision: "test-fixture-v1",
  model: "OmniHuman 2.0",
  documentationUrl: "https://example.test/fictional-contract",
  maxDurationSeconds: 300,
  promptSupported: true,
  billing: {
    microUsdPerSecond: 100_000,
    minimumBillableMs: 1000,
    billingQuantumMs: 1000,
    minimumChargeMicroUsd: 0,
    fixedFeeMicroUsd: 0,
    taxBasisPointsUpperBound: 0,
  },
  output: { width: 1280, height: 720, fps: 25, durationToleranceSeconds: 0.2 },
  outputHosts: ["output.example.test"],
};
const directory = mkdtempSync(path.join(tmpdir(), "singmotion-live-tests-"));
process.env.DATA_DIR = directory;
const storage = await import("../lib/db.ts");
const secret = "test-only-operator-secret-with-enough-characters";
const config = {
  ...liveTestConfig({}),
  demoMode: false,
  enabled: true,
  operatorSecret: secret,
  maxJobMicroUsd: 2_000_000,
  maxTotalMicroUsd: 3_000_000,
  maxDurationSeconds: 11,
};
const audio = path.join(directory, "clip.mp3"),
  image = path.join(directory, "image.png");
execFileSync("ffmpeg", [
  "-nostdin",
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=220:duration=10",
  "-codec:a",
  "libmp3lame",
  "-b:a",
  "192k",
  "-y",
  audio,
]);
await sharp({
  create: { width: 300, height: 300, channels: 3, background: "#aaaaaa" },
})
  .png()
  .toFile(image);
const duration = await validateAudio(audio, true);
const media: PreparedMedia = {
  sourceJobId: randomUUID(),
  owner: "test-owner",
  audioPath: audio,
  imagePath: image,
  audioSha256: await sha256File(audio),
  imageSha256: await sha256File(image),
  durationSeconds: duration,
  prompt: "Sing naturally with a static camera.",
  promptLanguageConfirmed: true,
};
function setup() {
  const filename = path.join(directory, `${randomUUID()}.sqlite`);
  const store = new LiveTestStore(filename);
  const attempt = store.prepare(
    { ...media, sourceJobId: randomUUID() },
    contract.revision,
    upperBoundMicroUsd(duration, contract.billing),
  );
  return { store, attempt, filename };
}
function fixture(overrides: Partial<ReviewedProvider> = {}) {
  let submits = 0,
    polls = 0;
  const provider: ReviewedProvider = {
    contract,
    submit: async (input, requestKey, signal) => {
      assert.equal(input.prompt, media.prompt);
      assert.equal(input.imageSha256, media.imageSha256);
      assert.equal(input.audioSha256, media.audioSha256);
      assert.ok(requestKey);
      assert.equal(signal.aborted, false);
      submits++;
      return { jobId: "test-provider-id" };
    },
    poll: async () => {
      polls++;
      return {
        state: "completed",
        outputUrl: "https://output.example.test/movie.mp4",
      };
    },
    ...overrides,
  };
  return { provider, counts: () => ({ submits, polls }) };
}
const download = async (_url: string, dest: string) => {
  await copyFile(path.resolve("public/media/demo.mp4"), dest);
};
after(async () => {
  storage.db.close();
  await rm(directory, { recursive: true, force: true });
});

test("default demo configuration and unverified 2.0 contract cannot make paid requests", async () => {
  assert.equal(liveTestConfig({}).demoMode, true);
  assert.equal(liveTestConfig({}).enabled, false);
  assert.equal(liveTestConfig({}).maxTotalMicroUsd, 0);
  assert.equal(bytePlusVerification.contract, null);
  assert.throws(assertBytePlusVerified, /not verified/);
  assert.throws(
    () => authorizeOperator(liveTestConfig({}), secret),
    /disabled/,
  );
  const { store, attempt } = setup();
  try {
    const f = fixture();
    const runner = new LiveTestRunner(
      store,
      f.provider,
      { ...config, demoMode: true },
      directory,
      download,
    );
    await assert.rejects(
      () => runner.submitOnce(attempt.id, "anything"),
      /DEMO_MODE/,
    );
    assert.equal(f.counts().submits, 0);
  } finally {
    store.close();
  }
});
test("operator authorization, deliberate confirmation, expiry and unknown prices fail closed", () => {
  const { store, attempt } = setup();
  try {
    assert.throws(
      () =>
        store.authorize(
          attempt.id,
          config,
          "wrong",
          confirmationPhrase(attempt),
        ),
      /denied/,
    );
    assert.throws(
      () => store.authorize(attempt.id, config, secret, "yes"),
      /exact/,
    );
    const unknown = store.prepare(
      { ...media, sourceJobId: randomUUID() },
      null,
      null,
    );
    assert.throws(
      () =>
        store.authorize(
          unknown.id,
          config,
          secret,
          confirmationPhrase(unknown),
        ),
      /verified inclusive/,
    );
    const token = store.authorize(
      attempt.id,
      config,
      secret,
      confirmationPhrase(attempt),
    );
    const row = store.db
      .prepare("SELECT token_hash FROM live_attempts WHERE id=?")
      .get(attempt.id);
    assert.notEqual(row?.token_hash, token);
    store.db
      .prepare("UPDATE live_attempts SET expires_at=0 WHERE id=?")
      .run(attempt.id);
    assert.throws(() => store.claimSubmission(attempt.id, token), /expired/);
  } finally {
    store.close();
  }
});
test("inclusive cost ceiling handles minimum duration, quantum, minimum charge, fees and tax", () => {
  const rules = {
    ...contract.billing,
    minimumBillableMs: 5000,
    billingQuantumMs: 1000,
    minimumChargeMicroUsd: 800_000,
    fixedFeeMicroUsd: 100_000,
    taxBasisPointsUpperBound: 1900,
  };
  assert.equal(upperBoundMicroUsd(1, rules), 1_071_000);
  assert.equal(upperBoundMicroUsd(10.001, rules), 1_428_000);
  for (const d of [0, NaN, 301])
    assert.throws(() => upperBoundMicroUsd(d, rules));
  assert.throws(() => upperBoundMicroUsd(2, { ...rules, billingQuantumMs: 0 }));
  assert.throws(() =>
    enforceCap({ ...config, maxJobMicroUsd: 10 }, duration, 100),
  );
  assert.throws(() => enforceCap(config, 30, 100));
  assert.throws(() =>
    liveTestConfig({ BYTEPLUS_LIVE_TEST_MAX_JOB_MICRO_USD: "NaN" }),
  );
});
test("global cap is atomic across connections and spent reservations are never released speculatively", () => {
  const { store, attempt, filename } = setup();
  const other = new LiveTestStore(filename);
  try {
    store.authorize(
      attempt.id,
      { ...config, maxTotalMicroUsd: attempt.upperBoundMicroUsd! },
      secret,
      confirmationPhrase(attempt),
    );
    const next = store.prepare(
      { ...media, sourceJobId: randomUUID() },
      contract.revision,
      attempt.upperBoundMicroUsd,
    );
    assert.throws(
      () =>
        other.authorize(
          next.id,
          { ...config, maxTotalMicroUsd: attempt.upperBoundMicroUsd! },
          secret,
          confirmationPhrase(next),
        ),
      /Total/,
    );
  } finally {
    other.close();
    store.close();
  }
});
test("one-time token, immutable plans and durable provider ID prevent duplicate submissions", async () => {
  const filename = path.join(directory, `${randomUUID()}.sqlite`);
  let store = new LiveTestStore(filename);
  const attempt = store.prepare(
    media,
    contract.revision,
    upperBoundMicroUsd(duration, contract.billing),
  );
  assert.equal(
    store.prepare(media, contract.revision, attempt.upperBoundMicroUsd).id,
    attempt.id,
  );
  assert.throws(
    () =>
      store.prepare(
        { ...media, prompt: "different" },
        contract.revision,
        attempt.upperBoundMicroUsd,
      ),
    /different immutable/,
  );
  const token = store.authorize(
    attempt.id,
    config,
    secret,
    confirmationPhrase(attempt),
  );
  const f = fixture();
  try {
    const runner = new LiveTestRunner(
      store,
      f.provider,
      config,
      directory,
      download,
    );
    assert.equal(
      (await runner.submitOnce(attempt.id, token)).state,
      "submitted",
    );
    assert.equal(f.counts().submits, 1);
    await assert.rejects(
      () => runner.submitOnce(attempt.id, token),
      /consumed/,
    );
    assert.equal(f.counts().submits, 1);
    store.close();
    store = new LiveTestStore(filename);
    assert.equal(store.get(attempt.id).providerJobId, "test-provider-id");
    assert.equal(
      (
        await new LiveTestRunner(
          store,
          f.provider,
          config,
          directory,
          download,
        ).pollOnce(attempt.id)
      ).state,
      "completed",
    );
    assert.equal(f.counts().submits, 1);
  } finally {
    store.close();
  }
});
test("ambiguous submission stays uncertain; no resubmission, polling without ID or fallback", async () => {
  const { store, attempt } = setup();
  let calls = 0;
  const provider = fixture({
    submit: async () => {
      calls++;
      throw new Error("secret provider response");
    },
  }).provider;
  try {
    const token = store.authorize(
      attempt.id,
      config,
      secret,
      confirmationPhrase(attempt),
    );
    const runner = new LiveTestRunner(
      store,
      provider,
      config,
      directory,
      download,
    );
    const result = await runner.submitOnce(attempt.id, token);
    assert.equal(result.state, "uncertain");
    assert.equal(result.failureCode, "SUBMISSION_OUTCOME_UNKNOWN");
    assert.ok(!JSON.stringify(result).includes("secret provider response"));
    await assert.rejects(() => runner.submitOnce(attempt.id, token));
    await assert.rejects(() => runner.pollOnce(attempt.id), /uncertain/);
    assert.equal(calls, 1);
  } finally {
    store.close();
  }
});
test("failed polling can resume by ID without submitting; provider failure is durable", async () => {
  const { store, attempt } = setup();
  let polls = 0;
  const f = fixture({
    poll: async () => {
      if (++polls === 1) throw new Error("network");
      return { state: "failed" };
    },
  });
  try {
    const token = store.authorize(
      attempt.id,
      config,
      secret,
      confirmationPhrase(attempt),
    );
    const runner = new LiveTestRunner(
      store,
      f.provider,
      config,
      directory,
      download,
    );
    await runner.submitOnce(attempt.id, token);
    await assert.rejects(() => runner.pollOnce(attempt.id));
    assert.equal(store.get(attempt.id).providerJobId, "test-provider-id");
    assert.equal((await runner.pollOnce(attempt.id)).state, "failed");
    assert.equal(f.counts().submits, 1);
  } finally {
    store.close();
  }
});
test("poll claims exclude competing workers and crashed submissions cannot be reclaimed", () => {
  const { store, attempt } = setup();
  try {
    const token = store.authorize(
      attempt.id,
      config,
      secret,
      confirmationPhrase(attempt),
    );
    store.claimSubmission(attempt.id, token);
    assert.throws(() => store.claimSubmission(attempt.id, token));
    assert.throws(() => store.claimPoll(attempt.id));
    store.transition(attempt.id, "submitted", { providerJobId: "id" });
    const lease = store.claimPoll(attempt.id);
    assert.throws(() => store.claimPoll(attempt.id), /Another/);
    store.releasePoll(attempt.id, lease);
    assert.ok(store.claimPoll(attempt.id));
  } finally {
    store.close();
  }
});
test("changed media, unsupported prompts and stale contract costs cannot reach submission", async () => {
  const { store, attempt } = setup();
  let calls = 0;
  const f = fixture({
    submit: async () => {
      calls++;
      return { jobId: "id" };
    },
    contract: { ...contract, promptSupported: false },
  });
  try {
    const token = store.authorize(
      attempt.id,
      config,
      secret,
      confirmationPhrase(attempt),
    );
    await assert.rejects(
      () =>
        new LiveTestRunner(
          store,
          f.provider,
          config,
          directory,
          download,
        ).submitOnce(attempt.id, token),
      /prompt/,
    );
    const changedCost = {
      ...f.provider,
      contract: {
        ...contract,
        billing: {
          ...contract.billing,
          microUsdPerSecond: contract.billing.microUsdPerSecond + 1,
        },
      },
    };
    await assert.rejects(
      () =>
        new LiveTestRunner(
          store,
          changedCost,
          config,
          directory,
          download,
        ).submitOnce(attempt.id, token),
      /cost changed/,
    );
    const changedContract = {
      ...f.provider,
      contract: { ...contract, revision: "changed" },
    };
    await assert.rejects(
      () =>
        new LiveTestRunner(
          store,
          changedContract,
          config,
          directory,
          download,
        ).submitOnce(attempt.id, token),
      /contract changed/,
    );
    assert.equal(calls, 0);
    await assert.rejects(
      () => revalidateMedia({ ...media, audioSha256: "changed" }),
      /changed/,
    );
    await assert.rejects(
      () => revalidateMedia({ ...media, promptLanguageConfirmed: false }),
      /English/,
    );
  } finally {
    store.close();
  }
});
test("output URL rules reject redirects targets, non-HTTPS, credentials and unapproved hosts", () => {
  assert.equal(
    validateOutputUrl(
      "https://output.example.test/x?signature=test",
      contract.outputHosts,
    ).hostname,
    "output.example.test",
  );
  for (const url of [
    "http://output.example.test/x",
    "https://evil.test/x",
    "https://user:pass@output.example.test/x",
    "https://127.0.0.1/x",
    "https://output.example.test:444/x",
    "https://output.example.test.evil.test/x",
  ])
    assert.throws(() => validateOutputUrl(url, contract.outputHosts));
});
test("download streams a valid MP4, refuses redirects and removes invalid or oversized data", async () => {
  const original = globalThis.fetch;
  const bytes = await (
    await import("node:fs/promises")
  ).readFile("public/media/demo.mp4");
  try {
    globalThis.fetch = async (_input, init) => {
      assert.equal(init?.redirect, "manual");
      return new Response(bytes);
    };
    const valid = path.join(directory, "download-ok.mp4");
    await downloadValidatedOutput(
      "https://output.example.test/x",
      valid,
      10,
      contract,
    );
    await validateOutput(valid, 10, contract);
    globalThis.fetch = async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.test/x" },
      });
    await assert.rejects(() =>
      downloadValidatedOutput(
        "https://output.example.test/x",
        path.join(directory, "redirect.mp4"),
        10,
        contract,
      ),
    );
    globalThis.fetch = async () => new Response("invalid media");
    const invalid = path.join(directory, "bad.mp4");
    await assert.rejects(() =>
      downloadValidatedOutput(
        "https://output.example.test/x",
        invalid,
        10,
        contract,
      ),
    );
    await assert.rejects(() =>
      import("node:fs/promises").then((fs) => fs.stat(invalid)),
    );
    globalThis.fetch = async () =>
      new Response(bytes, {
        headers: { "content-length": String(101 * 1024 * 1024) },
      });
    await assert.rejects(
      () =>
        downloadValidatedOutput(
          "https://output.example.test/x",
          path.join(directory, "large.mp4"),
          10,
          contract,
        ),
      /large/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("a corrupt or wrong-duration MP4 never completes the job", async () => {
  const { store, attempt } = setup();
  const f = fixture();
  try {
    const token = store.authorize(
      attempt.id,
      config,
      secret,
      confirmationPhrase(attempt),
    );
    const runner = new LiveTestRunner(
      store,
      f.provider,
      config,
      directory,
      async (_url, file) => {
        await writeFile(file, "not a video");
      },
    );
    await runner.submitOnce(attempt.id, token);
    assert.equal((await runner.pollOnce(attempt.id)).state, "failed");
    await assert.rejects(() =>
      validateOutput("public/media/demo.mp4", 30, contract),
    );
  } finally {
    store.close();
  }
});
test("offline preflight uses owned assets, actual FFmpeg trim and one unchanged original reference", async () => {
  const { owner } = storage.createSession();
  const songId = randomUUID(),
    imageId = randomUUID(),
    jobId = randomUUID();
  const songPath = path.join(directory, "media", songId),
    imagePath = path.join(directory, "media", imageId);
  await copyFile(audio, songPath);
  await copyFile(image, imagePath);
  for (const [id, kind, file, mime] of [
    [songId, "audio", songPath, "audio/mpeg"],
    [imageId, "image", imagePath, "image/png"],
  ] as const)
    storage.putAsset({
      id,
      owner,
      kind,
      path: file,
      mime,
      name: id,
      bytes: 100,
      duration: kind === "audio" ? duration : null,
      width: null,
      height: null,
      created: Date.now(),
    });
  storage.enqueue({
    id: jobId,
    owner,
    requestKey: randomUUID(),
    songId,
    imageId,
    artistName: "Test artist",
    start: 2,
    end: 7,
    performance: "Natural",
    camera: "Static Close-Up",
    prompt: media.prompt,
    price: 150,
    status: "queued",
    stage: "Queued",
    outputId: null,
    error: null,
    created: Date.now(),
    updated: Date.now(),
    saved: false,
    demo: true,
  });
  const prepared = await prepareExistingJob(jobId, owner);
  assert.ok(Math.abs(prepared.durationSeconds - 5) < 0.2);
  assert.equal(prepared.imageSha256, media.imageSha256);
  assert.equal(prepared.prompt, media.prompt);
  assert.equal(prepared.promptLanguageConfirmed, false);
  const cli = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "scripts/byteplus-preflight.ts",
        "--job",
        jobId,
        "--owner",
        owner,
        "--confirm-english",
      ],
      { env: { ...process.env, DEMO_MODE: "true" }, encoding: "utf8" },
    ),
  );
  assert.equal(cli.paidSubmissionEnabled, false);
  assert.equal(cli.estimatedProviderCharge, null);
  assert.equal(cli.status, "prepared");
  const protectedEntry = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "scripts/byteplus-live-test.ts"],
    {
      env: {
        ...process.env,
        DEMO_MODE: "false",
        BYTEPLUS_LIVE_TEST_ENABLED: "true",
      },
      encoding: "utf8",
    },
  );
  assert.equal(protectedEntry.status, 1);
  assert.match(protectedEntry.stderr, /No provider request was made/);

  assert.notEqual(prepared.audioSha256, media.audioSha256);
  await assert.rejects(
    () => prepareExistingJob(jobId, "another-user"),
    /not found/,
  );
  await assert.rejects(() => prepareExistingJob(jobId, owner, 1), /limit/);
  const invalid = path.join(directory, "fake.png");
  await writeFile(invalid, "not an image");
  await assert.rejects(() => validateReference(invalid));
});

test("account cleanup removes offline plan metadata but cannot erase a spending reservation", () => {
  const { store, attempt } = setup();
  try {
    store.removeUnsubmittedOwnerPlans(media.owner);
    assert.throws(() => store.get(attempt.id), /not found/);
    const next = store.prepare(
      { ...media, sourceJobId: randomUUID() },
      contract.revision,
      upperBoundMicroUsd(duration, contract.billing),
    );
    store.authorize(next.id, config, secret, confirmationPhrase(next));
    assert.throws(
      () => store.removeUnsubmittedOwnerPlans(media.owner),
      /reconciliation/,
    );
    assert.equal(store.get(next.id).state, "authorized");
  } finally {
    store.close();
  }
});

test("provider timeout aborts reads/submission without invoking the operation twice", async () => {
  let calls = 0;
  let captured: AbortSignal | undefined;
  await assert.rejects(
    () =>
      providerRequest((signal) => {
        calls++;
        captured = signal;
        return new Promise(() => {});
      }, 10),
    /timed out/,
  );
  assert.equal(calls, 1);
  assert.equal(captured?.aborted, true);
});

test("documented adapter reuses durable lifecycle and downloads a validated MP4 using mocked wire responses", async () => {
  const { store, attempt } = setup();
  const requests: string[] = [];
  const protocol = new BytePlusProtocol(async (request) => {
    const action = new URL(request.url).searchParams.get("Action")!;
    requests.push(action);
    if (requests.length === 2)
      return { status: 429, body: { code: 50429, data: null } };
    if (requests.length === 3)
      return {
        status: 200,
        body: { code: 10000, data: { status: "in_queue" } },
      };
    return {
      status: 200,
      body: {
        code: 10000,
        data:
          action === "CVSync2AsyncSubmitTask"
            ? { task_id: "documented-task" }
            : {
                status: "done",
                video_url: "https://output.example.test/movie.mp4",
              },
      },
    };
  });
  const delivery = {
    issue: async (input: PreparedMedia): Promise<InputLease> => ({
      owner: input.owner,
      audioSha256: input.audioSha256,
      imageSha256: input.imageSha256,
      imageUrl: "https://input.example.test/private-image?token=mock",
      audioUrl: "https://input.example.test/private-audio?token=mock",
      expiresAt: Date.now() + 60000,
    }),
  };
  const provider = new DocumentedBytePlusProvider(
    contract,
    delivery,
    ["input.example.test"],
    protocol,
  );
  const runner = new LiveTestRunner(
    store,
    provider,
    config,
    directory,
    download,
  );
  const token = store.authorize(
    attempt.id,
    config,
    secret,
    confirmationPhrase(attempt),
  );
  assert.equal(
    (await runner.submitOnce(attempt.id, token)).providerJobId,
    "documented-task",
  );
  await assert.rejects(runner.submitOnce(attempt.id, token));
  await assert.rejects(runner.pollOnce(attempt.id));
  assert.equal(store.get(attempt.id).providerJobId, "documented-task");
  assert.equal((await runner.pollOnce(attempt.id)).state, "processing");
  assert.equal((await runner.pollOnce(attempt.id)).state, "completed");
  assert.deepEqual(requests, [
    "CVSync2AsyncSubmitTask",
    "CVSync2AsyncGetResult",
    "CVSync2AsyncGetResult",
    "CVSync2AsyncGetResult",
  ]);
  for (const override of [
    { owner: "other" },
    { expiresAt: Date.now() - 1 },
    { imageSha256: "changed" },
    { audioUrl: "http://input.example.test/audio" },
    { imageUrl: "https://unapproved.example.test/image" },
  ]) {
    const bad = new DocumentedBytePlusProvider(
      contract,
      {
        issue: async (input) => ({
          ...(await delivery.issue(input)),
          ...override,
        }),
      },
      ["input.example.test"],
      protocol,
    );
    await assert.rejects(
      bad.submit(media, "key", new AbortController().signal),
    );
  }
  assert.equal(requests.length, 4);
  for (const status of ["expired", "not_found", "canceled"]) {
    const failed = new DocumentedBytePlusProvider(
      contract,
      delivery,
      [],
      new BytePlusProtocol(async () => ({
        status: 200,
        body: { code: 10000, data: { status } },
      })),
    );
    assert.equal(
      (await failed.poll("id", new AbortController().signal)).state,
      "failed",
    );
  }
  store.close();
});

test("expired provider output URL cannot complete a job or trigger resubmission", async (t) => {
  const { store, attempt } = setup();
  const fake = fixture();
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("expired", { status: 403 }),
  );
  const runner = new LiveTestRunner(store, fake.provider, config, directory);
  const token = store.authorize(
    attempt.id,
    config,
    secret,
    confirmationPhrase(attempt),
  );
  await runner.submitOnce(attempt.id, token);
  assert.equal((await runner.pollOnce(attempt.id)).state, "failed");
  assert.equal(fake.counts().submits, 1);
  store.close();
});
