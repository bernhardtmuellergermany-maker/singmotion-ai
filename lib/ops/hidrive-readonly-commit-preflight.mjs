/**
 * Independent, ciphertext-only HiDrive readback for GitHub #230.
 *
 * This module has no source credentials, upload/delete API, RSA private key,
 * payment/provider credentials or startup hook. All remote reads are GET /file.
 * A plaintext COMMITTED receipt is NOT a cryptographic attestation; the
 * manifest is pinned here to the previously observed sender SHA-256.
 */
import { createHash } from "node:crypto";
import { validateCommittedReceipt } from "./hidrive-committed-reader.mjs";

export const PRODUCTION_RECEIPT_PIN_230 = Object.freeze({
  run: "267e5c70-7bdd-4157-ba40-5a757bdc07d9",
  manifestId: "a05306b2-6e93-4d41-bc32-82c175caa422",
  manifestBytes: 381510,
  manifestSha256: "78e4ca1d7f445116329c919c74240f74f17c6ecab1f769f541b820a5809d379e",
  segments: 689,
  sourceFiles: 533,
  sourceBytes: 1298458814,
});

const MAX_RECEIPT_BYTES = 1024 * 1024;
const fail = (code) => { throw Error(code); };
const sha = /^[a-f0-9]{64}$/;

async function get(session, run, id) {
  if (typeof session?.request !== "function" ||
      typeof session?.dir !== "string" || !session.dir ||
      !/^[a-f0-9-]{36}$/.test(run) ||
      (id !== "COMMITTED" && !/^[a-f0-9-]{36}$/.test(id)))
    fail("READONLY_SESSION_INVALID");
  let response;
  try {
    response = await session.request("GET", "/file", {
      path: session.dir + "/sm-" + run + "-" + id + ".enc",
    }, null);
  } catch { fail("HIDRIVE_READ_FAILED"); }
  if (!response?.ok || !response?.body) fail("HIDRIVE_READ_FAILED");
  return response.body;
}

async function collectBounded(body, maxBytes) {
  const chunks = [];
  let total = 0;
  try {
    for await (const piece of body) {
      const chunk = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);
      total += chunk.length;
      if (total > maxBytes) fail("RECEIPT_TOO_LARGE");
      chunks.push(chunk);
    }
  } catch { fail("HIDRIVE_READ_FAILED"); }
  if (total === 0) fail("RECEIPT_EMPTY");
  return Buffer.concat(chunks, total);
}

async function verifyCiphertext(body, expected) {
  if (!expected || !Number.isSafeInteger(expected.bytes) ||
      expected.bytes < 40 || !sha.test(expected.sha256))
    fail("CIPHERTEXT_METADATA_INVALID");
  const hash = createHash("sha256");
  let count = 0;
  try {
    for await (const piece of body) {
      const chunk = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);
      count += chunk.length;
      if (count > expected.bytes) fail("CIPHERTEXT_SIZE_INVALID");
      hash.update(chunk);
    }
  } catch { fail("HIDRIVE_READ_FAILED"); }
  if (count !== expected.bytes || hash.digest("hex") !== expected.sha256)
    fail("CIPHERTEXT_HASH_INVALID");
  return count;
}

/**
 * Read-only, independent verification. With verifyAll=false it downloads only
 * the receipt and encrypted signed manifest; with true it checks every
 * receipt-allowlisted ciphertext. This DOES NOT decrypt or restore original data.
 * The separate operator's trusted host must independently authenticate the
 * HiDrive OAuth grant as user,ro; the session itself cannot prove token scope.
 */
export async function verifyRemoteCommittedCiphertext230({
  session, pin = PRODUCTION_RECEIPT_PIN_230, verifyAll = false,
}) {
  if (!pin || typeof pin.run !== "string" ||
      !/^[a-f0-9-]{36}$/.test(pin.run) ||
      !/^[a-f0-9-]{36}$/.test(pin.manifestId) ||
      !Number.isSafeInteger(pin.manifestBytes) ||
      pin.manifestBytes < 40 || !sha.test(pin.manifestSha256) ||
      !Number.isSafeInteger(pin.segments) || pin.segments < 1)
    fail("PIN_INVALID");

  const receiptBytes = await collectBounded(
    await get(session, pin.run, "COMMITTED"), MAX_RECEIPT_BYTES,
  );
  let receipt;
  try { receipt = JSON.parse(receiptBytes.toString("utf8")); }
  catch { fail("RECEIPT_INVALID"); }
  const index = validateCommittedReceipt(receipt, pin.run);
  if (index.manifestId !== pin.manifestId ||
      index.manifestMeta.bytes !== pin.manifestBytes ||
      index.manifestMeta.sha256 !== pin.manifestSha256 ||
      index.entries.size !== pin.segments + 1)
    fail("RECEIPT_PIN_MISMATCH");

  // Bound full remote readback to at most 2 GiB of encrypted data,
  // verified against the signed, pinned COMMITTED inventory before streaming.
  if (verifyAll) {
    const totalExpectedBytes = [...index.entries.values()].reduce(
      (sum, item) => sum + item.bytes, 0
    );
    if (!Number.isSafeInteger(totalExpectedBytes) ||
        totalExpectedBytes > 2 * 1024 * 1024 * 1024)
      fail("READONLY_SCAN_BUDGET_EXCEEDED");
  }
  // Ciphertext manifest SHA matches the sender's logged commit. No RSA needed.
  let verifiedBytes = await verifyCiphertext(
    await get(session, pin.run, pin.manifestId), index.manifestMeta,
  );
  let verifiedObjects = 1;
  if (verifyAll) {
    for (const [id, meta] of index.entries) {
      if (id === pin.manifestId) continue;
      verifiedBytes += await verifyCiphertext(
        await get(session, pin.run, id), meta,
      );
      verifiedObjects++;
      if (verifiedObjects % 50 === 0) {
        // Counts only: no object names, paths, tokens or sensitive metadata.
        console.log("HIDRIVE_READONLY_OBJECTS_VERIFIED=" + verifiedObjects);
      }
    }
    if (verifiedObjects !== pin.segments + 1)
      fail("REMOTE_COVERAGE_MISMATCH");
  }
  // Only aggregate, non-sensitive diagnostics. No object paths or tokens.
  return {
    run: pin.run,
    remoteReceiptStructurallyValid: true,
    manifestCiphertextSha256Verified: true,
    pinnedManifestId: pin.manifestId,
    ciphertextObjectsVerified: verifiedObjects,
    ciphertextBytesVerified: verifiedBytes,
    completeCiphertextReadbackVerified: Boolean(verifyAll),
    signingKeyVerified: false,
    rsaDecryptionVerified: false,
    independentRestoreVerified: false,
  };
}
