import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, generateKeyPairSync, createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, symlink, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import {
  MAX_SEGMENT_BYTES, sealSegment, openSegment,
  uploadSegmentedArchive, restoreSegmentedArchive,
} from "../lib/ops/backup-segmented-archive.mjs";

const recovery = generateKeyPairSync("rsa", { modulusLength: 3072 });
const signing = generateKeyPairSync("ed25519");
const temp = () => mkdtemp(path.join(tmpdir(), "sm-segmented-"));
const digest = (x) => createHash("sha256").update(x).digest("hex");

function offsite() {
  const storage = new Map();
  const key = (run, id) => run + "/" + id;
  let committed, aborted = false;
  return {
    storage, key,
    writer: {
      async putStream(run, id, stream, meta) {
        const chunks = [];
        for await (const piece of stream) chunks.push(piece);
        const ciphertext = Buffer.concat(chunks);
        assert.equal(ciphertext.length, meta.bytes);
        assert.equal(digest(ciphertext), meta.sha256);
        assert.ok(!storage.has(key(run, id)));
        storage.set(key(run, id), ciphertext);
      },
      async commit(run, id, files) {
        assert.equal(files.at(-1).id, id);
        assert.ok(files.every((entry) =>
          storage.has(key(run, entry.id)) &&
          digest(storage.get(key(run, entry.id))) === entry.sha256 &&
          storage.get(key(run, entry.id)).length === entry.bytes));
        committed = { run, id, files };
      },
      async abort() { aborted = true; },
    },
    // Deliberately a fresh, download-only reader: no sender memory/index.
    reader: {
      async readStream(run, id) {
        const item = storage.get(key(run, id));
        if (!item) throw Error("MISSING_REMOTE_CIPHERTEXT");
        return Readable.from([item]);
      },
    },
    get committed() { return committed; },
    get aborted() { return aborted; },
  };
}

async function upload(root, bytes, segmentBytes = 1024 * 1024) {
  const file = path.join(root, "fixture.bin");
  await writeFile(file, bytes);
  const remote = offsite();
  const result = await uploadSegmentedArchive({
    source: file, sink: remote.writer,
    recoveryPublicKey: recovery.publicKey, signingPrivateKey: signing.privateKey,
    segmentBytes,
  });
  return {file, remote, result};
}

async function restore(root, remote, result, keys = recovery) {
  const target = path.join(root, "restored.bin");
  const details = await restoreSegmentedArchive({
    sink: remote.reader, run: result.run, manifestId: result.manifestId,
    manifestMeta: result.manifestMeta, target,
    recoveryPrivateKey: keys.privateKey, signingPublicKey: signing.publicKey,
  });
  return {target, details};
}

test("streams >8 MiB as bounded encrypted segments, signs an encrypted index, recovers on a separate reader", async () => {
  const root = await temp();
  try {
    const source = randomBytes(17 * 1024 * 1024 + 211);
    const {remote, result} = await upload(root, source);
    assert.equal(result.segments, 18);
    assert.equal(result.bytes, source.length);
    assert.equal(result.remoteReceiptCommitted, true);
    assert.equal(result.independentRestoreVerified, false);
    assert.equal(remote.committed.files.length, 19);
    assert.ok([...remote.storage.values()].every((v) => v.length < 2 * 1024 * 1024));
    for(const encrypted of remote.storage.values()) {
      assert.equal(encrypted.includes(source.subarray(0, 64)), false);
    }
    const {target, details} = await restore(root, remote, result);
    assert.equal(details.recovered, true);
    assert.equal(details.bytes, source.length);
    assert.deepEqual(await readFile(target), source);
    assert.equal((await stat(target)).mode & 0o077, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("zero-byte files have signed index and restore exactly empty", async () => {
  const root = await temp();
  try {
    const {remote, result} = await upload(root, Buffer.alloc(0));
    assert.equal(result.segments, 0);
    const {target, details} = await restore(root, remote, result);
    assert.equal(details.bytes, 0);
    assert.equal((await readFile(target)).length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("corrupted remote segment fails authenticated independent restore and removes partial output", async () => {
  const root = await temp();
  try {
    const {remote, result} = await upload(root, randomBytes(3 * 1024 * 1024 + 71));
    const chunkId = remote.committed.files[1].id;
    const name = remote.key(result.run, chunkId);
    const corrupted = Buffer.from(remote.storage.get(name));
    corrupted[corrupted.length - 17] ^= 0x80;
    remote.storage.set(name, corrupted);
    const output = path.join(root, "partial.bin");
    await assert.rejects(restoreSegmentedArchive({
      sink: remote.reader, run: result.run, manifestId: result.manifestId,
      manifestMeta: result.manifestMeta, target: output,
      recoveryPrivateKey: recovery.privateKey, signingPublicKey: signing.publicKey,
    }), /SEGMENT_CIPHERTEXT_MISMATCH/);
    await assert.rejects(stat(output), {code:"ENOENT"});
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("truncated remote stream is rejected, not counted as successful restore", async () => {
  const root = await temp();
  try {
    const {remote, result} = await upload(root, randomBytes(2 * 1024 * 1024 + 1));
    const id = remote.committed.files[0].id, name = remote.key(result.run, id);
    remote.storage.set(name, remote.storage.get(name).subarray(0, 50));
    await assert.rejects(restore(root, remote, result), /REMOTE_SEGMENT_TRUNCATED/);
    await assert.rejects(stat(path.join(root, "restored.bin")), {code:"ENOENT"});
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("manifest corruption, wrong recovery key and existing destination all fail closed", async () => {
  const root = await temp();
  try {
    const {remote, result} = await upload(root, Buffer.from("do-not-overwrite"));
    const target = path.join(root, "restored.bin");
    await writeFile(target, "original");
    await assert.rejects(restore(root, remote, result), {code:"EEXIST"});
    assert.equal(await readFile(target, "utf8"), "original");
    await rm(target);
    const wrong = generateKeyPairSync("rsa", {modulusLength:3072});
    await assert.rejects(restore(root, remote, result, wrong));
    await assert.rejects(stat(target), {code:"ENOENT"});
    const name = remote.key(result.run, result.manifestId);
    const corrupted = Buffer.from(remote.storage.get(name));
    corrupted[30] ^= 0x20;
    remote.storage.set(name, corrupted);
    await assert.rejects(restore(root, remote, result), /MANIFEST_CIPHERTEXT_MISMATCH/);
    await assert.rejects(stat(target), {code:"ENOENT"});
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("concurrent source mutation aborts before commit", async () => {
  const root = await temp();
  try {
    const source = path.join(root,"fixture.bin");
    await writeFile(source, randomBytes(2 * 1024 * 1024 + 100));
    const remote = offsite();
    const writer = {
      ...remote.writer,
      async putStream(...args) {
        await remote.writer.putStream(...args);
        await writeFile(source, randomBytes(2 * 1024 * 1024 + 100));
      },
    };
    await assert.rejects(uploadSegmentedArchive({
      source, sink: writer,
      recoveryPublicKey: recovery.publicKey,
      signingPrivateKey: signing.privateKey,
      segmentBytes:1024*1024,
    }), /SOURCE_CHANGED/);
    assert.equal(remote.aborted, true);
    assert.equal(remote.committed, undefined);
  } finally { await rm(root, {recursive:true,force:true}); }
});

test("refuses symlinked input, weak keys, invalid memory bounds, bad contexts", async () => {
  const root = await temp();
  try {
    const source = path.join(root,"fixture.bin");
    const link = path.join(root,"linked.bin");
    await writeFile(source, "test");
    await symlink(source, link);
    await assert.rejects(uploadSegmentedArchive({
      source: link, sink: offsite().writer,
      recoveryPublicKey: recovery.publicKey, signingPrivateKey: signing.privateKey,
    }), {code:"ELOOP"});
    const weak = generateKeyPairSync("rsa",{modulusLength:2048});
    await assert.rejects(uploadSegmentedArchive({
      source, sink: offsite().writer, recoveryPublicKey: weak.publicKey,
      signingPrivateKey: signing.privateKey,
    }), /RECOVERY_PUBLIC_KEY_REQUIRED/);
    await assert.rejects(uploadSegmentedArchive({
      source, sink: offsite().writer,
      recoveryPublicKey: recovery.publicKey, signingPrivateKey: signing.privateKey,
      segmentBytes:MAX_SEGMENT_BYTES+1,
    }), /SEGMENT_LIMIT_INVALID/);
    assert.throws(() => sealSegment(Buffer.from("x"), recovery.publicKey, "bad"), /INVALID_SEGMENT/);
    assert.throws(() => openSegment(Buffer.from("bad"), recovery.privateKey, "bad"), /SEGMENT_SIZE_INVALID/);
  } finally { await rm(root,{recursive:true,force:true}); }
});
