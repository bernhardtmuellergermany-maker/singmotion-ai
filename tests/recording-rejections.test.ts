import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { LiveTestStore, type PreparedMedia } from "../lib/live/store.ts";
import { sha256File } from "../lib/live/media.ts";
import {
  checkRecordingRejections,
  reviewIndependentRecording,
  independentRecordingConfirmation,
} from "../lib/live/recording-rejections.ts";
const root = await mkdtemp(path.join(tmpdir(), "recording identity offline "));
process.env.DATA_DIR = root;
const db = await import("../lib/db.ts");
await mkdir(path.join(root, "media"), { recursive: true });
const owner = db.createSession().owner;
after(async () => {
  db.db.close();
  await rm(root, { recursive: true, force: true });
});
async function source(bytes: string, created = Date.now()) {
  const id = randomUUID(),
    file = path.join(root, "media", id + ".mp3");
  await writeFile(file, bytes);
  db.putAsset({
    id,
    owner,
    kind: "audio",
    path: file,
    name: "synthetic identity fixture",
    mime: "audio/mpeg",
    bytes: Buffer.byteLength(bytes),
    duration: 5,
    width: null,
    height: null,
    created,
  });
  return { id, file, hash: await sha256File(file) };
}
function rejected(
  store: LiveTestStore,
  recording?: PreparedMedia["recording"],
) {
  const a = store.prepare(
    {
      sourceJobId: randomUUID(),
      owner,
      audioPath: "unavailable-legacy-clip",
      audioSha256: "a".repeat(64),
      imagePath: "unused",
      imageSha256: "b".repeat(64),
      durationSeconds: 5,
      prompt: "mock",
      promptLanguageConfirmed: true,
      ...(recording ? { recording } : {}),
    },
    null,
    null,
  );
  store.db
    .prepare("UPDATE live_attempts SET reserved_micro_usd=?,data=? WHERE id=?")
    .run(
      8640000,
      JSON.stringify({
        ...a,
        state: "failed",
        providerJobId: "retained-50510",
        failureCode: "CONTENT_PREFILTER_REJECTED",
        createdAt: Date.now() - 60000,
      }),
      a.id,
    );
  return a.id;
}
const selection = (id: string) => ({
  version: 1 as const,
  owner,
  songId: id,
  imageId: "unused",
  start: 0,
  end: 5,
  performance: "Natural",
  camera: "Static Close-Up",
  customPrompt: "",
});
const evidence =
  "OFFLINE MOCK: reviewed independent recording-session master dated after the retained historical task; original creation record confirms no derivation from rejected material.";
test("rejection matches source hash or owned source ID, not every unrelated recording", async () => {
  const store = new LiveTestStore(":memory:");
  try {
    const old = await source("rejected recording"),
      fresh = await source("independent recording"),
      reupload = await source("rejected recording");
    rejected(store, { songId: old.id, sourceSha256: old.hash });
    await checkRecordingRejections(root, store, fresh.id, owner, fresh.hash);
    await assert.rejects(
      checkRecordingRejections(root, store, old.id, owner, old.hash),
      /TEMPO_RECORDING_REJECTED/,
    );
    await assert.rejects(
      checkRecordingRejections(root, store, reupload.id, owner, reupload.hash),
      /TEMPO_RECORDING_REJECTED/,
    );
    await assert.rejects(
      reviewIndependentRecording(
        root,
        store,
        selection(reupload.id),
        owner,
        "staff",
        evidence,
        independentRecordingConfirmation,
      ),
      /TEMPO_RECORDING_REJECTED/,
    );
  } finally {
    store.close();
  }
});
test("unresolved legacy evidence stays intact; explicit review binds new source and cannot override known clips", async () => {
  const store = new LiveTestStore(":memory:");
  try {
    const id = rejected(store),
      before = store.db
        .prepare("SELECT * FROM live_attempts WHERE id=?")
        .get(id);
    const fresh = await source("independently sourced recording");
    await assert.doesNotReject(
      checkRecordingRejections(root, store, fresh.id, owner, fresh.hash),
    );
    await assert.rejects(
      reviewIndependentRecording(
        root,
        store,
        selection(fresh.id),
        owner,
        "staff",
        "I agree",
        independentRecordingConfirmation,
      ),
      /evidence reference/,
    );
    await assert.rejects(
      reviewIndependentRecording(
        root,
        store,
        selection(fresh.id),
        owner,
        "staff",
        evidence,
        "",
      ),
      /evidence reference/,
    );
    await assert.rejects(
      reviewIndependentRecording(
        root,
        store,
        { ...selection(fresh.id), owner: "foreign" },
        owner,
        "staff",
        evidence,
        independentRecordingConfirmation,
      ),
      /ownership/,
    );
    const older = await source("older unknown source", Date.now() - 120000);
    await assert.rejects(
      reviewIndependentRecording(
        root,
        store,
        selection(older.id),
        owner,
        "staff",
        evidence,
        independentRecordingConfirmation,
      ),
      /after the historical tasks/,
    );
    await reviewIndependentRecording(
      root,
      store,
      selection(fresh.id),
      owner,
      "staff",
      evidence,
      independentRecordingConfirmation,
    );
    await checkRecordingRejections(root, store, fresh.id, owner, fresh.hash);
    assert.deepEqual(
      store.db.prepare("SELECT * FROM live_attempts WHERE id=?").get(id),
      before,
    );
    const audit = store.db
      .prepare("SELECT * FROM live_recording_independence_reviews")
      .get()!;
    assert.equal(audit.actor, "staff");
    assert.equal(audit.source_sha256, fresh.hash);
    assert.equal(audit.evidence, evidence);
    // A reviewed new source that trims to the exact rejected clip remains blocked.
    await assert.rejects(
      checkRecordingRejections(
        root,
        store,
        fresh.id,
        owner,
        fresh.hash,
        "a".repeat(64),
      ),
      /TEMPO_RECORDING_REJECTED/,
    );
    const sameBytesNewId = await source(await readFile(fresh.file, "utf8"));
    await assert.doesNotReject(
      checkRecordingRejections(
        root,
        store,
        sameBytesNewId.id,
        owner,
        sameBytesNewId.hash,
      ),
    );
    await writeFile(fresh.file, "changed recording");
    await assert.doesNotReject(
      checkRecordingRejections(
        root,
        store,
        fresh.id,
        owner,
        await sha256File(fresh.file),
      ),
    );
    // Another unidentified historical record must not globally lock this independent source.
    rejected(store);
    await assert.doesNotReject(
      checkRecordingRejections(root, store, fresh.id, owner, fresh.hash),
    );
  } finally {
    store.close();
  }
});
test("retained Studio source mapping establishes identity; missing old bytes are unknown rather than a match", async () => {
  const store = new LiveTestStore(":memory:");
  try {
    store.db.exec(
      "CREATE TABLE live_studio_projects (attempt_id TEXT PRIMARY KEY,selection_json TEXT)",
    );
    const old = await source("original retained source"),
      fresh = await source("different retained source");
    const id = rejected(store);
    store.db
      .prepare("INSERT INTO live_studio_projects VALUES (?,?)")
      .run(id, JSON.stringify(selection(old.id)));
    await checkRecordingRejections(root, store, fresh.id, owner, fresh.hash);
    await assert.rejects(
      checkRecordingRejections(root, store, old.id, owner, old.hash),
      /TEMPO_RECORDING_REJECTED/,
    );
    // A corrupt historical mapping to an image is not evidence of a different recording.
    const prior = db.asset(old.id, owner);
    db.db
      .prepare("UPDATE assets SET data=? WHERE id=?")
      .run(JSON.stringify({ ...prior, kind: "image" }), old.id);
    await assert.doesNotReject(
      checkRecordingRejections(root, store, fresh.id, owner, fresh.hash),
    );
    db.db
      .prepare("UPDATE assets SET data=? WHERE id=?")
      .run(JSON.stringify(prior), old.id);
    await rm(old.file);
    await assert.doesNotReject(
      checkRecordingRejections(root, store, fresh.id, owner, fresh.hash),
    );
    await assert.rejects(
      checkRecordingRejections(root, store, old.id, owner, old.hash),
      /TEMPO_RECORDING_REJECTED/,
    );
  } finally {
    store.close();
  }
});

test("generic provider failure does not become a moderation rejection", async () => {
  const store = new LiveTestStore(":memory:");
  try {
    const recording = await source(
      "network failure is not a content rejection",
    );
    const id = rejected(store, {
      songId: recording.id,
      sourceSha256: recording.hash,
    });
    store.db
      .prepare("UPDATE live_attempts SET data=? WHERE id=?")
      .run(
        JSON.stringify({ ...store.get(id), failureCode: "PROVIDER_FAILED" }),
        id,
      );
    await assert.doesNotReject(
      checkRecordingRejections(
        root,
        store,
        recording.id,
        owner,
        recording.hash,
      ),
    );
    assert.equal(store.get(id).state, "failed");
  } finally {
    store.close();
  }
});
