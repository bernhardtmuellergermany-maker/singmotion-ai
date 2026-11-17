/**
 * Browser-downloaded HiDrive COMMITTED receipt + encrypted manifest verifier.
 * No remote OAuth token, access to application secrets, RSA private key,
 * uploads, network requests, or plaintext decryption.
 *
 * The caller supplies two ciphertext-only files obtained from the remote.
 * This validates their contents against the pinned Production sender logs,
 * NOT their provenance as a true independently authenticated HiDrive GET.
 */
import { createHash } from "node:crypto";
import { open, lstat } from "node:fs/promises";
import { validateCommittedReceipt } from "./hidrive-committed-reader.mjs";
import { PRODUCTION_RECEIPT_PIN_230 } from "./hidrive-readonly-commit-preflight.mjs";

const reject = (code) => { throw Error(code); };
const MAX_RECEIPT_BYTES = 1024 * 1024;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024 + 8192 + 20;

async function readOwnedPlainFile(filename, maxBytes) {
  if (typeof filename !== "string" || !filename.startsWith("/") ||
      filename.includes("\0")) reject("PRIVATE_INPUT_PATH_REQUIRED");
  let st;
  try { st = await lstat(filename); }
  catch { reject("LOCAL_FILE_UNREADABLE"); }
  if (!st.isFile() || st.isSymbolicLink() || st.size < 1 ||
      st.size > maxBytes || (process.getuid && st.uid !== process.getuid()) ||
      (st.mode & 0o022) !== 0)
    reject("LOCAL_FILE_NOT_PRIVATE_REGULAR");
  const fd = await open(filename,"r");
  try {
    const opened = await fd.stat();
    if (!opened.isFile() || opened.ino !== st.ino ||
        opened.dev !== st.dev || opened.size !== st.size)
      reject("LOCAL_FILE_CHANGED");
    const data = await fd.readFile();
    if (data.length !== st.size) reject("LOCAL_FILE_CHANGED");
    return data;
  } finally { await fd.close(); }
}

export function validateLocalHiDriveReceiptManifest230(receiptBuffer, manifestBuffer, pin = PRODUCTION_RECEIPT_PIN_230) {
  if (!Buffer.isBuffer(receiptBuffer) || !Buffer.isBuffer(manifestBuffer) ||
      receiptBuffer.length < 1 || receiptBuffer.length > MAX_RECEIPT_BYTES ||
      manifestBuffer.length < 40 || manifestBuffer.length > MAX_MANIFEST_BYTES)
    reject("LOCAL_ENCRYPTED_INPUT_INVALID");
  let receipt;
  try { receipt = JSON.parse(receiptBuffer.toString("utf8")); }
  catch { reject("COMMITTED_RECEIPT_INVALID"); }
  const validated = validateCommittedReceipt(receipt,pin.run);
  if (validated.manifestId !== pin.manifestId ||
      validated.manifestMeta.bytes !== pin.manifestBytes ||
      validated.manifestMeta.sha256 !== pin.manifestSha256 ||
      validated.entries.size !== pin.segments + 1)
    reject("COMMITTED_RECEIPT_PIN_MISMATCH");
  const actual = createHash("sha256").update(manifestBuffer).digest("hex");
  if (manifestBuffer.length !== pin.manifestBytes || actual !== pin.manifestSha256)
    reject("LOCAL_MANIFEST_HASH_MISMATCH");
  return {
    run: pin.run,
    pinSource: "sender_log_2026_11_17",
    localCommittedReceiptVerified: true,
    localEncryptedManifestSha256Verified: true,
    receiptAllowlistedCiphertextObjects: validated.entries.size,
    manifestEncryptedBytes: manifestBuffer.length,
    // This tool cannot prove provenance of files the operator downloaded.
    independentlyAuthenticatedHiDriveGetVerified: false,
    fullCiphertextReadbackVerified: false,
    manifestSignatureVerified: false,
    rsaDecryptionVerified: false,
    independentRestoreVerified: false,
  };
}

export async function verifyLocalHiDriveReceiptManifest230({receiptPath,manifestPath}) {
  if (receiptPath === manifestPath) reject("LOCAL_INPUT_PATHS_MUST_DIFFER");
  const [receipt,manifest] = await Promise.all([
    readOwnedPlainFile(receiptPath,MAX_RECEIPT_BYTES),
    readOwnedPlainFile(manifestPath,MAX_MANIFEST_BYTES),
  ]);
  return validateLocalHiDriveReceiptManifest230(receipt,manifest);
}
