/**
 * Bounded-memory encryption and independent restore of one immutable source file.
 * Offline library only: no startup hook, public route, secrets, schedule or live I/O.
 *
 * Intended source: an already-consistent SQLite snapshot, pg_dump artifact, or
 * immutable/conditionally-read R2 object. This function does NOT freeze sources.
 * The sender never needs the recovery private key. The transport never sees
 * plaintext or the signed index (the signed index is encrypted separately).
 */
import { constants } from "node:fs";
import { open, rm } from "node:fs/promises";
import {
  randomBytes, randomUUID, createHash, publicEncrypt, privateDecrypt,
  createCipheriv, createDecipheriv, createPublicKey, createPrivateKey,
  sign, verify,
} from "node:crypto";
import { Readable } from "node:stream";

export const MAX_SEGMENT_BYTES = 8 * 1024 * 1024;
export const MAX_SEGMENTS = 4096;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_FILE_BYTES = MAX_SEGMENT_BYTES * MAX_SEGMENTS;
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const digest = (data) => createHash("sha256").update(data).digest("hex");
const bad = (code) => { throw Error(code); };

function validPublicKey(value) {
  const key = createPublicKey(value);
  if (key.asymmetricKeyType !== "rsa" ||
      key.asymmetricKeyDetails?.modulusLength < 3072)
    bad("RECOVERY_PUBLIC_KEY_REQUIRED");
  return key;
}
function validPrivateKey(value) {
  const key = createPrivateKey(value);
  if (key.asymmetricKeyType !== "rsa" ||
      key.asymmetricKeyDetails?.modulusLength < 3072)
    bad("RECOVERY_PRIVATE_KEY_REQUIRED");
  return key;
}
function validSigner(value) {
  const key = createPrivateKey(value);
  if (key.asymmetricKeyType !== "ed25519")
    bad("ED25519_SIGNER_REQUIRED");
  return key;
}
function validVerifier(value) {
  const key = createPublicKey(value);
  if (key.asymmetricKeyType !== "ed25519")
    bad("ED25519_VERIFIER_REQUIRED");
  return key;
}

/** Each segment gets a fresh AES-256-GCM key and IV; RSA-OAEP/SHA-256 wraps it.
 * Authenticated header binds the run and random segment ID. No plaintext disk spool.
 */
export function sealSegment(plaintext, recoveryPublicKey, context) {
  if (!Buffer.isBuffer(plaintext) || plaintext.length > MAX_SEGMENT_BYTES ||
      typeof context !== "string" || !/^[a-f0-9-]{73}$/.test(context))
    bad("INVALID_SEGMENT");
  const key = randomBytes(32), iv = randomBytes(12);
  try {
    const header = Buffer.from(JSON.stringify({
      v: 2, context, iv: iv.toString("base64"),
      wrapped: publicEncrypt({ key: validPublicKey(recoveryPublicKey), oaepHash: "sha256" }, key).toString("base64"),
    }));
    if (header.length > 8192) bad("SEGMENT_HEADER_TOO_LARGE");
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(header.length);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(header);
    return Buffer.concat([prefix, header, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  } finally {
    key.fill(0);
  }
}
export function openSegment(envelope, recoveryPrivateKey, context) {
  if (!Buffer.isBuffer(envelope) || envelope.length < 40 ||
      envelope.length > MAX_SEGMENT_BYTES + 8192 + 20)
    bad("SEGMENT_SIZE_INVALID");
  const n = envelope.readUInt32BE(0);
  if (n < 20 || n > 8192 || envelope.length < n + 20)
    bad("SEGMENT_HEADER_INVALID");
  const header = envelope.subarray(4, n + 4);
  const metadata = JSON.parse(header.toString("utf8"));
  const iv = Buffer.from(metadata.iv ?? "", "base64");
  if (metadata.v !== 2 || metadata.context !== context || iv.length !== 12 ||
      typeof metadata.wrapped !== "string")
    bad("SEGMENT_CONTEXT_INVALID");
  const key = privateDecrypt({
    key: validPrivateKey(recoveryPrivateKey), oaepHash: "sha256",
  }, Buffer.from(metadata.wrapped, "base64"));
  try {
    if (key.length !== 32) bad("SEGMENT_KEY_INVALID");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(header);
    decipher.setAuthTag(envelope.subarray(envelope.length - 16));
    return Buffer.concat([
      decipher.update(envelope.subarray(n + 4, envelope.length - 16)),
      decipher.final(),
    ]);
  } finally {
    key.fill(0);
  }
}
function sameFile(before, after) {
  return before.dev === after.dev && before.ino === after.ino &&
    before.nlink === 1 && after.nlink === 1 && before.size === after.size &&
    before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}
async function boundedRead(stream, expectedBytes, maxBytes) {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 ||
      expectedBytes > maxBytes) bad("REMOTE_SEGMENT_LENGTH_INVALID");
  const buffers = [];
  let seen = 0;
  for await (const piece of stream) {
    const buffer = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);
    seen += buffer.length;
    if (seen > expectedBytes) bad("REMOTE_SEGMENT_OVERSIZE");
    buffers.push(buffer);
  }
  if (seen !== expectedBytes) bad("REMOTE_SEGMENT_TRUNCATED");
  return Buffer.concat(buffers, seen);
}
function ensureIndex(index, run) {
  if (!index || index.version !== 2 || index.format !== "singmotion-segmented-v2" ||
      index.run !== run || !Number.isSafeInteger(index.bytes) ||
      index.bytes < 0 || index.bytes > MAX_FILE_BYTES ||
      !/^[a-f0-9]{64}$/.test(index.plaintextSha256 ?? "") ||
      !Array.isArray(index.segments) || index.segments.length > MAX_SEGMENTS)
    bad("SIGNED_INDEX_INVALID");
  let bytes = 0;
  const unique = new Set();
  for (let i = 0; i < index.segments.length; i++) {
    const item = index.segments[i];
    if (!item || item.position !== i || !idPattern.test(item.id) ||
        unique.has(item.id) || !Number.isSafeInteger(item.plaintextBytes) ||
        item.plaintextBytes <= 0 || item.plaintextBytes > MAX_SEGMENT_BYTES ||
        !Number.isSafeInteger(item.bytes) || item.bytes <= item.plaintextBytes + 16 ||
        item.bytes > MAX_SEGMENT_BYTES + 8192 + 20 ||
        !/^[a-f0-9]{64}$/.test(item.sha256 ?? "") ||
        !/^[a-f0-9]{64}$/.test(item.plaintextSha256 ?? ""))
      bad("SIGNED_INDEX_SEGMENT_INVALID");
    bytes += item.plaintextBytes;
    unique.add(item.id);
  }
  if (bytes !== index.bytes || (index.bytes === 0) !== (index.segments.length === 0))
    bad("SIGNED_INDEX_SIZE_MISMATCH");
  return index;
}

/** Upload one immutable file in <=8 MiB encrypted segments; finalize with
 * a separately encrypted Ed25519-signed index. It never calls a restore or delete.
 * sink.putStream MUST verify a remote readback; sink.commit persists the receipt.
 */
export async function uploadSegmentedArchive({
  source, sink, recoveryPublicKey, signingPrivateKey,
  segmentBytes = 4 * 1024 * 1024,
}) {
  if (!Number.isSafeInteger(segmentBytes) || segmentBytes < 64 * 1024 ||
      segmentBytes > MAX_SEGMENT_BYTES)
    bad("SEGMENT_LIMIT_INVALID");
  const pub = validPublicKey(recoveryPublicKey);
  const signer = validSigner(signingPrivateKey);
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  const run = randomUUID();
  let committed = false;
  try {
    const before = await input.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > MAX_FILE_BYTES ||
        !Number.isSafeInteger(before.size) ||
        Math.ceil(before.size / segmentBytes) > MAX_SEGMENTS)
      bad("IMMUTABLE_SOURCE_REQUIRED");
    const whole = createHash("sha256"), segments = [];
    for (let position = 0; position * segmentBytes < before.size; position++) {
      const start = position * segmentBytes;
      const length = Math.min(segmentBytes, before.size - start);
      const plain = Buffer.allocUnsafe(length);
      let offset = 0;
      try {
        while (offset < length) {
          const { bytesRead } = await input.read(plain, offset, length - offset, start + offset);
          if (!bytesRead) bad("SOURCE_TRUNCATED");
          offset += bytesRead;
        }
        if (!sameFile(before, await input.stat())) bad("SOURCE_CHANGED");
        whole.update(plain);
        const id = randomUUID(), sealed = sealSegment(plain, pub, run + "/" + id);
        const meta = { id, position, plaintextBytes: length,
          plaintextSha256: digest(plain), bytes: sealed.length, sha256: digest(sealed) };
        await sink.putStream(run, id, Readable.from([sealed]), { bytes: meta.bytes, sha256: meta.sha256 });
        segments.push(meta);
      } finally {
        plain.fill(0);
      }
    }
    if (!sameFile(before, await input.stat())) bad("SOURCE_CHANGED");
    const index = {
      version: 2, format: "singmotion-segmented-v2", run,
      bytes: before.size, plaintextSha256: whole.digest("hex"), segments,
      atomicAcrossStores: false,
    };
    const payload = JSON.stringify(index);
    const signed = Buffer.from(JSON.stringify({
      payload, signature: sign(null, Buffer.from(payload), signer).toString("base64"),
    }));
    if (signed.length > MAX_MANIFEST_BYTES) bad("MANIFEST_TOO_LARGE");
    const manifestId = randomUUID(), sealedManifest = sealSegment(signed, pub, run + "/" + manifestId);
    const manifestMeta = { bytes: sealedManifest.length, sha256: digest(sealedManifest) };
    await sink.putStream(run, manifestId, Readable.from([sealedManifest]), manifestMeta);
    await sink.commit(run, manifestId, segments.map(({id,bytes,sha256})=>({id,bytes,sha256})).concat([{id:manifestId,...manifestMeta}]));
    committed = true;
    return {
      run, manifestId, manifestMeta, segments: segments.length, bytes: before.size,
      remoteReceiptCommitted: true, independentRestoreVerified: false,
    };
  } finally {
    await input.close();
    if (!committed) await sink.abort?.(run);
  }
}

/** Separate recovery process. Only authorized run/manifest IDs and a retained
 * receipt are accepted. Never targets an existing file; deletes incomplete output.
 * Does not use or inherit source/cloud/payment credentials.
 */
export async function restoreSegmentedArchive({
  sink, run, manifestId, manifestMeta,
  recoveryPrivateKey, signingPublicKey, target,
}) {
  if (!idPattern.test(run) || !idPattern.test(manifestId) || !manifestMeta ||
      typeof target !== "string" || !target)
    bad("RECOVERY_INPUT_INVALID");
  const recovery = validPrivateKey(recoveryPrivateKey);
  const verifier = validVerifier(signingPublicKey);
  const encryptedManifest = await boundedRead(
    await sink.readStream(run, manifestId), manifestMeta.bytes, MAX_MANIFEST_BYTES + 8192 + 20,
  );
  if (digest(encryptedManifest) !== manifestMeta.sha256)
    bad("MANIFEST_CIPHERTEXT_MISMATCH");
  const signed = JSON.parse(openSegment(encryptedManifest, recovery, run + "/" + manifestId).toString("utf8"));
  if (typeof signed.payload !== "string" || typeof signed.signature !== "string" ||
      !verify(null, Buffer.from(signed.payload), verifier, Buffer.from(signed.signature, "base64")))
    bad("MANIFEST_SIGNATURE_INVALID");
  const index = ensureIndex(JSON.parse(signed.payload), run);
  let output, created = false, verified = false;
  try {
    output = await open(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    created = true;
    const whole = createHash("sha256");
    for (const item of index.segments) {
      const sealed = await boundedRead(
        await sink.readStream(run, item.id), item.bytes, MAX_SEGMENT_BYTES + 8192 + 20,
      );
      if (digest(sealed) !== item.sha256) bad("SEGMENT_CIPHERTEXT_MISMATCH");
      const plain = openSegment(sealed, recovery, run + "/" + item.id);
      try {
        if (plain.length !== item.plaintextBytes || digest(plain) !== item.plaintextSha256)
          bad("SEGMENT_PLAINTEXT_MISMATCH");
        whole.update(plain);
        let written = 0;
        while (written < plain.length) {
          const part = await output.write(plain, written, plain.length - written);
          if (!part.bytesWritten) bad("RESTORE_WRITE_FAILED");
          written += part.bytesWritten;
        }
      } finally { plain.fill(0); }
    }
    if (whole.digest("hex") !== index.plaintextSha256 ||
        (await output.stat()).size !== index.bytes)
      bad("RESTORED_FILE_INTEGRITY_FAILED");
    await output.sync();
    verified = true;
    return { recovered: true, run, segments: index.segments.length, bytes: index.bytes };
  } finally {
    await output?.close();
    if (created && !verified) await rm(target, { force: true });
  }
}
