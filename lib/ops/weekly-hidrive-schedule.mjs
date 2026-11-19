/**
 * Exact, owner-approved weekly HiDrive window for P0 #230.
 *
 * Separate services independently derive the same opaque run ID from
 * the TLS client's public certificate fingerprint and UTC Sunday date.
 * The ID is NOT an authentication token: peer mTLS fingerprint pinning
 * remains mandatory; no signing/recovery/HiDrive secrets are shared.
 */
import { createHash } from "node:crypto";

const DAY = 86_400_000;
const FINGERPRINT = /^([0-9a-f]{2}:){31}[0-9a-f]{2}$/i;
const fail = code => { throw Error(code); };

export const WEEKLY_RECEIVER_CRON_UTC = "0 3 * * 0";
export const WEEKLY_HIDRIVE_MAX_PLAINTEXT = 2 * 1024 * 1024 * 1024;

/** Pure UTC calculation, DST independent. Never returns a date in the past. */
export function weeklyBackupSlot(now, writerFingerprint) {
  if (!Number.isSafeInteger(now) || now < Date.UTC(2026,0,1) ||
      typeof writerFingerprint !== "string" || !FINGERPRINT.test(writerFingerprint))
    fail("WEEKLY_BACKUP_SLOT_INVALID");
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(),
    d.getUTCDate() - d.getUTCDay());
  const sunday = new Date(start).toISOString().slice(0,10);
  const seed = createHash("sha256")
    .update("singmotion-weekly-hidrive-v1/")
    .update(sunday)
    .update("/")
    .update(writerFingerprint.toUpperCase())
    .digest();
  const id = Buffer.from(seed.subarray(0,16));
  id[6] = (id[6] & 15) | 64; // RFC 4122 version 4-shaped, opaque deterministic id
  id[8] = (id[8] & 63) | 128;
  const hex = id.toString("hex");
  return Object.freeze({
    run: hex.slice(0,8)+"-"+hex.slice(8,12)+"-"+hex.slice(12,16)+"-"+
      hex.slice(16,20)+"-"+hex.slice(20),
    sunday, start, expiresAt: start + 5*60*60*1000,
    receiverOpen: now >= start+3*60*60*1000 &&
      now < start+5*60*60*1000,
    senderOpen: now >= start+(3*60+10)*60*1000 &&
      now < start+(3*60+20)*60*1000,
  });
}

export function weeklyBackupEnabled(env, receiver = false) {
  if (env?.BACKUP_WEEKLY_HIDRIVE_APPROVED !== "YES") return false;
  if (env?.BACKUP_WEEKLY_HIDRIVE_MAX_BYTES !== String(WEEKLY_HIDRIVE_MAX_PLAINTEXT))
    fail("WEEKLY_TRANSFER_BUDGET_REQUIRED");
  if (receiver) {
    if (env.BACKUP_MODE !== "PRODUCTION_WEEKLY_CIPHERTEXT_RECEIVER")
      fail("WEEKLY_RECEIVER_MODE_REFUSED");
  } else if (env.PRODUCTION_WEEKLY_HIDRIVE_ENABLED !== "YES") {
    fail("WEEKLY_SENDER_MODE_REFUSED");
  }
  return true;
}
