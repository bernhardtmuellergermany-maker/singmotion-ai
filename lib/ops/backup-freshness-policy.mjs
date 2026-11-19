/** Fail-closed weekly HiDrive backup freshness policy for #230.
 * Consumes a signed, external *successful* completed-backup attestation;
 * never infers success from receiver startup or a scheduled task firing.
 * Pure functions; no network, source credentials, billing or media access.
 */
import { createPublicKey, verify } from "node:crypto";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const sha = /^[a-f0-9]{64}$/;
const iso = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/;
export const WEEKLY_HIDRIVE_INTERVAL_DAYS = 7;
// One retry day grace without silently claiming an overdue backup is current.
export const WEEKLY_HIDRIVE_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000;
const refuse = reason => { throw new Error(reason); };

/** Canonical wire format is the exact JSON-string *payload*, signed with
 * Ed25519 by a trusted producer after remote ciphertext COMMIT verification.
 * The verifier never trusts an unsigned receipt or the worker's own status.
 */
export function evaluateBackupFreshness({ payload, signature, verifierPublicKey, now = Date.now() }) {
  if (typeof payload !== "string" || payload.length < 30 || payload.length > 8192 ||
      typeof signature !== "string" || !/^[a-zA-Z0-9+/]+={0,2}$/.test(signature) ||
      typeof now !== "number" || !Number.isFinite(now)) refuse("BACKUP_ATTESTATION_INVALID");
  let key;
  try { key = createPublicKey(verifierPublicKey); }
  catch { refuse("BACKUP_VERIFIER_INVALID"); }
  if (key.asymmetricKeyType !== "ed25519") refuse("BACKUP_VERIFIER_INVALID");
  const sig = Buffer.from(signature, "base64");
  if (sig.length !== 64 || !verify(null, Buffer.from(payload, "utf8"), key, sig))
    refuse("BACKUP_SIGNATURE_INVALID");
  let record;
  try { record = JSON.parse(payload); }
  catch { refuse("BACKUP_PAYLOAD_INVALID"); }
  if (!record || Object.keys(record).sort().join(",") !==
      "ciphertextObjects,completedAt,coverage,receiptSha256,run,status,verifiedAt,version" ||
      record.version !== 1 || record.status !== "COMMITTED_REMOTE_VERIFIED" ||
      !uuid.test(record.run) || !sha.test(record.receiptSha256) ||
      !Number.isSafeInteger(record.ciphertextObjects) || record.ciphertextObjects < 5 ||
      record.ciphertextObjects > 10000 ||
      !record.coverage || Object.keys(record.coverage).sort().join(",") !==
      "local,postgres,r2,sqlite" ||
      !Number.isSafeInteger(record.coverage.sqlite) || record.coverage.sqlite < 3 ||
      record.coverage.postgres !== 1 || record.coverage.local !== true ||
      record.coverage.r2 !== true ||
      !iso.test(record.completedAt) || !iso.test(record.verifiedAt))
    refuse("BACKUP_EVIDENCE_INVALID");
  const completed = Date.parse(record.completedAt), verified = Date.parse(record.verifiedAt);
  if (!Number.isFinite(completed) || !Number.isFinite(verified) ||
      verified < completed || verified > now + 120_000 ||
      completed > now + 120_000) refuse("BACKUP_CLOCK_INVALID");
  if (now - completed > WEEKLY_HIDRIVE_MAX_AGE_MS) refuse("BACKUP_STALE");
  if (now - verified > WEEKLY_HIDRIVE_MAX_AGE_MS) refuse("BACKUP_VERIFICATION_STALE");
  return Object.freeze({ ok: true, schedule: "WEEKLY_HIDRIVE", maxAgeDays: 8,
    run: record.run, completedAt: record.completedAt,
    verifiedAt: record.verifiedAt, ageHours: Math.round((now-completed)/3600000*100)/100 });
}
