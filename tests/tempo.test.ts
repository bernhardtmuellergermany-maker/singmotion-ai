import { test, after, beforeEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  stat,
  rm,
  readdir,
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
import {
  downloadValidatedOutput,
  type OutputValidationContract,
} from "../lib/live/output.ts";
import { sha256File } from "../lib/live/media.ts";
import { trimAudio } from "../lib/media.ts";
import { LiveTestStore, type PreparedMedia } from "../lib/live/store.ts";
import { StudioWorkflow } from "../lib/live/studio.ts";
import {
  requireRights,
  termsVersion,
  recordRights,
  hasRights,
} from "../lib/rights.ts";
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
// Distinct leading/trailing tones detect a shifted excerpt, not just its length.
ff([
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=220:duration=1",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:duration=5",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=880:duration=1",
  "-filter_complex",
  "[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]",
  "-map",
  "[out]",
  source,
]);
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
const contract: VerifiedContract & OutputValidationContract = {
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
    height: 1280,
    videoCodec: "h264",
    audioCodec: "aac",
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
  recordRights(store.db, owner, "project", termsVersion(), {
    session: "session",
    content: "exact-content",
  });
  recordRights(store.db, owner, "project", termsVersion(), {
    session: "session",
    content: "exact-content",
  });
  assert.equal(
    store.db.prepare("SELECT count(*) n FROM rights_confirmations").get()!.n,
    1,
  );
  assert.ok(hasRights(store.db, owner, "session", "exact-content"));
  assert.equal(
    hasRights(store.db, "another-actor", "session", "exact-content"),
    false,
  );
  assert.equal(
    hasRights(store.db, owner, "another-session", "exact-content"),
    false,
  );
  assert.equal(hasRights(store.db, owner, "session", "changed-content"), false);
  process.env.STUDIO_TERMS_VERSION = "updated-terms";
  assert.equal(hasRights(store.db, owner, "session", "exact-content"), false);
  assert.throws(
    () => requireRights(true, "staging-terms-2026-10-26"),
    /Confirm/,
  );
  delete process.env.STUDIO_TERMS_VERSION;
  const row = store.db.prepare("SELECT * FROM rights_confirmations").get()!;
  assert.equal(row.actor, owner);
  assert.equal(row.project, "project");
  assert.equal(row.terms_version, termsVersion());
  assert.ok(Number(row.confirmed_at) <= Date.now());
});
test("flag-only activation preserves ownership, moderation, pitch and original packets without an authorization file", async () => {
  const before = await readFile(original),
    sourceBefore = await readFile(source);
  assert.equal(await tempoAuthorization(root, store, selection, owner), null);
  for (const disabled of ["false", "TRUE", "1"]) {
    process.env.AUDIO_TEMPO_ENABLED = disabled;
    assert.equal(await tempoAuthorization(root, store, selection, owner), null);
  }
  process.env.AUDIO_TEMPO_ENABLED = "true";
  // No operator-created file exists; activation works with the existing flag only.
  const first = await tempoAuthorization(root, store, selection, owner);
  assert.ok(first);
  // Legacy authorization administration is ignored, never modified or deleted.
  const legacyFile = path.join(root, "byteplus-tempo-authorization.json");
  await writeFile(legacyFile, "legacy invalid JSON; must not be consulted");
  assert.deepEqual(
    await tempoAuthorization(root, store, selection, owner),
    first,
  );
  assert.equal(
    await readFile(legacyFile, "utf8"),
    "legacy invalid JSON; must not be consulted",
  );
  await assert.rejects(
    tempoAuthorization(root, store, { ...selection, owner: "other" }, owner),
    /ownership/,
  );
  await assert.rejects(
    tempoAuthorization(root, store, { ...selection, owner: "other" }, "other"),
  );
  const authorization = (await tempoAuthorization(
    root,
    store,
    selection,
    owner,
  ))!;
  const slow = await slowExcerpt(media, root, "song", authorization, 10);
  assert.ok(Math.abs(slow.durationSeconds * 0.9 - duration) < 0.2);
  await assert.rejects(
    checkTempoSubmission(
      {
        ...slow,
        tempo: { ...slow.tempo!, authorizationDigest: "legacy-file-review" },
      },
      root,
      store,
      selection,
    ),
    /fresh cost review/,
  );

  // Automatic binding still detects changed original audio/image bytes without manual hashes.
  for (const file of [source, image]) {
    const bytes = await readFile(file);
    try {
      await writeFile(file, Buffer.concat([bytes, Buffer.from([0])]));
      await assert.rejects(
        checkTempoSubmission(slow, root, store, selection),
        /fresh cost review/,
      );
    } finally {
      await writeFile(file, bytes);
    }
  }
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
    "color=black:s=1280x720:r=25",
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
  assert.ok(Math.abs(slow.tempo!.originalDecodedSeconds! - 5) < 0.001);
  assert.ok(slow.durationSeconds > slow.tempo!.providerDecodedSeconds!); // MP3 padding is not music
  // Provider may add a bounded tail: trim that tail, don't stretch it across the song.
  const tail = path.join(root, "provider-tail.mp4");
  ff([
    "-i",
    raw,
    "-vf",
    "tpad=stop_mode=clone:stop_duration=0.4",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-c:a",
    "copy",
    tail,
  ]);
  const tailContract = {
    ...contract,
    output: { ...contract.output, durationToleranceSeconds: 0.7 },
  };
  await restoreTempoOutput(tail, final, slow, tailContract);
  await validateRestored(final, slow, contract);
  // Even a permissive total-container tolerance cannot conceal missing video frames.
  const short = path.join(root, "provider-short.mp4");
  ff(["-i", raw, "-t", "4", "-c", "copy", short]);
  await assert.rejects(
    restoreTempoOutput(short, final, slow, {
      ...tailContract,
      output: { ...tailContract.output, durationToleranceSeconds: 2 },
    }),
    /missing the required audio timeline/,
  );
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
    // Already-submitted legacy-file plans recover without reauthorization or resubmission.
    media: {
      ...slow,
      tempo: { ...slow.tempo!, authorizationDigest: "legacy-file-review" },
    },
    state: "processing",
    providerJobId: "mock-tempo-task",
    contractDigest: contractDigest(full),
  };
  store.db
    .prepare("UPDATE live_attempts SET data=?,reserved_micro_usd=? WHERE id=?")
    .run(JSON.stringify(pending), cost, job.id);
  const unusual = path.join(root, "provider-786x1178.mp4");
  ff([
    "-i",
    raw,
    "-vf",
    "scale=786:1178,setsar=1",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-c:a",
    "copy",
    unusual,
  ]);
  let polls = 0,
    downloads = 0;
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
    async (url, destination, duration, policy) => {
      if (++downloads === 1)
        throw new Error(
          "OUTPUT_DIMENSIONS_MISMATCH_ACTUAL_786x1178_EXPECTED_720x1280",
        );
      await downloadValidatedOutput(
        url,
        destination,
        duration,
        policy,
        async () => new Response(await readFile(unusual)),
      );
    },
    true,
  );
  const blocked = await runner.pollOnce(job.id);
  assert.equal(blocked.state, "processing");
  assert.equal(blocked.providerJobId, pending.providerJobId);
  assert.equal(
    blocked.failureCode,
    "OUTPUT_DIMENSIONS_MISMATCH_ACTUAL_786x1178_EXPECTED_720x1280",
  );
  const done = await runner.pollOnce(job.id);
  assert.equal(done.providerJobId, pending.providerJobId);
  assert.equal(polls, 1); // cached output recovery, no submission or extra provider poll
  assert.equal(
    store.db
      .prepare("SELECT reserved_micro_usd FROM live_attempts WHERE id=?")
      .get(job.id)!.reserved_micro_usd,
    cost,
  );
  assert.equal(done.state, "completed");
  await validateRestored(done.outputPath!, slow, full);
  store.db
    .prepare("UPDATE live_attempts SET data=? WHERE id=?")
    .run(JSON.stringify(pending), job.id);
  process.env.AUDIO_TEMPO_ENABLED = "false";
  assert.equal((await runner.pollOnce(job.id)).state, "completed");
  assert.equal(polls, 1);
  // Failed restoration never publishes an MP4 or releases/duplicates the paid reservation.
  const brokenMedia = {
    ...slow,
    sourceJobId: "mock-bad-restoration",
    tempo: { ...slow.tempo!, originalDuration: 2 },
  };
  const broken = store.prepare(brokenMedia, full.revision, cost);
  store.db
    .prepare("UPDATE live_attempts SET data=?,reserved_micro_usd=? WHERE id=?")
    .run(
      JSON.stringify({
        ...broken,
        state: "processing",
        providerJobId: "same-broken-task",
        contractDigest: contractDigest(full),
      }),
      cost,
      broken.id,
    );
  const failedExport = await runner.pollOnce(broken.id);
  assert.equal(failedExport.state, "processing");
  assert.equal(failedExport.failureCode, "TEMPO_RESTORATION_FAILED");
  assert.equal(failedExport.providerJobId, "same-broken-task");
  assert.ok(!failedExport.outputPath);
  assert.equal(
    store.db
      .prepare("SELECT reserved_micro_usd FROM live_attempts WHERE id=?")
      .get(broken.id)!.reserved_micro_usd,
    cost,
  );
  assert.ok(
    !(await readdir(path.join(root, "live-output"))).some(
      (f) => f.includes("partial") || f.startsWith(broken.id),
    ),
  );
  process.env.AUDIO_TEMPO_ENABLED = "true";
  assert.deepEqual(await readFile(original), before);
  assert.deepEqual(await readFile(source), sourceBefore);
  await assert.rejects(
    slowExcerpt(media, root, "song", authorization, 5),
    /Encoded MP3/,
  );
  const files = await readdir(path.join(root, "media"));
  assert.ok(
    files
      .filter((f) => f.startsWith("tempo-"))
      .every((f) => /^tempo-[a-f0-9]{64}\.mp3$/.test(f)),
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
