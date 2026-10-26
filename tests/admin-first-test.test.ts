import { PollError } from "../lib/live/poll-error.ts";
import { BytePlusTransportError } from "../lib/live/signed-transport.ts";
import { validateOutput } from "../lib/live/output.ts";
import { validateFirstTestReview } from "../lib/live/first-test.ts";
import { AppError } from "../lib/domain.ts";
import { test, beforeEach, after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import tls from "node:tls";
import sharp from "sharp";
import {
  AdminFirstTest,
  adminTestOwner,
  adminTestEnvironment,
} from "../cms/first-test.ts";
import {
  PreparationError,
  preparationError,
} from "../cms/preparation-error.ts";
import { retainedInputPaths } from "../lib/live/cleanup.ts";
import { LiveTestStore } from "../lib/live/store.ts";
import { validateStaging } from "../lib/staging.ts";
const root = await mkdtemp(path.join(tmpdir(), "admin-test-"));
const audio = path.join(root, "source.mp3"),
  video = path.join(root, "result.mp4");
execFileSync("ffmpeg", [
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  "sine=duration=4.5",
  "-c:a",
  "libmp3lame",
  audio,
]);
execFileSync("ffmpeg", [
  "-v",
  "error",
  "-i",
  "public/media/demo.mp4",
  "-t",
  "5.3",
  "-c",
  "copy",
  video,
]);
const audioBytes = await readFile(audio),
  videoBytes = await readFile(video);
const imageBytes = await sharp({
  create: { width: 512, height: 512, channels: 3, background: "white" },
})
  .png()
  .toBuffer();
const user = { id: 12, collection: "staff", role: "super-admin" };
const base = {
  CMS_ENABLED: "true",
  CMS_ORIGIN: "https://staging.example.test",
  STAGING_AUTH_ENABLED: "true",
  STAGING_PASSWORD: "mock-only-strong-password-not-for-deployment",
  DEMO_MODE: "true",
  GENERATIONS_ENABLED: "false",
  ADMIN_DEMO_ENABLED: "false",
  BYTEPLUS_LIVE_TEST_ENABLED: "false",
  BYTEPLUS_ADMIN_TEST_ENABLED: "true",
  BYTEPLUS_FIRST_TEST_ENABLED: "true",
  BYTEPLUS_FIRST_TEST_DOWNLOAD_ENABLED: "true",
  BYTEPLUS_LIVE_TEST_OPERATOR_SECRET:
    "mock-only-operator-secret-not-for-deployment",
  BYTEPLUS_LIVE_TEST_MAX_DURATION_SECONDS: "5",
  BYTEPLUS_LIVE_TEST_MAX_JOB_MICRO_USD: "500000",
  BYTEPLUS_LIVE_TEST_MAX_TOTAL_MICRO_USD: "500000",
};
beforeEach((context) => {
  const t = context as TestContext;
  const deny = () => {
    throw Error("Real network forbidden");
  };
  t.mock.method(globalThis, "fetch", deny);
  t.mock.method(net.Socket.prototype, "connect", deny);
  t.mock.method(tls, "connect", deny);
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});
async function fixture(t: TestContext) {
  const dir = await mkdtemp(path.join(root, "case-"));
  const store = new LiveTestStore(path.join(dir, "live-test.sqlite"));
  t.after(() => store.close());
  const env: Record<string, string> = { ...base };
  let submits = 0,
    uploads = 0,
    downloads = 0,
    mode = "done";
  const deps = {
    transport: async (request: { url: string }) => {
      const action = new URL(request.url).searchParams.get("Action");
      if (action === "CVSync2AsyncSubmitTask") {
        submits++;
        if (mode === "uncertain") throw Error("SECRET");
        return {
          status: 200,
          body: {
            code: 10000,
            data: {
              task_id: submits === 1 ? "mock-task" : `mock-task-${submits}`,
            },
          },
        };
      }
      if (action === "CVCancelTask")
        return { status: 200, body: { code: 10000, data: {} } };
      if (mode === "read-error") throw Error("SECRET");
      if (mode === "auth-error")
        throw new BytePlusTransportError("authentication", 403);
      if (mode === "throttled")
        throw new BytePlusTransportError("throttled", 429);
      if (mode === "provider-error")
        return {
          status: 500,
          body: { code: 50510, message: "SECRET private URL" },
        };
      if (mode === "unsupported")
        return {
          status: 200,
          body: { code: 10000, data: { status: "SECRET" } },
        };
      if (mode === "missing-url")
        return { status: 200, body: { code: 10000, data: { status: "done" } } };
      return {
        status: 200,
        body: {
          code: 10000,
          data: {
            status:
              mode === "failed"
                ? "expired"
                : mode === "pending"
                  ? "in_queue"
                  : "done",
            ...(mode === "done"
              ? { video_url: "https://output.example/result.mp4?secret=bearer" }
              : {}),
          },
        },
      };
    },
    delivery: {
      issue: async (media: import("../lib/live/store.ts").PreparedMedia) => {
        uploads++;
        return {
          owner: media.owner,
          audioSha256: media.audioSha256,
          imageSha256: media.imageSha256,
          imageUrl: "https://input.example/image",
          audioUrl: "https://input.example/audio",
          expiresAt: Date.now() + 13 * 3600000,
        };
      },
    },
    inputHosts: ["input.example"],
    output: async () => {
      downloads++;
      return new Response(videoBytes, {
        headers: { "content-type": "video/mp4" },
      });
    },
  };
  const make = () => new AdminFirstTest(store, dir, "cms-staff-12", env, deps);
  const service = make();
  const prepared = await service.upload(
    new File([new Uint8Array(imageBytes)], "singer.png"),
    new File([audioBytes], "clip.mp3"),
    "Sing gently.",
    true,
    true,
  );
  const id = prepared.plan!.id;
  env.BYTEPLUS_FIRST_TEST_PLAN_ID = id;
  const cost = {
    ...prepared.plan!.costReview,
    generatedVideoMaxSeconds: 6,
    baseMaxMicroUsd: 420000,
    taxMaxMicroUsd: 80000,
    feesMaxMicroUsd: 0,
    inclusiveMaxMicroUsd: 500000,
    reviewedBy: "Mock reviewer",
    reviewedAt: "2026-01-01T00:00:00Z",
    evidence:
      "Fictional test-only inclusive cost evidence; NOT real billing approval.",
    acknowledgment: "INCLUSIVE_BOUND_FOR_EXACT_INPUT",
  };
  const approved = await service.saveReview(id, "cost", cost),
    digest = approved.plan!.costDigest!;
  await service.saveReview(id, "output", {
    ...approved.plan!.outputReview!,
    hostname: "output.example",
    width: 1280,
    height: 720,
    fps: 25,
    minDurationSeconds: 4,
    maxDurationSeconds: 6,
    videoCodec: "h264",
    audioCodec: "aac",
    reviewedBy: "Mock reviewer",
    reviewedAt: "2026-01-01T00:00:00Z",
    evidence: "Mock-only host/media approval, not real evidence.",
    acknowledgment: "APPROVE_EXACT_HOST_AND_MEDIA_POLICY",
  });
  const phrase = `AUTHORIZE ONE PAID BYTEPLUS TEST ${id} UP TO 500000 MICROUSD`;
  return {
    service,
    store,
    env,
    id,
    cost,
    digest,
    phrase,
    make,
    deps,
    dir,
    mode: (value: string) => {
      mode = value;
    },
    counts: () => ({ submits, uploads, downloads }),
  };
}
test("admin authentication, role, Origin and isolated server authorization remain fail-closed", () => {
  for (const bad of [
    null,
    { ...user, id: undefined },
    { ...user, role: "editor" },
    { ...user, role: "support" },
    { ...user, collection: "customers" },
  ])
    assert.throws(() =>
      adminTestOwner(
        bad,
        "POST",
        new Headers({ origin: base.CMS_ORIGIN }),
        base,
      ),
    );
  for (const origin of ["", "https://evil.example"])
    assert.throws(() =>
      adminTestOwner(user, "POST", new Headers({ origin }), base),
    );
  assert.equal(
    adminTestOwner(
      user,
      "POST",
      new Headers({ origin: base.CMS_ORIGIN }),
      base,
    ),
    "cms-staff-12",
  );
  assert.throws(() =>
    adminTestOwner(user, "GET", new Headers(), {
      ...base,
      CMS_ENABLED: "false",
    }),
  );
  const env = { ...base, BYTEPLUS_FIRST_TEST_PLAN_ID: "plan" };
  validateStaging(env);
  const scoped = adminTestEnvironment(env, "plan");
  assert.equal(scoped.BYTEPLUS_LIVE_TEST_ENABLED, "true");
  assert.equal(env.BYTEPLUS_LIVE_TEST_ENABLED, "false");
  assert.throws(() =>
    adminTestEnvironment(
      { ...env, BYTEPLUS_ADMIN_TEST_ENABLED: "false" },
      "plan",
    ),
  );
  assert.throws(() => adminTestEnvironment(env, "another-plan"));
  assert.throws(() =>
    adminTestEnvironment({ ...env, GENERATIONS_ENABLED: "true" }, "plan"),
  );
});
test("private uploads, unchanged hashes, ownership, explicit confirmation and cost caps", async (t) => {
  const f = await fixture(t);
  const stranger = new AdminFirstTest(
    f.store,
    f.dir,
    "cms-staff-99",
    f.env,
    f.deps,
  );
  await assert.rejects(stranger.status(f.id));
  assert.equal((await stranger.status()).plan, null);
  await assert.rejects(
    f.service.saveReview(f.id, "cost", { ...f.cost, taxMaxMicroUsd: null }),
  );
  await assert.rejects(f.service.execute("start", f.id, f.digest, "", "wrong"));
  f.env.BYTEPLUS_LIVE_TEST_MAX_JOB_MICRO_USD = "1";
  await assert.rejects(
    f.service.execute("start", f.id, f.digest, "", f.phrase),
  );
  assert.deepEqual(f.counts(), { submits: 0, uploads: 0, downloads: 0 });
  f.env.BYTEPLUS_LIVE_TEST_MAX_JOB_MICRO_USD = "500000";
  await writeFile(f.store.get(f.id).media.audioPath, "changed");
  await assert.rejects(
    f.service.execute("start", f.id, f.digest, "", f.phrase),
  );
  assert.equal(f.counts().submits, 0);
});
test("one task persists across requests, requires output approval and saves validated MP4 without resubmission", async (t) => {
  const f = await fixture(t);
  await f.service.execute("start", f.id, f.digest, "", f.phrase);
  await assert.rejects(
    f.service.execute("start", f.id, f.digest, "", f.phrase),
  );
  await assert.rejects(f.service.saveReview(f.id, "cost", f.cost));
  f.mode("read-error");
  await assert.rejects(f.make().execute("poll", f.id, f.digest, "", ""));
  assert.equal(f.store.get(f.id).providerJobId, "mock-task");
  f.mode("done");
  const observed = await f.make().execute("poll", f.id, f.digest, "", "");
  assert.equal(observed.plan!.observedHostname, "output.example");
  assert.ok(!JSON.stringify(observed).includes("bearer"));
  assert.ok(!JSON.stringify(observed).includes(f.dir));
  await assert.rejects(f.service.execute("download", f.id, f.digest, "", ""));
  assert.equal(f.counts().downloads, 0);
  const output = {
    ...observed.plan!.outputReview!,
    hostname: "output.example",
    width: 1280,
    height: 720,
    fps: 25,
    minDurationSeconds: 4,
    maxDurationSeconds: 6,
    videoCodec: "h264",
    audioCodec: "aac",
    reviewedBy: "Mock reviewer",
    reviewedAt: "2026-01-01T00:00:00Z",
    evidence: "Mock host/media evidence only, never production approval.",
    acknowledgment: "APPROVE_EXACT_HOST_AND_MEDIA_POLICY",
  };
  await assert.rejects(
    f.service.saveReview(f.id, "output", { ...output, hostname: "127.0.0.1" }),
  );
  // Reuse the pre-submit policy after a fresh service instance/restart; no new approval or task.
  const approved = observed;
  const completed = await f
    .make()
    .execute("download", f.id, f.digest, approved.plan!.outputDigest!, "");
  assert.equal(completed.plan!.state, "completed");
  assert.ok((await readFile(f.store.get(f.id).outputPath!)).length > 1000);
  await f
    .make()
    .execute("download", f.id, f.digest, approved.plan!.outputDigest!, "");
  assert.deepEqual(f.counts(), { submits: 1, uploads: 1, downloads: 1 });
});
test("concurrent submissions and uncertainty cannot consume a second task; shared slot survives another plan", async (t) => {
  const f = await fixture(t);
  f.mode("uncertain");
  await Promise.allSettled([
    f.service.execute("start", f.id, f.digest, "", f.phrase),
    f.make().execute("start", f.id, f.digest, "", f.phrase),
  ]);
  assert.equal(f.store.get(f.id).state, "uncertain");
  assert.equal(f.counts().submits, 1);
  await assert.rejects(f.make().execute("start", f.id, f.digest, "", f.phrase));
  await assert.rejects(
    f.service.upload(
      new File([new Uint8Array(imageBytes)], "x.png"),
      new File([audioBytes], "x.mp3"),
      "",
      true,
      true,
    ),
  );
});
test("failed and canceled tasks retain reservation and cannot restart", async (t) => {
  for (const mode of ["failed", "pending"]) {
    const f = await fixture(t);
    await f.service.execute("start", f.id, f.digest, "", f.phrase);
    f.mode(mode);
    await f.service.execute(
      mode === "failed" ? "poll" : "cancel",
      f.id,
      f.digest,
      "",
      "",
    );
    assert.equal(f.store.get(f.id).state, "failed");
    await assert.rejects(
      f.service.execute("start", f.id, f.digest, "", f.phrase),
    );
    assert.equal(f.counts().submits, 1);
  }
});
test("invalid image, actual encoded duration and unconfirmed uploads fail without providers", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.service.upload(
      new File(["bad"], "x.png"),
      new File([audioBytes], "x.mp3"),
      "",
      true,
      true,
    ),
    (error: unknown) =>
      error instanceof PreparationError &&
      error.code === "prepare-image" &&
      /300–4096/.test(error.message),
  );
  await assert.rejects(
    f.service.upload(
      new File([new Uint8Array(imageBytes)], "x.png"),
      new File([audioBytes], "x.mp3"),
      "",
      false,
      true,
    ),
  );
  const long = path.join(root, "long.mp3");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=duration=5.3",
    "-c:a",
    "libmp3lame",
    long,
  ]);
  await assert.rejects(
    f.service.upload(
      new File([new Uint8Array(imageBytes)], "x.png"),
      new File([await readFile(long)], "x.mp3"),
      "",
      true,
      true,
    ),
    (error: unknown) =>
      error instanceof PreparationError &&
      error.code === "audio-duration" &&
      /measured 5\./.test(error.message),
  );
  assert.equal(f.store.get(f.id).state, "prepared");
  assert.equal(
    (await readFile(f.store.get(f.id).media.audioPath)).length,
    audioBytes.length,
  );
  assert.equal(f.counts().submits, 0);
});

test("demo cleanup retains immutable unpriced administrator inputs", async (t) => {
  const f = await fixture(t);
  const media = f.store.get(f.id).media;
  const paths = retainedInputPaths(f.dir);
  assert.ok(paths.includes(media.imagePath));
  assert.ok(paths.includes(media.audioPath));
});

test("preparation diagnostics distinguish server setup and never expose raw errors", () => {
  assert.equal(
    preparationError(new AppError("private error", 429), "plan").code,
    "prepare-rate-limit",
  );
  for (const [code, stage, expected] of [
    ["ENOENT", "audio", "ffprobe-unavailable"],
    ["EACCES", "storage", "storage-permission"],
    ["ENOSPC", "storage", "storage-full"],
    ["ERR_SQLITE_ERROR", "plan", "database-busy"],
    ["UNKNOWN", "multipart", "prepare-multipart"],
  ] as const) {
    const raw = Object.assign(
      new Error("SECRET /private/path https://private.test/?signature=SECRET"),
      { code, errcode: 5, path: "ffprobe" },
    );
    const safe = preparationError(raw, stage);
    assert.equal(safe.code, expected);
    assert.ok(!safe.message.includes("SECRET"));
    assert.ok(!safe.message.includes("/private/path"));
    assert.ok(!safe.message.includes("signature="));
  }
});

test("invalid MP3 and missing ffprobe surface safe preparation diagnostics without changing an existing plan", async (t) => {
  const f = await fixture(t);
  const saved = f.store.get(f.id);
  const upload = (bytes: Uint8Array) =>
    f.service.upload(
      new File([new Uint8Array(imageBytes)], "singer.png"),
      new File([new Uint8Array(bytes)], "clip.mp3"),
      "",
      true,
      true,
    );
  await assert.rejects(
    upload(Buffer.from("not audio")),
    (error: unknown) =>
      error instanceof PreparationError &&
      error.code === "prepare-audio" &&
      !error.message.includes(f.dir),
  );
  const originalPath = process.env.PATH;
  try {
    process.env.PATH = path.join(f.dir, "no-executables");
    await assert.rejects(
      upload(audioBytes),
      (error: unknown) =>
        error instanceof PreparationError &&
        error.code === "ffprobe-unavailable",
    );
  } finally {
    process.env.PATH = originalPath;
  }
  assert.deepEqual(f.store.get(f.id), saved);
  assert.deepEqual(await readFile(saved.media.audioPath), audioBytes);
  assert.equal(f.counts().uploads, 0);
  assert.equal(f.counts().submits, 0);
});

test("paid admin start requires pre-approved output policy, download gate and remaining budget", async (t) => {
  const f = await fixture(t);
  const approved = await f.service.status(f.id);
  assert.deepEqual(approved.startBlockers, []);
  f.env.BYTEPLUS_FIRST_TEST_DOWNLOAD_ENABLED = "false";
  await assert.rejects(
    f.service.execute("start", f.id, f.digest, "", f.phrase),
    /DOWNLOAD_ENABLED/,
  );
  f.env.BYTEPLUS_FIRST_TEST_DOWNLOAD_ENABLED = "true";
  f.store.db
    .prepare("UPDATE live_admin_reviews SET output_json=NULL WHERE plan_id=?")
    .run(f.id);
  await assert.rejects(
    f.service.execute("start", f.id, f.digest, "", f.phrase),
    /output hostname/,
  );
  assert.equal(f.counts().submits, 0);
  assert.equal(f.counts().uploads, 0);
  assert.equal(f.store.firstTest(), undefined);
});
test("readiness names missing settings without returning secrets and invalidates policy when cost changes", async (t) => {
  const f = await fixture(t);
  delete f.env.BYTEPLUS_FIRST_TEST_PLAN_ID;
  f.env.BYTEPLUS_LIVE_TEST_OPERATOR_SECRET = "secret-too-short";
  f.env.BYTEPLUS_LIVE_TEST_MAX_TOTAL_MICRO_USD = "1";
  const report = await f.service.status(f.id);
  assert.ok(
    report.startBlockers!.some((x) =>
      x.includes("BYTEPLUS_FIRST_TEST_PLAN_ID"),
    ),
  );
  assert.ok(
    report.startBlockers!.some((x) =>
      x.includes("BYTEPLUS_LIVE_TEST_OPERATOR_SECRET"),
    ),
  );
  assert.ok(
    report.startBlockers!.some((x) =>
      x.includes("BYTEPLUS_LIVE_TEST_MAX_TOTAL_MICRO_USD"),
    ),
  );
  assert.ok(!JSON.stringify(report).includes("secret-too-short"));
  const changed = await f.service.saveReview(f.id, "cost", {
    ...f.cost,
    evidence: "Different mock evidence",
  });
  assert.equal(changed.plan!.outputDigest, null);
});

test("repeated offline preparation reuses the existing owned plan and media", async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 6; i++) {
    const same = await f.service.upload(
      new File([new Uint8Array(imageBytes)], "singer.png"),
      new File([audioBytes], "clip.mp3"),
      "Sing gently.",
      true,
      true,
    );
    assert.equal(same.plan!.id, f.id);
    assert.equal(same.plan!.costDigest, f.digest);
    assert.ok(same.plan!.outputDigest);
  }
  assert.equal(f.counts().submits, 0);
  const route = await readFile(
    "app/(payload)/api/admin/first-test/route.ts",
    "utf8",
  );
  assert.ok(
    route.indexOf("adminTestOwner(user") < route.indexOf("if (multipart)"),
  );
  assert.ok(!route.includes("cms:first-test:upload:"));
  assert.ok(route.includes("60, 60000"));
  const publicApi = await readFile("app/(site)/api/[...path]/route.ts", "utf8");
  assert.ok(publicApi.includes("limit(`${owner}:upload`, 15)"));
});

test("aggregate inclusive review keeps unknown breakdown null, binds evidence and enforces caps", async (t) => {
  const f = await fixture(t);
  const old = (await f.service.status(f.id)).plan!.outputReview!;
  const total = {
    ...f.cost,
    baseMaxMicroUsd: null,
    taxMaxMicroUsd: null,
    feesMaxMicroUsd: null,
    acknowledgment: "INCLUSIVE_TOTAL_BOUND_FOR_EXACT_INPUT",
  };
  const attempt = f.store.get(f.id);
  for (const invalid of [
    { ...total, inclusiveMaxMicroUsd: 419999 },
    { ...total, inclusiveMaxMicroUsd: 0 },
    { ...total, evidence: "" },
    { ...total, generatedVideoMaxSeconds: null },
    { ...total, taxMaxMicroUsd: 0 },
    { ...total, inclusiveMaxMicroUsd: Number.MAX_SAFE_INTEGER + 1 },
    { ...total, planId: "different-plan" },
  ])
    assert.throws(() => validateFirstTestReview(invalid, attempt));
  const saved = await f.service.saveReview(f.id, "cost", total);
  assert.equal(saved.plan!.costReview.taxMaxMicroUsd, null);
  assert.equal(saved.plan!.costReview.feesMaxMicroUsd, null);
  assert.equal(saved.plan!.costReview.inclusiveMaxMicroUsd, 500000);
  assert.equal(saved.plan!.outputDigest, null);
  await f.service.saveReview(f.id, "output", {
    ...old,
    costReviewDigest: saved.plan!.costDigest,
  });
  f.env.BYTEPLUS_LIVE_TEST_MAX_JOB_MICRO_USD = "499999";
  await assert.rejects(
    f.service.execute("start", f.id, saved.plan!.costDigest!, "", f.phrase),
  );
  assert.equal(f.counts().submits, 0);
  f.env.BYTEPLUS_LIVE_TEST_MAX_JOB_MICRO_USD = "500000";
  await f.service.execute("start", f.id, saved.plan!.costDigest!, "", f.phrase);
  await assert.rejects(
    f.service.execute("start", f.id, saved.plan!.costDigest!, "", f.phrase),
  );
  assert.equal(f.counts().submits, 1);
});

test("explicit discovery submits once without metadata, then requires exact host approval and validates private MP4", async (t) => {
  const f = await fixture(t);
  f.store.db
    .prepare("UPDATE live_admin_reviews SET output_json=NULL WHERE plan_id=?")
    .run(f.id);
  await assert.rejects(
    f.service.execute("start", f.id, f.digest, "", f.phrase),
  );
  await assert.rejects(
    f.service.execute("start", f.id, f.digest, "", f.phrase, true),
  );
  assert.equal(f.counts().submits, 0);
  await f.service.execute(
    "start",
    f.id,
    f.digest,
    "",
    f.phrase + " DISCOVER OUTPUT ONLY",
    true,
  );
  const observed = await f.make().execute("poll", f.id, f.digest, "", "");
  await assert.rejects(f.service.execute("download", f.id, f.digest, "", ""));
  assert.equal(f.counts().downloads, 0);
  const policy = {
    ...observed.plan!.outputReview!,
    kind: "first-test-output-discovery-v1",
    hostname: "output.example",
    minDurationSeconds: 1,
    maxDurationSeconds: 6,
    reviewedBy: "Mock reviewer",
    reviewedAt: "2026-01-01T00:00:00Z",
    evidence:
      "Mock-only exact host approval and bounded 720p discovery acceptance policy.",
    acknowledgment: "APPROVE_EXACT_HOST_AND_MEDIA_POLICY",
  };
  await assert.rejects(
    f.service.saveReview(f.id, "output", { ...policy, hostname: "127.0.0.1" }),
  );
  await assert.rejects(
    f.service.saveReview(f.id, "output", { ...policy, maxDurationSeconds: 7 }),
  );
  const approved = await f.service.saveReview(f.id, "output", policy);
  const result = await f
    .make()
    .execute("download", f.id, f.digest, approved.plan!.outputDigest!, "");
  assert.equal(result.plan!.state, "completed");
  assert.equal(result.plan!.validatedMedia!.height, 720);
  assert.equal(result.plan!.validatedMedia!.videoCodec, "h264");
  assert.deepEqual(f.counts(), { submits: 1, uploads: 1, downloads: 1 });
  await assert.rejects(
    f.service.execute(
      "start",
      f.id,
      f.digest,
      "",
      f.phrase + " DISCOVER OUTPUT ONLY",
      true,
    ),
  );
});

test("discovery acceptance rejects non-720p media and over-bound duration", async (t) => {
  const f = await fixture(t);
  const wrong = path.join(f.dir, "small.mp4");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-i",
    video,
    "-t",
    "1",
    "-vf",
    "scale=320:180",
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    wrong,
  ]);
  const policy = {
    outputHosts: ["output.example"],
    discover720p: true,
    output: { width: 0, height: 0, fps: 0, durationToleranceSeconds: 2.5 },
  };
  await assert.rejects(validateOutput(wrong, 3.5, policy), /OUTPUT_DIMENSIONS_MISMATCH_ACTUAL_320x180_EXPECTED_720P/);
  await assert.rejects(
    validateOutput(video, 1, {
      ...policy,
      output: { ...policy.output, durationToleranceSeconds: 0.1 },
    }),
    /OUTPUT_DURATION_MISMATCH/,
  );
});

test("poll diagnostics preserve task and budget through provider errors, lease contention and late recovery", async (t) => {
  const f = await fixture(t);
  await f.service.execute("start", f.id, f.digest, "", f.phrase);
  const slot = f.store.firstTest();
  const reservation = f.store.db
    .prepare("SELECT reserved_micro_usd FROM live_attempts WHERE id=?")
    .get(f.id);
  for (const [mode, code] of [
    ["auth-error", "TRANSPORT_AUTHENTICATION"],
    ["throttled", "TRANSPORT_THROTTLED"],
    ["provider-error", "PROVIDER_REJECTED"],
    ["unsupported", "UNSUPPORTED_TASK_STATUS"],
    ["missing-url", "COMPLETED_WITHOUT_VIDEO_URL"],
    ["read-error", "TRANSPORT_TRANSIENT"],
  ]) {
    f.mode(mode);
    await assert.rejects(
      f.make().execute("poll", f.id, f.digest, "", ""),
      (error: unknown) => {
        assert.ok(error instanceof PollError);
        assert.equal(error.code, code);
        assert.ok(!error.message.includes("SECRET"));
        if (mode === "provider-error") {
          assert.equal(error.providerCode, 50510);
          assert.equal(error.httpStatus, 500);
        }
        if (mode === "auth-error") assert.equal(error.httpStatus, 403);
        return true;
      },
    );
    assert.equal(f.store.get(f.id).providerJobId, "mock-task");
    assert.deepEqual(f.store.firstTest(), slot);
    assert.deepEqual(
      f.store.db
        .prepare("SELECT reserved_micro_usd FROM live_attempts WHERE id=?")
        .get(f.id),
      reservation,
    );
  }
  const lease = f.store.claimPoll(f.id);
  await assert.rejects(
    f.service.execute("poll", f.id, f.digest, "", ""),
    (e: unknown) => e instanceof PollError && e.code === "POLL_BUSY",
  );
  f.store.releasePoll(f.id, lease);
  f.store.db
    .prepare("UPDATE live_first_test SET claimed_at=?")
    .run(Date.now() - 13 * 3600000);
  f.mode("done");
  const done = await f.make().execute("poll", f.id, f.digest, "", "");
  assert.equal(done.plan!.state, "output_observed");
  const result = await f
    .make()
    .execute("download", f.id, f.digest, done.plan!.outputDigest!, "");
  assert.equal(result.plan!.state, "completed");
  assert.equal(f.counts().submits, 1);
  assert.equal(f.counts().uploads, 1);
});

test("previous task errors retain full reservation and show second-test reconciliation and budget blockers", async (t) => {
  const f = await fixture(t);
  await f.service.execute("start", f.id, f.digest, "", f.phrase);
  const slot = f.store.firstTest();
  f.mode("provider-error");
  await assert.rejects(f.service.execute("poll", f.id, f.digest, "", ""));
  const status = await f.service.status(f.id);
  assert.equal(status.reconciliationRequired, true);
  assert.equal(status.budget!.reservedMicroUsd, 500000);
  assert.equal(
    status.budget!.unreservedMicroUsd,
    Number(f.env.BYTEPLUS_LIVE_TEST_MAX_TOTAL_MICRO_USD) - 500000,
  );
  assert.equal(status.budget!.actualPreviousChargeMicroUsd, null);
  assert.equal(status.budget!.eurBudgetVerified, false);
  assert.ok(
    status.startBlockers!.some((item) =>
      item.includes("First slot is already claimed"),
    ),
  );
  await assert.rejects(
    f.service.execute("start", f.id, f.digest, "", f.phrase),
  );
  assert.deepEqual(f.store.firstTest(), slot);
  assert.equal(f.counts().submits, 1);
  f.env.BYTEPLUS_LIVE_TEST_MAX_TOTAL_MICRO_USD = "not-a-cap";
  assert.equal((await f.service.status(f.id)).budget!.unreservedMicroUsd, null);
});

async function prepareSecond(f: Awaited<ReturnType<typeof fixture>>) {
  const clip = path.join(f.dir, "second.mp3");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880:duration=4.2",
    "-c:a",
    "libmp3lame",
    clip,
  ]);
  const image = await sharp({
    create: { width: 512, height: 512, channels: 3, background: "blue" },
  })
    .png()
    .toBuffer();
  const prepared = await f.service.upload(
    new File([new Uint8Array(image)], "second.png"),
    new File([await readFile(clip)], "second.mp3"),
    "Sing gently.",
    true,
    true,
    true,
  );
  const id = prepared.plan!.id;
  f.env.BYTEPLUS_SECOND_TEST_ENABLED = "true";
  f.env.BYTEPLUS_SECOND_TEST_PLAN_ID = id;
  const cost = {
    ...f.cost,
    ...prepared.plan!.costReview,
    generatedVideoMaxSeconds: 6,
    baseMaxMicroUsd: 420000,
    taxMaxMicroUsd: 80000,
    feesMaxMicroUsd: 0,
    inclusiveMaxMicroUsd: 500000,
    reviewedBy: f.cost.reviewedBy,
    reviewedAt: f.cost.reviewedAt,
    evidence: f.cost.evidence,
    acknowledgment: f.cost.acknowledgment,
  };
  const approved = await f.service.saveReview(id, "cost", cost);
  const currency = {
    eurPerUsdUpperPpm: 1000000,
    fxFeesMaxMicroEur: 0,
    evidence:
      "FICTIONAL TEST ONLY: reviewed settlement conversion and explicit zero FX fee bound; not real proof.",
    validUntil: new Date(Date.now() + 86400000).toISOString(),
    acknowledgment: "AUTHORIZE_SECOND_WITH_FULL_FIRST_RESERVATION",
  };
  return {
    id,
    digest: approved.plan!.costDigest!,
    cost,
    currency,
    phrase: `AUTHORIZE SECOND PAID BYTEPLUS TEST ${id} UP TO 500000 MICROUSD DISCOVER OUTPUT ONLY`,
  };
}
test("separate second slot preserves unresolved first reservation and supports polling/private MP4 without third submission", async (t) => {
  const f = await fixture(t);
  f.env.BYTEPLUS_LIVE_TEST_MAX_TOTAL_MICRO_USD = "1000000";
  await f.service.execute("start", f.id, f.digest, "", f.phrase);
  f.mode("provider-error");
  await assert.rejects(f.service.execute("poll", f.id, f.digest, "", ""));
  const first = f.store.firstTest(),
    previous = f.store.get(f.id),
    result = f.store.firstTestResult(f.id);
  const second = await prepareSecond(f);
  await assert.rejects(
    f.service.execute(
      "start",
      second.id,
      second.digest,
      "",
      second.phrase,
      true,
    ),
  );
  assert.equal(f.counts().submits, 1);
  await f.service.saveSecondBudget(second.id, second.currency);
  f.mode("done");
  await Promise.allSettled([
    f.service.execute(
      "start",
      second.id,
      second.digest,
      "",
      second.phrase,
      true,
    ),
    f
      .make()
      .execute("start", second.id, second.digest, "", second.phrase, true),
  ]);
  assert.equal(f.counts().submits, 2);
  assert.equal(f.store.secondTest()!.attempt_id, second.id);
  assert.deepEqual(f.store.firstTest(), first);
  assert.deepEqual(f.store.get(f.id), previous);
  assert.deepEqual(f.store.firstTestResult(f.id), result);
  assert.equal(f.store.get(second.id).providerJobId, "mock-task-2");
  assert.equal(
    (
      f.store.db
        .prepare("SELECT SUM(reserved_micro_usd) AS n FROM live_attempts")
        .get() as { n: number }
    ).n,
    1000000,
  );
  const observed = await f
    .make()
    .execute("poll", second.id, second.digest, "", "");
  const approved = await f.service.saveReview(second.id, "output", {
    ...observed.plan!.outputReview!,
    kind: "first-test-output-discovery-v1",
    hostname: "output.example",
    minDurationSeconds: 1,
    maxDurationSeconds: 6,
    reviewedBy: "Mock",
    reviewedAt: "2026-01-01T00:00:00Z",
    evidence: "Mock host acceptance policy",
    acknowledgment: "APPROVE_EXACT_HOST_AND_MEDIA_POLICY",
  });
  const completed = await f
    .make()
    .execute(
      "download",
      second.id,
      second.digest,
      approved.plan!.outputDigest!,
      "",
    );
  assert.equal(completed.plan!.state, "completed");
  await assert.rejects(
    f.service.execute(
      "start",
      second.id,
      second.digest,
      "",
      second.phrase,
      true,
    ),
  );
  await assert.rejects(f.service.saveSecondBudget(second.id, second.currency));
  await assert.rejects(
    f.service.upload(
      new File([new Uint8Array(imageBytes)], "third.png"),
      new File([audioBytes], "third.mp3"),
      "",
      true,
      true,
      true,
    ),
  );
  assert.equal(f.counts().submits, 2);
});
test("second test fails closed on FX evidence, total budget, expiry, plan binding and reduced first reservation", async (t) => {
  const f = await fixture(t);
  f.env.BYTEPLUS_LIVE_TEST_MAX_TOTAL_MICRO_USD = "1000000";
  await f.service.execute("start", f.id, f.digest, "", f.phrase);
  const second = await prepareSecond(f);
  for (const bad of [
    { ...second.currency, evidence: "" },
    { ...second.currency, eurPerUsdUpperPpm: null },
    { ...second.currency, fxFeesMaxMicroEur: null },
    { ...second.currency, eurPerUsdUpperPpm: 50000001 },
    { ...second.currency, validUntil: "2000-01-01T00:00:00Z" },
  ])
    await assert.rejects(f.service.saveSecondBudget(second.id, bad));
  await assert.rejects(
    f.service.saveSecondBudget(second.id, {
      ...second.currency,
      eurPerUsdUpperPpm: 50000000,
      fxFeesMaxMicroEur: 1,
    }),
  );
  const exact = await f.service.saveSecondBudget(second.id, {
    ...second.currency,
    eurPerUsdUpperPpm: 50000000,
  });
  assert.equal(exact.currencyBudget!.effectiveRemainingMicroUsd, 500000);
  const clock = t.mock.method(
    Date,
    "now",
    () => Date.parse(second.currency.validUntil) + 1,
  );
  await assert.rejects(
    f.service.execute(
      "start",
      second.id,
      second.digest,
      "",
      second.phrase,
      true,
    ),
    /unexpired/,
  );
  clock.mock.restore();
  await f.service.saveSecondBudget(second.id, second.currency);
  f.env.BYTEPLUS_SECOND_TEST_ENABLED = "false";
  await assert.rejects(
    f.service.execute(
      "start",
      second.id,
      second.digest,
      "",
      second.phrase,
      true,
    ),
  );
  f.env.BYTEPLUS_SECOND_TEST_ENABLED = "true";
  f.env.BYTEPLUS_LIVE_TEST_MAX_TOTAL_MICRO_USD = "999999";
  await assert.rejects(
    f.service.execute(
      "start",
      second.id,
      second.digest,
      "",
      second.phrase,
      true,
    ),
  );
  f.env.BYTEPLUS_LIVE_TEST_MAX_TOTAL_MICRO_USD = "1000000";
  await assert.rejects(
    f.service.execute(
      "start",
      second.id,
      second.digest,
      "",
      second.phrase.replace("SECOND", "ONE"),
      true,
    ),
  );
  // Corruption simulation in the disposable fixture only: a lowered row must not establish a cheaper first task.
  f.store.db
    .prepare("UPDATE live_attempts SET reserved_micro_usd=1 WHERE id=?")
    .run(f.id);
  await assert.rejects(
    f.service.execute(
      "start",
      second.id,
      second.digest,
      "",
      second.phrase,
      true,
    ),
  );
  assert.equal(f.counts().submits, 1);
  assert.equal(f.store.secondTest(), undefined);
});

test("explicit planning allowance preserves first reservation and independent USD ceiling", async (t) => {
  const { parseFxReference, planningReview, planningAcknowledgment } =
    await import("../lib/live/fx-reference.ts");
  const f = await fixture(t);
  f.env.BYTEPLUS_LIVE_TEST_MAX_TOTAL_MICRO_USD = "1000000";
  await f.service.execute("start", f.id, f.digest, "", f.phrase);
  const second = await prepareSecond(f);
  const before = f.store.firstTest();
  const date = new Date().toISOString().slice(0, 10);
  const review = planningReview(
    parseFxReference(
      `<Cube time='${date}'><Cube currency='USD' rate='1.1'/></Cube>`,
    ),
    planningAcknowledgment,
  );
  const status = await f.service.saveSecondBudget(second.id, review);
  assert.equal(status.secondReview!.budgetBasis, "planning-allowance");
  assert.equal(status.currencyBudget!.effectiveRemainingMicroUsd, 500000);
  assert.equal(status.currencyBudget!.firstReservedMicroUsd, 500000);
  assert.deepEqual(f.store.firstTest(), before);
  assert.equal(f.store.secondTest(), undefined);
  assert.equal(f.counts().submits, 1);
});
