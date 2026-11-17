/**
 * HiDrive committed-archive discovery after receiver restart. Read-only.
 * Runs ONLY inside an already-authorized private HiDrive worker holding OAuth
 * state. The independent recovery host gets ciphertext through the separate
 * mTLS reader, never this session or any OAuth secret.
 *
 * A plaintext receipt contains random artifact IDs, lengths and ciphertext
 * hashes ONLY. It grants no plaintext integrity by itself: the restore MUST
 * verify the separately encrypted Ed25519-signed manifest and AES-GCM chunks.
 */
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { MAX_SEGMENT_BYTES, MAX_SEGMENTS } from "./backup-segmented-archive.mjs";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const sha = /^[a-f0-9]{64}$/;
const MAX_RECEIPT_BYTES = 1024 * 1024;
const MAX_ENCRYPTED_BYTES = MAX_SEGMENT_BYTES + 8192 + 20;
const fail = (name) => { throw Error(name); };

async function exactBody(body, maximum) {
  if (!body || !Number.isSafeInteger(maximum) || maximum < 1)
    fail("COMMITTED_RECEIPT_BODY_MISSING");
  const parts = [];
  let bytes = 0;
  for await (const piece of body) {
    const part = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);
    bytes += part.length;
    if (bytes > maximum) fail("COMMITTED_RECEIPT_TOO_LARGE");
    parts.push(part);
  }
  if (bytes === 0) fail("COMMITTED_RECEIPT_EMPTY");
  return Buffer.concat(parts, bytes);
}
export function validateCommittedReceipt(receipt, expectedRun) {
  if (!uuid.test(expectedRun) || !receipt || receipt.run !== expectedRun ||
      !uuid.test(receipt.manifestId ?? "") ||
      !Array.isArray(receipt.files) ||
      receipt.files.length < 1 || receipt.files.length > MAX_SEGMENTS + 1 ||
      Object.keys(receipt).sort().join(",") !== "files,manifestId,run")
    fail("COMMITTED_RECEIPT_INVALID");
  const entries = new Map();
  for (const file of receipt.files) {
    if (!file || Object.keys(file).sort().join(",") !== "bytes,id,sha256" ||
        !uuid.test(file.id) || entries.has(file.id) ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 40 ||
        file.bytes > MAX_ENCRYPTED_BYTES || !sha.test(file.sha256))
      fail("COMMITTED_FILE_INVALID");
    entries.set(file.id, { bytes: file.bytes, sha256: file.sha256 });
  }
  if (!entries.has(receipt.manifestId) ||
      receipt.files.at(-1).id !== receipt.manifestId)
    fail("COMMITTED_MANIFEST_MISSING");
  return {
    run: expectedRun,
    manifestId: receipt.manifestId,
    manifestMeta: entries.get(receipt.manifestId),
    entries,
  };
}

/** Open an independently reconstructed read-only index from exact known remote
 * receipt object; no directory LIST, no PUT/DELETE and no original in-memory
 * index are needed. Rejects unknown run/file IDs and uncommitted uploads.
 */
export async function openHiDriveCommittedReader({ session, run }) {
  if (!uuid.test(run) || typeof session?.dir !== "string" || !session.dir ||
      typeof session.request !== "function")
    fail("COMMITTED_READER_CONFIG_INVALID");
  const prefix = session.dir + "/sm-" + run + "-";
  async function read(id) {
    const response = await session.request("GET", "/file", { path: prefix + id + ".enc" }, null);
    if (!response?.ok || !response.body) fail("COMMITTED_REMOTE_READ_REFUSED");
    return response.body;
  }
  const receiptBuffer = await exactBody(await read("COMMITTED"), MAX_RECEIPT_BYTES);
  let receipt;
  try {
    receipt = JSON.parse(receiptBuffer.toString("utf8"));
  } catch { fail("COMMITTED_RECEIPT_INVALID"); }
  const index = validateCommittedReceipt(receipt, run);
  const receiptSha256 = createHash("sha256").update(receiptBuffer).digest("hex");
  async function readStream(requestedRun, id) {
    run: index.run,
    manifestId: index.manifestId,
    manifestMeta: index.manifestMeta,
      if (requestedRun !== run || !uuid.test(id) || !index.entries.has(id))
        fail("COMMITTED_OBJECT_NOT_AUTHORIZED");
      const meta = index.entries.get(id);
      const remote = await read(id);
      async function* verifyCiphertext() {
        const hash = createHash("sha256");
        let total = 0;
        for await (const part of remote) {
          const bytes = Buffer.isBuffer(part) ? part : Buffer.from(part);
          total += bytes.length;
          if (total > meta.bytes || total > MAX_ENCRYPTED_BYTES)
            fail("COMMITTED_CIPHERTEXT_OVERSIZE");
          hash.update(bytes);
          yield bytes;
        }
        if (total !== meta.bytes || hash.digest("hex") !== meta.sha256)
          fail("COMMITTED_CIPHERTEXT_MISMATCH");
      }
      return Readable.from(verifyCiphertext());
  }
  return {
    run: index.run,
    manifestId: index.manifestId,
    manifestMeta: index.manifestMeta,
    // Only stored ciphertext and receipt are read; no LIST, POST, PUT or DELETE.
    readStream,
    async verifyAllCiphertext({deadlineMs} = {}) {
      if (!Number.isSafeInteger(deadlineMs) ||
          deadlineMs <= Date.now() || deadlineMs > Date.now() + 60 * 60 * 1000)
        fail("COMMITTED_AUDIT_DEADLINE_INVALID");
      let files = 0, bytes = 0;
      for (const [id, meta] of index.entries) {
        if (Date.now() >= deadlineMs) fail("COMMITTED_AUDIT_DEADLINE");
        for await (const _ of await readStream(run, id)) {
          if (Date.now() >= deadlineMs) fail("COMMITTED_AUDIT_DEADLINE");
        }
        bytes += meta.bytes;
        files += 1;
      }
      return {run, files, bytes, receiptSha256, manifestId: index.manifestId};
    },
  };
}
