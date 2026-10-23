import { test, after, beforeEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import net from "node:net";
import tls from "node:tls";
import sharp from "sharp";
import { LiveTestStore, type PreparedMedia } from "../lib/live/store.ts";
import { createSignedTransport } from "../lib/live/signed-transport.ts";

const root = await mkdtemp(path.join(tmpdir(), "first test offline "));
process.env.DATA_DIR = root;
process.env.DEMO_MODE = "true";
await mkdir(path.join(root, "media"), { recursive: true });
const {
  FirstTestWorkflow,
  firstTestReviewTemplate,
  validateFirstTestReview,
  firstTestConfig,
} = await import("../lib/live/first-test.ts");
const { validateAudio } = await import("../lib/media.ts");
const { sha256File } = await import("../lib/live/media.ts");
const { db } = await import("../lib/db.ts");
const audio = path.join(root, "media", "clip.mp3"),
  image = path.join(root, "media", "singer.png");
execFileSync("ffmpeg", [
  "-nostdin",
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  "sine=duration=4.4",
  "-codec:a",
  "libmp3lame",
  audio,
]);
await sharp({
  create: { width: 512, height: 512, channels: 3, background: "white" },
})
  .png()
  .toFile(image);
const media: PreparedMedia = {
  sourceJobId: "",
  owner: "operator-owner",
  audioPath: audio,
  imagePath: image,
  durationSeconds: await validateAudio(audio, true),
  audioSha256: await sha256File(audio),
  imageSha256: await sha256File(image),
  prompt: "Sing naturally, looking towards the camera.",
  promptLanguageConfirmed: true,
};
const stores: LiveTestStore[] = [];
after(async () => {
  for (const s of stores) {
    try {
      s.close();
    } catch {}
  }
  db.close();
  await rm(root, { recursive: true, force: true });
});
beforeEach((context) => {
  const t = context as TestContext;
  const denied = () => {
    throw Error("Real network forbidden");
  };
  t.mock.method(net.Socket.prototype, "connect", denied);
  t.mock.method(tls, "connect", denied);
  t.mock.method(globalThis, "fetch", denied);
});
function fixture(filename = path.join(root, `${randomUUID()}.sqlite`)) {
  const store = new LiveTestStore(filename);
  stores.push(store);
  const attempt = store.prepare(
    { ...media, sourceJobId: randomUUID() },
    null,
    null,
  );
  const env = {
    DEMO_MODE: "true",
    GENERATIONS_ENABLED: "false",
    ADMIN_DEMO_ENABLED: "false",
    BYTEPLUS_FIRST_TEST_ENABLED: "true",
    BYTEPLUS_FIRST_TEST_PLAN_ID: attempt.id,
    BYTEPLUS_LIVE_TEST_ENABLED: "true",
    BYTEPLUS_LIVE_TEST_OPERATOR_SECRET:
      "fake-operator-secret-32-characters-long",
    BYTEPLUS_LIVE_TEST_MAX_DURATION_SECONDS: "5",
    BYTEPLUS_LIVE_TEST_MAX_JOB_MICRO_USD: "500000",
    BYTEPLUS_LIVE_TEST_MAX_TOTAL_MICRO_USD: "500000",
  };
  const review = {
    ...firstTestReviewTemplate(attempt),
    generatedVideoMaxSeconds: 6,
    baseMaxMicroUsd: 420000,
    taxMaxMicroUsd: 80000,
    feesMaxMicroUsd: 0,
    inclusiveMaxMicroUsd: 500000,
    reviewedBy: "Fictional reviewer",
    reviewedAt: "2026-01-01T00:00:00Z",
    evidence:
      "Fictional exact-input inclusive bound for mocks only; not BytePlus billing terms",
    acknowledgment: "INCLUSIVE_BOUND_FOR_EXACT_INPUT",
  };
  const confirmation = validateFirstTestReview(review, attempt).digest;
  let uploads = 0,
    submits = 0,
    polls = 0,
    cancels = 0;
  let mode = "done";
  const transport = createSignedTransport(
    async (input, init) => {
      assert.equal(new URL(String(input)).hostname, "cv.byteplusapi.com");
      assert.ok(new Headers(init?.headers).has("authorization"));
      const action = new URL(String(input)).searchParams.get("Action");
      if (action === "CVSync2AsyncSubmitTask") {
        submits++;
        if (mode === "uncertain") throw Error("sensitive provider detail");
        const body = JSON.parse(String(init?.body));
        assert.equal(body.image_urls.length, 1);
        assert.equal(body.prompt, media.prompt);
        return Response.json({
          code: 10000,
          data: { task_id: "mock-first-task" },
        });
      }
      if (action === "CVCancelTask") {
        cancels++;
        return Response.json({ code: 10000, data: {} });
      }
      polls++;
      if (mode === "poll-error") throw Error("sensitive polling detail");
      const status =
        mode === "pending"
          ? "in_queue"
          : mode === "failed"
            ? "expired"
            : "done";
      return Response.json({
        code: 10000,
        request_id: "mock-request",
        message: "secret echoed input",
        data: {
          status,
          audio_url: "https://input.example/private-secret",
          ...(status === "done"
            ? {
                video_url:
                  "https://unknown-output.example/video.mp4?capability=mock",
              }
            : {}),
        },
      });
    },
    () => ({ accessKeyId: "fake-ak", secretAccessKey: "fake-sk" }),
  );
  const make = (s = store) =>
    new FirstTestWorkflow(
      s,
      root,
      env,
      transport,
      {
        issue: async (input) => {
          s.assertInputDeliveryAllowed(input);
          uploads++;
          return {
            owner: input.owner,
            audioSha256: input.audioSha256,
            imageSha256: input.imageSha256,
            imageUrl: "https://input.example/image",
            audioUrl: "https://input.example/audio",
            expiresAt: Date.now() + 13 * 3600000,
          };
        },
      },
      ["input.example"],
    );
  return {
    store,
    attempt,
    env,
    review,
    confirmation,
    make,
    filename,
    mode: (value: string) => {
      mode = value;
    },
    counts: () => ({ uploads, submits, polls, cancels }),
  };
}

test("dry run is offline, unpriced by default, and binds exact media and reviewed costs", async () => {
  const f = fixture(),
    w = f.make();
  const dry = await w.dryRun(f.attempt.id, media.owner);
  assert.equal(dry.confirmationDigest, null);
  assert.equal(dry.review.taxMaxMicroUsd, null);
  assert.equal(f.store.get(f.attempt.id).upperBoundMicroUsd, null);
  assert.equal(
    (await w.dryRun(f.attempt.id, media.owner, f.review)).confirmationDigest,
    f.confirmation,
  );
  assert.deepEqual(f.counts(), {
    uploads: 0,
    submits: 0,
    polls: 0,
    cancels: 0,
  });
  for (const patch of [
    { taxMaxMicroUsd: null },
    { inclusiveMaxMicroUsd: 420000 },
    { encodedAudioSeconds: 5 },
    { promptSha256: "changed" },
    { acknowledgment: "" },
  ])
    assert.throws(() =>
      validateFirstTestReview({ ...f.review, ...patch }, f.attempt),
    );
  for (const patch of [
    { BYTEPLUS_FIRST_TEST_ENABLED: "false" },
    { DEMO_MODE: "false" },
    { GENERATIONS_ENABLED: "true" },
    { BYTEPLUS_FIRST_TEST_PLAN_ID: "other" },
    { BYTEPLUS_LIVE_TEST_OPERATOR_SECRET: "short" },
  ])
    assert.throws(() => firstTestConfig({ ...f.env, ...patch }, f.attempt.id));
  await assert.rejects(w.submit(f.attempt.id, media.owner, f.review, "wrong"));
  await assert.rejects(
    w.submit(f.attempt.id, "other", f.review, f.confirmation),
  );
  assert.equal(f.counts().submits, 0);
});

test("one confirmed test persists task, resumes after restart, observes URL without downloading or trusting host", async () => {
  const f = fixture(),
    w = f.make();
  f.mode("pending");
  assert.equal(
    (await w.submit(f.attempt.id, media.owner, f.review, f.confirmation)).state,
    "submitted",
  );
  assert.equal(
    (await w.poll(f.attempt.id, media.owner, f.review, f.confirmation)).state,
    "processing",
  );
  f.store.close();
  const restarted = new LiveTestStore(f.filename);
  stores.push(restarted);
  f.mode("done");
  const resumed = f.make(restarted);
  const done = await resumed.poll(
    f.attempt.id,
    media.owner,
    f.review,
    f.confirmation,
  );
  assert.equal(done.state, "output_observed");
  assert.equal(done.outputPath, null);
  const result = restarted.firstTestResult(done.id)!;
  assert.equal(result.result.observedHostname, "unknown-output.example");
  assert.equal(result.result.hostnameVerified, false);
  assert.equal(result.result.downloaded, false);
  assert.ok(result.result.video_url.includes("capability=mock"));
  assert.ok(!JSON.stringify(result).includes("secret echoed"));
  assert.ok(!JSON.stringify(result).includes("private-secret"));
  await resumed.poll(done.id, media.owner, f.review, f.confirmation); // Local terminal replay.
  await assert.rejects(
    resumed.submit(done.id, media.owner, f.review, f.confirmation),
  );
  assert.deepEqual(f.counts(), {
    uploads: 1,
    submits: 1,
    polls: 2,
    cancels: 0,
  });
  assert.equal(
    restarted.db
      .prepare("SELECT reserved_micro_usd FROM live_attempts WHERE id=?")
      .get(done.id)!.reserved_micro_usd,
    500000,
  );
});

test("uncertain submission and concurrent/other-plan attempts never trigger a second paid submit", async () => {
  const f = fixture();
  f.mode("uncertain");
  const w = f.make();
  const results = await Promise.allSettled([
    w.submit(f.attempt.id, media.owner, f.review, f.confirmation),
    w.submit(f.attempt.id, media.owner, f.review, f.confirmation),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(f.store.get(f.attempt.id).state, "uncertain");
  await assert.rejects(
    w.poll(f.attempt.id, media.owner, f.review, f.confirmation),
  );
  await assert.rejects(
    w.submit(f.attempt.id, media.owner, f.review, f.confirmation),
  );
  const second = f.store.prepare(
    { ...media, sourceJobId: randomUUID() },
    null,
    null,
  );
  assert.throws(
    () => f.store.claimFirstTest(second.id, "a".repeat(64)),
    /single first-test slot/,
  );
  assert.equal(f.counts().submits, 1);
});

test("read errors preserve task/reservation; cancellation requires queue check and is one-time", async () => {
  const f = fixture(),
    w = f.make();
  await w.submit(f.attempt.id, media.owner, f.review, f.confirmation);
  f.mode("poll-error");
  await assert.rejects(
    w.poll(f.attempt.id, media.owner, f.review, f.confirmation),
  );
  assert.equal(f.store.get(f.attempt.id).state, "submitted");
  f.mode("pending");
  await w.cancel(f.attempt.id, media.owner, f.review, f.confirmation);
  assert.equal(f.store.get(f.attempt.id).failureCode, "PROVIDER_TASK_CANCELED");
  await assert.rejects(
    w.cancel(f.attempt.id, media.owner, f.review, f.confirmation),
  );
  assert.equal(f.counts().cancels, 1);
  assert.equal(f.counts().submits, 1);
  assert.equal(
    f.store.db
      .prepare("SELECT reserved_micro_usd FROM live_attempts WHERE id=?")
      .get(f.attempt.id)!.reserved_micro_usd,
    500000,
  );
});

test("CLI supports Windows BOM/spaced paths, dry run, mocked live run and local result/restart", async () => {
  const f = fixture(path.join(root, "live-test.sqlite"));
  const file = path.join(root, "cost review.json");
  await writeFile(file, "\uFEFF" + JSON.stringify(f.review));
  const calls = path.join(root, "mock-calls.jsonl");
  const env = {
    ...process.env,
    ...f.env,
    DATA_DIR: root,
    BYTEPLUS_ACCESS_KEY_ID: "fake-ak",
    BYTEPLUS_SECRET_ACCESS_KEY: "fake-sk",
    R2_ACCOUNT_ID: "0".repeat(32),
    R2_BUCKET: "singmotion-ai-private",
    R2_ACCESS_KEY_ID: "fake-ak",
    R2_SECRET_ACCESS_KEY: "fake-sk",
    FIRST_TEST_MOCK_CALLS: calls,
  };
  const cli = (action: string, flags: string[] = []) =>
    spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--import",
        "./tests/fixtures/first-test-network-mock.mjs",
        "scripts/byteplus-first-test.ts",
        action,
        "--plan",
        f.attempt.id,
        "--owner",
        media.owner,
        ...flags,
      ],
      { env, encoding: "utf8", timeout: 30000 },
    );
  const dry = cli("dry-run", ["--review-file", file]);
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(JSON.parse(dry.stdout).confirmationDigest, f.confirmation);
  const blocked = cli("run", ["--review-file", file]);
  assert.equal(blocked.status, 1);
  const flags = [
    "--review-file",
    file,
    "--skip-download",
    "--confirm-live-test",
    f.confirmation,
  ];
  const live = cli("run", flags);
  assert.equal(live.status, 0, live.stderr);
  assert.match(live.stdout, /output_observed/);
  assert.match(live.stdout, /unknown-output.example/);
  const replay = cli("run", flags);
  assert.equal(replay.status, 1);
  const resume = cli("resume", flags);
  assert.equal(resume.status, 0, resume.stderr);
  const result = cli("result");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).observation.result.downloaded, false);
  const log = (await readFile(calls, "utf8")).trim().split("\n");
  assert.equal(log.filter((s) => s === "CVSync2AsyncSubmitTask").length, 1);
  assert.equal(log.filter((s) => s === "PUT").length, 2);
  assert.equal(log.filter((s) => s === "CVSync2AsyncGetResult").length, 1);
});

test("failed tasks retain reservations and insufficient cost caps stop before upload", async () => {
  const f = fixture(),
    w = f.make();
  f.env.BYTEPLUS_LIVE_TEST_MAX_JOB_MICRO_USD = "499999";
  await assert.rejects(
    w.submit(f.attempt.id, media.owner, f.review, f.confirmation),
    /cap/,
  );
  assert.equal(f.store.firstTest(), undefined);
  assert.equal(f.counts().uploads, 0);
  f.env.BYTEPLUS_LIVE_TEST_MAX_JOB_MICRO_USD = "500000";
  await w.submit(f.attempt.id, media.owner, f.review, f.confirmation);
  f.mode("failed");
  assert.equal(
    (await w.poll(f.attempt.id, media.owner, f.review, f.confirmation)).state,
    "failed",
  );
  assert.equal(
    f.store.db
      .prepare("SELECT reserved_micro_usd FROM live_attempts WHERE id=?")
      .get(f.attempt.id)!.reserved_micro_usd,
    500000,
  );
  await assert.rejects(
    w.submit(f.attempt.id, media.owner, f.review, f.confirmation),
  );
  assert.equal(f.counts().submits, 1);
});

test("crash after consuming approval cannot be submitted or polled without a task ID", async () => {
  const f = fixture(),
    config = firstTestConfig(f.env, f.attempt.id);
  f.store.claimFirstTest(f.attempt.id, f.confirmation);
  const priced = f.store.priceReviewedBound(
    f.attempt.id,
    media.owner,
    f.attempt.media,
    "operator-first-test-v1",
    f.confirmation,
    500000,
    f.review,
  );
  const { confirmationPhrase } = await import("../lib/live/store.ts");
  const token = f.store.authorize(
    priced.id,
    config,
    config.operatorSecret,
    confirmationPhrase(priced),
  );
  f.store.claimSubmission(priced.id, token, config);
  const w = f.make();
  await assert.rejects(
    w.submit(priced.id, media.owner, f.review, f.confirmation),
  );
  await assert.rejects(
    w.poll(priced.id, media.owner, f.review, f.confirmation),
  );
  assert.deepEqual(f.counts(), {
    uploads: 0,
    submits: 0,
    polls: 0,
    cancels: 0,
  });
});
