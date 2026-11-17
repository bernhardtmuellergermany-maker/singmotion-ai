/**
 * One-time, read-only Production HiDrive durable receipt audit.
 * Verifies the exact COMMITTED receipt and every encrypted segment after
 * losing receiver process memory. Never reads app/DB/R2 credentials or the
 * offline recovery private key. No public endpoint or HiDrive mutation.
 */
import { openHiDriveCommittedReader } from "../lib/ops/hidrive-committed-reader.mjs";

const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail = (code) => { throw Error(code); };

export function productionCommitAuditConfig(env, now = Date.now()) {
  if (env.RAILWAY_ENVIRONMENT_ID !== "36adc41d-7e54-4396-ad1a-fd432ba0441d" ||
      env.RAILWAY_SERVICE_NAME !== "singmotion-backup" ||
      env.BACKUP_MODE !== "PRODUCTION_COMMIT_AUDIT_V1" ||
      env.BACKUP_ENABLED !== "false" ||
      env.BACKUP_PROVIDER !== "STRATO_HIDRIVE" ||
      env.BACKUP_COMMIT_AUDIT_APPROVED !== "YES" ||
      env.BACKUP_REAL_TRANSFER_APPROVED ||
      env.HIDRIVE_AUTH_CODE ||
      !ID.test(env.BACKUP_RUN_ID ?? ""))
    fail("COMMIT_AUDIT_ACTIVATION_REFUSED");
  const date = env.BACKUP_COMMIT_AUDIT_EXPIRES_AT;
  const expiry = Date.parse(date ?? "");
  if (!Number.isFinite(expiry) || !date || new Date(expiry).toISOString() !== date ||
      expiry < now + 30 * 1000 || expiry > now + 60 * 60 * 1000)
    fail("COMMIT_AUDIT_EXPIRY_INVALID");
  for (const name of [
    "DATA_DIR", "CMS_DATABASE_URL", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
    "STRIPE_SECRET_KEY", "BYTEPLUS_SECRET_ACCESS_KEY", "PGPASSWORD",
    "BACKUP_RECOVERY_PRIVATE_KEY_B64", "BACKUP_SIGNING_PRIVATE_KEY_B64"
  ]) if (env[name]) fail("COMMIT_AUDIT_SOURCE_SECRET_REFUSED");
  return {run: env.BACKUP_RUN_ID, deadlineMs: expiry};
}

export async function runProductionCommitAudit(env, {
  now = Date.now,
  sessionFactory,
  onVerified = () => {},
} = {}) {
  const cfg = productionCommitAuditConfig(env, now());
  if (typeof sessionFactory !== "function")
    fail("COMMIT_AUDIT_OAUTH_FACTORY_MISSING");
  // Reuses the existing secured HiDrive refresh-token state. The sole data
  // calls below are GET /file: the temporary private mode is not a listener.
  const session = await sessionFactory({
    ...env,
    BACKUP_MODE: "PRIVATE_CIPHERTEXT_RECEIVER",
    BACKUP_TRANSFER_APPROVED: "YES",
  });
  const reader = await openHiDriveCommittedReader({session, run: cfg.run});
  const report = await reader.verifyAllCiphertext({deadlineMs: cfg.deadlineMs});
  onVerified("HIDRIVE_PRODUCTION_COMMIT_READBACK_VERIFIED",
    JSON.stringify({run: report.run, files: report.files, bytes: report.bytes,
      receiptSha256: report.receiptSha256}));
  return report;
}
