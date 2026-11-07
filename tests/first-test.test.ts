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
  let videoUrl = "https://unknown-output.example/video.mp4?capability=mock";
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
                video_url: videoUrl,
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
    url: (value: string) => {
      videoUrl = value;
    },
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
    FIRST_TEST_MOCK_OUTPUT_FILE: clip,
    BYTEPLUS_FIRST_TEST_DOWNLOAD_ENABLED: "true",
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
  const approval = outputApproval(f);
  const outputFile = path.join(root, "output approval.json");
  await writeFile(outputFile, "\uFEFF" + JSON.stringify(approval.review));
  const preview = cli("review-output", [
    "--review-file",
    file,
    "--output-review-file",
    outputFile,
  ]);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).confirmationDigest, approval.digest);
  // Existing-result download needs neither BytePlus nor R2 credentials.
  for (const key of [
    "BYTEPLUS_ACCESS_KEY_ID",
    "BYTEPLUS_SECRET_ACCESS_KEY",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
  ])
    delete (env as Record<string, string | undefined>)[key];
  const downloadFlags = [
    "--review-file",
    file,
    "--confirm-live-test",
    f.confirmation,
    "--output-review-file",
    outputFile,
    "--confirm-output",
    approval.digest,
  ];
  const saved = cli("download", downloadFlags);
  assert.equal(saved.status, 0, saved.stderr);
  assert.equal(JSON.parse(saved.stdout).state, "completed");
  assert.ok(JSON.parse(saved.stdout).outputPath.endsWith(".mp4"));
  const recovered = cli("download", downloadFlags);
  assert.equal(recovered.status, 0, recovered.stderr);
  const finalLog = (await readFile(calls, "utf8")).trim().split("\n");
  assert.equal(
    finalLog.filter((s) => s === "CVSync2AsyncSubmitTask").length,
    1,
  );
  assert.equal(finalLog.filter((s) => s === "OUTPUT_GET").length, 1);
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

const {
  outputReviewTemplate,
  reviewOutput,
  downloadFirstTestResult,
  outputHostnameCandidate,
} = await import("../lib/live/first-test-download.ts");
const clip = path.join(root, "short-result.mp4");
execFileSync("ffmpeg", [
  "-nostdin",
  "-v",
  "error",
  "-i",
  "public/media/demo.mp4",
  "-t",
  "5.3",
  "-c",
  "copy",
  clip,
]);
const resultBytes = await readFile(clip);
function outputApproval(
  f: ReturnType<typeof fixture>,
  hostname = "unknown-output.example",
) {
  const review = {
    ...outputReviewTemplate(f.make(), f.attempt.id, media.owner),
    hostname,
    width: 1280,
    height: 720,
    fps: 25,
    minDurationSeconds: 4,
    maxDurationSeconds: 6,
    videoCodec: "h264",
    audioCodec: "aac",
    reviewedBy: "Fictional reviewer",
    reviewedAt: "2026-01-01T00:00:00Z",
    evidence:
      "Fictional exact hostname ownership and media acceptance policy for mocks",
    acknowledgment: "APPROVE_EXACT_HOST_AND_MEDIA_POLICY",
  };
  return reviewOutput(f.make(), f.attempt.id, media.owner, review, 6);
}
async function observedFixture() {
  const f = fixture();
  await f.make().submit(f.attempt.id, media.owner, f.review, f.confirmation);
  await f.make().poll(f.attempt.id, media.owner, f.review, f.confirmation);
  const env: Record<string, string> = f.env;
  env.BYTEPLUS_FIRST_TEST_DOWNLOAD_ENABLED = "true";
  return f;
}

test("candidate is unapproved; missing host, unknown output policy, wrong owner and gate cannot download", async () => {
  const f = await observedFixture(),
    w = f.make();
  assert.equal(outputHostnameCandidate.approved, false);
  assert.equal(outputHostnameCandidate.hostname, "v16m-default.tiktokcdn.com");
  assert.equal(outputReviewTemplate(w, f.attempt.id, media.owner).hostname, "");
  const approval = outputApproval(f);
  for (const patch of [
    { hostname: "*.tiktokcdn.com" },
    { hostname: "127.0.0.1" },
    { fps: null },
    { maxDurationSeconds: 7 },
    { acknowledgment: "" },
  ])
    assert.throws(() =>
      reviewOutput(
        w,
        f.attempt.id,
        media.owner,
        { ...approval.review, ...patch },
        6,
      ),
    );
  let requests = 0;
  const transport = async () => {
    requests++;
    return new Response(resultBytes);
  };
  await assert.rejects(
    downloadFirstTestResult(
      w,
      f.attempt.id,
      "other",
      f.review,
      f.confirmation,
      approval.review,
      approval.digest,
      transport,
    ),
  );
  await assert.rejects(
    downloadFirstTestResult(
      w,
      f.attempt.id,
      media.owner,
      f.review,
      f.confirmation,
      approval.review,
      "bad",
      transport,
    ),
  );
  const env: Record<string, string> = f.env;
  env.BYTEPLUS_FIRST_TEST_DOWNLOAD_ENABLED = "false";
  await assert.rejects(
    downloadFirstTestResult(
      w,
      f.attempt.id,
      media.owner,
      f.review,
      f.confirmation,
      approval.review,
      approval.digest,
      transport,
    ),
  );
  assert.equal(requests, 0);
});

test("expired URL stops safely; resumed download validates private MP4 without any new provider operation", async () => {
  const f = await observedFixture(),
    w = f.make(),
    approval = outputApproval(f);
  await assert.rejects(
    downloadFirstTestResult(
      w,
      f.attempt.id,
      media.owner,
      f.review,
      f.confirmation,
      approval.review,
      approval.digest,
      async () => new Response(null, { status: 403 }),
    ),
  );
  assert.equal(f.store.get(f.attempt.id).state, "output_observed");
  const before = f.counts();
  const result = await downloadFirstTestResult(
    w,
    f.attempt.id,
    media.owner,
    f.review,
    f.confirmation,
    approval.review,
    approval.digest,
    async () => new Response(resultBytes),
  );
  assert.equal(result.state, "completed");
  assert.ok(
    result.outputPath?.startsWith(path.join(root, "live-output") + path.sep),
  );
  assert.equal(f.store.firstTestResult(f.attempt.id)!.result.downloaded, true);
  const recovered = await downloadFirstTestResult(
    w,
    f.attempt.id,
    media.owner,
    f.review,
    f.confirmation,
    approval.review,
    approval.digest,
    async () => {
      throw Error("Must recover locally");
    },
  );
  assert.equal(recovered.outputPath, result.outputPath);
  assert.deepEqual(f.counts(), before);
  assert.equal(f.counts().submits, 1);
  assert.equal(
    f.store.db
      .prepare("SELECT reserved_micro_usd FROM live_attempts WHERE id=?")
      .get(f.attempt.id)!.reserved_micro_usd,
    500000,
  );
});

test("explicit read-only refresh keeps task ID; changed host needs new exact approval", async () => {
  const f = await observedFixture(),
    w = f.make(),
    approval = outputApproval(f);
  f.url("https://changed-output.example/video?new=token");
  await w.refreshResult(f.attempt.id, media.owner, f.review, f.confirmation);
  assert.equal(
    f.store.firstTestResult(f.attempt.id)!.result.observedHostname,
    "changed-output.example",
  );
  let requests = 0;
  await assert.rejects(
    downloadFirstTestResult(
      w,
      f.attempt.id,
      media.owner,
      f.review,
      f.confirmation,
      approval.review,
      approval.digest,
      async () => {
        requests++;
        return new Response(resultBytes);
      },
    ),
    /approved HTTPS/,
  );
  assert.equal(requests, 0);
  assert.equal(f.counts().submits, 1);
  const updated = outputApproval(f, "changed-output.example");
  await downloadFirstTestResult(
    w,
    f.attempt.id,
    media.owner,
    f.review,
    f.confirmation,
    updated.review,
    updated.digest,
    async () => new Response(resultBytes),
  );
  assert.equal(f.counts().submits, 1);
});

test("crash after rename recovers even with expired URL; invalid media is never committed", async () => {
  const f = await observedFixture(),
    w = f.make(),
    approval = outputApproval(f);
  await assert.rejects(
    downloadFirstTestResult(
      w,
      f.attempt.id,
      media.owner,
      f.review,
      f.confirmation,
      approval.review,
      approval.digest,
      async () => new Response("invalid MP4"),
    ),
  );
  assert.equal(f.store.get(f.attempt.id).state, "output_observed");
  // Simulate a completed rename followed by a process crash before DB commit.
  const directory = path.join(root, "live-output");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, `${f.attempt.id}.${approval.digest}.mp4`),
    resultBytes,
    { mode: 0o600 },
  );
  const result = await downloadFirstTestResult(
    w,
    f.attempt.id,
    media.owner,
    f.review,
    f.confirmation,
    approval.review,
    approval.digest,
    async () => {
      throw Error("No network on recovery");
    },
  );
  assert.equal(result.state, "completed");
  assert.equal(f.store.firstTestResult(f.attempt.id)!.result.downloaded, true);
});

test("concurrent or stale output lease cannot commit or overwrite an MP4", async (t) => {
  const f = await observedFixture(),
    w = f.make(),
    approval = outputApproval(f);
  const lock = f.store.claimOutputDownload(f.attempt.id);
  await assert.rejects(
    downloadFirstTestResult(
      w,
      f.attempt.id,
      media.owner,
      f.review,
      f.confirmation,
      approval.review,
      approval.digest,
      async () => {
        throw Error("No transfer while locked");
      },
    ),
    /Another worker/,
  );
  f.store.releasePoll(f.attempt.id, lock);
  const clock = Date.now();
  await assert.rejects(
    downloadFirstTestResult(
      w,
      f.attempt.id,
      media.owner,
      f.review,
      f.confirmation,
      approval.review,
      approval.digest,
      async () => {
        t.mock.method(Date, "now", () => clock + 601000);
        return new Response(resultBytes);
      },
    ),
    /lease expired/,
  );
  assert.equal(f.store.get(f.attempt.id).state, "output_observed");
  assert.equal(f.store.get(f.attempt.id).outputPath, null);
});

test("review diagnostics aggregate missing/invalid fields without echoing private values", async () => {
  const { ReviewValidationError } =
    await import("../lib/live/review-diagnostics.ts");
  const f = fixture();
  assert.throws(
    () =>
      validateFirstTestReview(firstTestReviewTemplate(f.attempt), f.attempt),
    (error) => {
      assert.ok(error instanceof ReviewValidationError);
      assert.deepEqual(
        error.issues.map((issue) => issue.field).sort(),
        [
          "generatedVideoMaxSeconds",
          "baseMaxMicroUsd",
          "taxMaxMicroUsd",
          "feesMaxMicroUsd",
          "inclusiveMaxMicroUsd",
          "reviewedBy",
          "reviewedAt",
          "evidence",
          "acknowledgment",
        ].sort(),
      );
      return true;
    },
  );
  const privateValue = "https://private.invalid/object?signature=DO_NOT_PRINT";
  const bad = {
    ...f.review,
    owner: privateValue,
    taxMaxMicroUsd: "secret-key-value",
    feesMaxMicroUsd: -1,
    generatedVideoMaxSeconds: 7,
    reviewedBy: " ",
    reviewedAt: "2999-01-01",
    evidence: "x".repeat(4001),
    acknowledgment: "no",
    [privateValue]: "private value",
  };
  delete (bad as Partial<typeof bad>).imageSha256;
  assert.throws(
    () => validateFirstTestReview(bad, f.attempt),
    (error) => {
      assert.ok(error instanceof ReviewValidationError);
      for (const field of [
        "owner",
        "taxMaxMicroUsd",
        "feesMaxMicroUsd",
        "generatedVideoMaxSeconds",
        "reviewedBy",
        "reviewedAt",
        "evidence",
        "acknowledgment",
        "imageSha256",
        "review",
      ])
        assert.ok(
          error.issues.some((issue) => issue.field === field),
          field,
        );
      const diagnostic = JSON.stringify(error.issues);
      for (const secret of [
        privateValue,
        "secret-key-value",
        media.owner,
        media.audioSha256,
        media.prompt,
      ])
        assert.ok(!diagnostic.includes(secret));
      return true;
    },
  );
  assert.throws(
    () =>
      validateFirstTestReview(
        { ...f.review, baseMaxMicroUsd: 1, inclusiveMaxMicroUsd: 2 },
        f.attempt,
      ),
    (error) => {
      assert.ok(error instanceof ReviewValidationError);
      assert.ok(
        error.issues.some((issue) => issue.field === "baseMaxMicroUsd"),
      );
      assert.ok(
        error.issues.some((issue) => issue.field === "inclusiveMaxMicroUsd"),
      );
      return true;
    },
  );
});

test("offline CLI emits sanitized field diagnostics for incomplete, malformed and unreadable review files", async () => {
  const f = fixture(path.join(root, "live-test.sqlite"));
  const file = path.join(root, "diagnostics review.json");
  const cli = (action = "dry-run") =>
    spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--import",
        "./tests/fixtures/offline-network-guard.mjs",
        "scripts/byteplus-first-test.ts",
        action,
        "--plan",
        f.attempt.id,
        "--owner",
        media.owner,
        "--review-file",
        file,
      ],
      {
        env: {
          ...process.env,
          DATA_DIR: root,
          BYTEPLUS_SECRET_ACCESS_KEY: "NEVER_PRINT_ENV_SECRET",
        },
        encoding: "utf8",
        timeout: 30000,
      },
    );
  const before = f.store.get(f.attempt.id);
  await writeFile(
    file,
    "\uFEFF" + JSON.stringify(firstTestReviewTemplate(f.attempt)),
  );
  const incomplete = cli();
  assert.equal(incomplete.status, 1);
  assert.equal(incomplete.stdout, "");
  assert.match(incomplete.stderr, /OFFLINE_REVIEW_INVALID/);
  for (const field of [
    "taxMaxMicroUsd",
    "feesMaxMicroUsd",
    "reviewedBy",
    "evidence",
    "acknowledgment",
  ])
    assert.match(incomplete.stderr, new RegExp(`"field": "${field}"`));
  await writeFile(
    file,
    '{"evidence":"https://private.invalid/?signature=NEVER_PRINT_PARSE_SECRET", broken',
  );
  const malformed = cli();
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /valid JSON/);
  assert.doesNotMatch(malformed.stderr, /NEVER_PRINT|private\.invalid/);
  await rm(file);
  const missing = cli();
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Cannot read the review file/);
  assert.ok(!missing.stderr.includes(file));
  await writeFile(file, "x".repeat(65537));
  assert.match(cli().stderr, /65536 bytes/);
  await writeFile(file, JSON.stringify(f.review));
  const valid = cli();
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(valid.stdout).confirmationDigest, f.confirmation);
  const live = cli("run");
  assert.equal(live.status, 1);
  assert.doesNotMatch(live.stderr, /OFFLINE_REVIEW_INVALID|NEVER_PRINT/);
  assert.match(live.stderr, /First-test command stopped/);
  assert.deepEqual(f.store.get(f.attempt.id), before); // No pricing, reservation or mutation.
});

test("output review during queue enables prompt same-task retrieval without a second submit", async () => {
  const { retrieveFirstTestResult } =
    await import("../lib/live/first-test-download.ts");
  const f = fixture(),
    w = f.make();
  assert.throws(() => outputReviewTemplate(w, f.attempt.id, media.owner));
  await w.submit(f.attempt.id, media.owner, f.review, f.confirmation);
  const approval = outputApproval(f); // Still submitted, before a video URL exists.
  const env: Record<string, string> = f.env;
  env.BYTEPLUS_FIRST_TEST_DOWNLOAD_ENABLED = "true";
  let waits = 0,
    downloads = 0;
  f.mode("pending");
  const result = await retrieveFirstTestResult(
    w,
    f.attempt.id,
    media.owner,
    f.review,
    f.confirmation,
    approval.review,
    approval.digest,
    {
      wait: async () => {
        waits++;
        f.mode("done");
      },
      transport: async () => {
        downloads++;
        return new Response(resultBytes);
      },
    },
  );
  assert.equal(result.state, "completed");
  assert.equal(waits, 1);
  assert.equal(downloads, 1);
  assert.deepEqual(f.counts(), {
    uploads: 1,
    submits: 1,
    polls: 2,
    cancels: 0,
  });
});

test("retrieve requires output approval before polling and stops on changed host or read failure", async () => {
  const { retrieveFirstTestResult } =
    await import("../lib/live/first-test-download.ts");
  const f = fixture(),
    w = f.make();
  await w.submit(f.attempt.id, media.owner, f.review, f.confirmation);
  const approval = outputApproval(f);
  const env: Record<string, string> = f.env;
  env.BYTEPLUS_FIRST_TEST_DOWNLOAD_ENABLED = "true";
  let transfers = 0;
  const dependencies = {
    transport: async () => {
      transfers++;
      return new Response(resultBytes);
    },
  };
  await assert.rejects(
    retrieveFirstTestResult(
      w,
      f.attempt.id,
      media.owner,
      f.review,
      f.confirmation,
      approval.review,
      "wrong",
      dependencies,
    ),
  );
  assert.equal(f.counts().polls, 0);
  f.mode("poll-error");
  await assert.rejects(
    retrieveFirstTestResult(
      w,
      f.attempt.id,
      media.owner,
      f.review,
      f.confirmation,
      approval.review,
      approval.digest,
      dependencies,
    ),
  );
  assert.equal(f.counts().polls, 1);
  f.mode("done");
  f.url("https://changed-output.example/v");
  await assert.rejects(
    retrieveFirstTestResult(
      w,
      f.attempt.id,
      media.owner,
      f.review,
      f.confirmation,
      approval.review,
      approval.digest,
      dependencies,
    ),
    /approved HTTPS/,
  );
  assert.equal(transfers, 0);
  assert.equal(f.counts().submits, 1);
  assert.equal(f.store.get(f.attempt.id).state, "output_observed");
});

test("actual retrieve CLI polls saved task and saves validated MP4 without R2 credentials or submit", async () => {
  const directory = path.join(root, "retrieve cli");
  await mkdir(directory);
  const f = fixture(path.join(directory, "live-test.sqlite"));
  await f.make().submit(f.attempt.id, media.owner, f.review, f.confirmation);
  const approval = outputApproval(f),
    costFile = path.join(directory, "cost.json"),
    outputFile = path.join(directory, "output.json"),
    calls = path.join(directory, "calls.jsonl");
  await writeFile(costFile, JSON.stringify(f.review));
  await writeFile(outputFile, JSON.stringify(approval.review));
  const env = {
    ...process.env,
    ...f.env,
    DATA_DIR: directory,
    BYTEPLUS_ACCESS_KEY_ID: "fake",
    BYTEPLUS_SECRET_ACCESS_KEY: "fake",
    BYTEPLUS_FIRST_TEST_DOWNLOAD_ENABLED: "true",
    FIRST_TEST_MOCK_CALLS: calls,
    FIRST_TEST_MOCK_OUTPUT_FILE: clip,
    R2_ACCOUNT_ID: "",
    R2_BUCKET: "",
    R2_ACCESS_KEY_ID: "",
    R2_SECRET_ACCESS_KEY: "",
  };
  const command = () =>
    spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--import",
        "./tests/fixtures/first-test-network-mock.mjs",
        "scripts/byteplus-first-test.ts",
        "retrieve",
        "--plan",
        f.attempt.id,
        "--owner",
        media.owner,
        "--review-file",
        costFile,
        "--confirm-live-test",
        f.confirmation,
        "--output-review-file",
        outputFile,
        "--confirm-output",
        approval.digest,
      ],
      { env, encoding: "utf8", timeout: 30000 },
    );
  const result = command();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).state, "completed");
  assert.equal(command().status, 0); // Completed file is recovered locally.
  assert.deepEqual((await readFile(calls, "utf8")).trim().split("\n"), [
    "CVSync2AsyncGetResult",
    "OUTPUT_GET",
  ]);
  assert.equal(f.counts().submits, 1);
});
