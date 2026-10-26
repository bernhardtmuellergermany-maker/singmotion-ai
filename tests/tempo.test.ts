import { test, after, beforeEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  copyFile,
  writeFile,
  stat,
  rm,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import tls from "node:tls";
import sharp from "sharp";
import {
  slowExcerpt,
  tempoAuthorization,
  restoreTempoOutput,
  validateRestored,
  checkTempoSubmission,
} from "../lib/live/tempo.ts";
import { sha256File } from "../lib/live/media.ts";
import { trimAudio } from "../lib/media.ts";
import { LiveTestStore, type PreparedMedia } from "../lib/live/store.ts";
import { StudioWorkflow } from "../lib/live/studio.ts";
import { requireRights, termsVersion, recordRights } from "../lib/rights.ts";
import type { VerifiedContract } from "../lib/live/contract.ts";
const root = await mkdtemp(path.join(tmpdir(), "tempo offline "));
process.env.DATA_DIR = root;
const db = await import("../lib/db.ts");
const owner = db.createSession().owner;
await mkdir(path.join(root, "media"), { recursive: true });
const source = path.join(root, "media", "source.wav"),
  original = path.join(root, "media", "original.mp3"),
  image = path.join(root, "media", "singer.png");
const ff = (args: string[]) =>
  execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-y", ...args]);
ff(["-f", "lavfi", "-i", "sine=frequency=440:duration=7", source]);
const duration = await trimAudio(source, original, 1, 6);
await sharp({
  create: { width: 720, height: 720, channels: 3, background: "black" },
})
  .png()
  .toFile(image);
for (const [id, kind, file, mime] of [
  ["song", "audio", source, "audio/wav"],
  ["image", "image", image, "image/png"],
] as const)
  db.putAsset({
    id,
    owner,
    kind,
    path: file,
    mime,
    name: id,
    bytes: (await stat(file)).size,
    duration: kind === "audio" ? 7 : null,
    width: null,
    height: null,
    created: Date.now(),
  });
const store = new LiveTestStore(path.join(root, "live.sqlite"));
new StudioWorkflow(store, root, {} as never, {} as never); // initialize only local project/audit schema
const selection = {
  version: 1 as const,
  owner,
  songId: "song",
  imageId: "image",
  start: 1,
  end: 6,
  performance: "Natural",
  camera: "Static Close-Up",
  customPrompt: "",
};
const media: PreparedMedia = {
  sourceJobId: "offline",
  owner,
  audioPath: original,
  audioSha256: await sha256File(original),
  imagePath: image,
  imageSha256: await sha256File(image),
  durationSeconds: duration,
  prompt: "Sing",
  promptLanguageConfirmed: true,
};
const contract: VerifiedContract = {
  revision: "tempo-offline",
  model: "OmniHuman 2.0",
  documentationUrl: "https://example.test/",
  maxDurationSeconds: 10,
  promptSupported: true,
  inputFetchWindowSeconds: 44100,
  generatedDurationBound: {
    minInputSeconds: 4,
    maxInputSeconds: 10,
    maxAdditionalSeconds: 0,
    evidence: "Mock duration evidence only",
  },
  billing: {
    microUsdPerSecond: 70000,
    minimumBillableMs: 0,
    billingQuantumMs: 1000,
    minimumChargeMicroUsd: 0,
    fixedFeeMicroUsd: 0,
    taxBasisPointsUpperBound: 0,
  },
  outputHosts: ["approved.example.test"],
  output: {
    width: 720,
    height: 720,
    fps: 25,
    durationToleranceSeconds: 0.2,
    maxDurationSeconds: 8,
    transfer: {
      maxBytes: 10000000,
      timeoutMs: 120000,
      evidence: "offline test",
    },
  },
};
beforeEach((context) => {
  const t = context as TestContext;
  const deny = () => {
    throw Error("Network forbidden");
  };
  t.mock.method(globalThis, "fetch", deny);
  t.mock.method(net.Socket.prototype, "connect", deny);
  t.mock.method(tls, "connect", deny);
});
after(async () => {
  store.close();
  db.db.close();
  delete process.env.AUDIO_TEMPO_ENABLED;
  await rm(root, { recursive: true, force: true });
});
test("rights confirmation is required, version-bound and records server actor/project/time", () => {
  for (const [consent, version] of [
    [false, termsVersion()],
    [true, "old"],
    [true, undefined],
  ])
    assert.throws(() => requireRights(consent, version), /Confirm/);
  requireRights(true, termsVersion());
  recordRights(store.db, owner, "project", termsVersion());
  const row = store.db.prepare("SELECT * FROM rights_confirmations").get()!;
  assert.equal(row.actor, owner);
  assert.equal(row.project, "project");
  assert.equal(row.terms_version, termsVersion());
  assert.ok(Number(row.confirmed_at) <= Date.now());
});
test("off/default and absent or mismatched provider permission keep BytePlus original; approved 0.9x preserves pitch and original packets", async () => {
  const before = await readFile(original),
    sourceBefore = await readFile(source);
  assert.equal(await tempoAuthorization(root, store, selection, owner), null);
  process.env.AUDIO_TEMPO_ENABLED = "true";
  assert.equal(await tempoAuthorization(root, store, selection, owner), null);
  const approval = {
    provider: "BytePlus OmniHuman 2.0",
    sourceSha256: await sha256File(source),
    imageSha256: media.imageSha256,
    owner,
    explicitlyAllowsTempoProcessing: true,
    evidence:
      "MOCK provider authorization explicitly covering this recording and tempo processing.",
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
  await writeFile(
    path.join(root, "byteplus-tempo-authorization.json"),
    JSON.stringify({ ...approval, sourceSha256: "wrong" }),
  );
  assert.equal(await tempoAuthorization(root, store, selection, owner), null);
  await writeFile(
    path.join(root, "byteplus-tempo-authorization.json"),
    JSON.stringify(approval),
  );
  const authorization = (await tempoAuthorization(
    root,
    store,
    selection,
    owner,
  ))!;
  const slow = await slowExcerpt(media, root, "song", authorization, 10);
  assert.ok(Math.abs(slow.durationSeconds * 0.9 - duration) < 0.2);
  const pcm = ff([
    "-i",
    slow.audioPath,
    "-ss",
    "0.5",
    "-t",
    "2",
    "-f",
    "s16le",
    "-ac",
    "1",
    "-ar",
    "48000",
    "-",
  ]);
  let crossings = 0;
  for (let i = 2; i < pcm.length; i += 2)
    if (pcm.readInt16LE(i - 2) <= 0 && pcm.readInt16LE(i) > 0) crossings++;
  assert.ok(Math.abs(crossings / 2 - 440) < 3);
  await checkTempoSubmission(slow, root, store, selection);
  const raw = path.join(root, "provider.mp4"),
    final = path.join(root, "final.mp4");
  ff([
    "-f",
    "lavfi",
    "-i",
    "color=black:s=720x720:r=25",
    "-i",
    slow.audioPath,
    "-t",
    String(slow.durationSeconds),
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-c:a",
    "aac",
    raw,
  ]);
  await restoreTempoOutput(raw, final, slow, contract);
  await validateRestored(final, slow, contract);
  await assert.rejects(
    restoreTempoOutput(
      raw,
      path.join(root, "bad-timing.mp4"),
      { ...slow, tempo: { ...slow.tempo!, originalDuration: 2 } },
      contract,
    ),
    /timing bounds/,
  );
  await assert.rejects(
    validateRestored(
      final,
      { ...slow, tempo: { ...slow.tempo!, originalSha256: "0".repeat(64) } },
      contract,
    ),
    /Original excerpt changed/,
  );
  const { LiveTestRunner } = await import("../lib/live/runner.ts");
  const { contractDigest, planUpperBoundMicroUsd } =
    await import("../lib/live/contract.ts");
  const full: VerifiedContract = {
    ...contract,
    revision: "tempo-mock",
    model: "OmniHuman 2.0",
    documentationUrl: "https://example.test",
    maxDurationSeconds: 10,
    promptSupported: true,
    inputFetchWindowSeconds: 44100,
    generatedDurationBound: {
      minInputSeconds: 4,
      maxInputSeconds: 10,
      maxAdditionalSeconds: 0,
      evidence: "mock only",
    },
    billing: {
      microUsdPerSecond: 70000,
      minimumBillableMs: 0,
      billingQuantumMs: 1000,
      minimumChargeMicroUsd: 0,
      fixedFeeMicroUsd: 0,
      taxBasisPointsUpperBound: 0,
    },
  };
  const cost = planUpperBoundMicroUsd(slow.durationSeconds, full);
  const job = store.prepare(
    { ...slow, sourceJobId: "mock-tempo-recovery" },
    full.revision,
    cost,
  );
  const pending = {
    ...job,
    state: "processing",
    providerJobId: "mock-tempo-task",
    contractDigest: contractDigest(full),
  };
  store.db
    .prepare("UPDATE live_attempts SET data=?,reserved_micro_usd=? WHERE id=?")
    .run(JSON.stringify(pending), cost, job.id);
  let polls = 0;
  const runner = new LiveTestRunner(
    store,
    {
      contract: full,
      submit: async () => {
        throw Error("No submission allowed");
      },
      poll: async () => {
        polls++;
        return {
          state: "completed",
          outputUrl: "https://approved.example.test/video",
        };
      },
    },
    {
      demoMode: false,
      enabled: true,
      operatorSecret: "mock-secret-at-least-thirty-two-characters",
      maxJobMicroUsd: 1000000,
      maxTotalMicroUsd: 2000000,
      maxDurationSeconds: 10,
    },
    path.join(root, "live-output"),
    async (_url, destination) => {
      await copyFile(raw, destination);
    },
    true,
  );
  const done = await runner.pollOnce(job.id);
  assert.equal(done.state, "completed");
  await validateRestored(done.outputPath!, slow, full);
  store.db
    .prepare("UPDATE live_attempts SET data=? WHERE id=?")
    .run(JSON.stringify(pending), job.id);
  process.env.AUDIO_TEMPO_ENABLED = "false";
  assert.equal((await runner.pollOnce(job.id)).state, "completed");
  assert.equal(polls, 1);
  process.env.AUDIO_TEMPO_ENABLED = "true";
  assert.deepEqual(await readFile(original), before);
  assert.deepEqual(await readFile(source), sourceBefore);
  await assert.rejects(
    slowExcerpt(media, root, "song", authorization, 5),
    /Encoded MP3/,
  );
  process.env.AUDIO_TEMPO_ENABLED = "false";
  await assert.rejects(
    checkTempoSubmission(slow, root, store, selection),
    /disabled/,
  );
  await validateRestored(final, slow, contract); // recovery does not depend on rollout flag
  process.env.AUDIO_TEMPO_ENABLED = "true";
  const attempt = store.prepare(
    { ...media, sourceJobId: "rejected-original" },
    null,
    null,
  );
  store.db.prepare("UPDATE live_attempts SET data=? WHERE id=?").run(
    JSON.stringify({
      ...attempt,
      state: "failed",
      failureCode: "CONTENT_PREFILTER_REJECTED",
    }),
    attempt.id,
  );
  store.db
    .prepare(
      "INSERT INTO live_studio_projects (attempt_id,owner,selection_json,policy_json,artist_name) VALUES (?,?,?,?,?)",
    )
    .run(attempt.id, owner, JSON.stringify(selection), "{}", "singer");
  await assert.rejects(
    tempoAuthorization(root, store, selection, owner),
    /previous provider failure/,
  );
});
