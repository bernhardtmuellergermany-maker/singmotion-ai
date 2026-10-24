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
          body: { code: 10000, data: { task_id: "mock-task" } },
        };
      }
      if (action === "CVCancelTask")
        return { status: 200, body: { code: 10000, data: {} } };
      if (mode === "read-error") throw Error("SECRET");
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
