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
