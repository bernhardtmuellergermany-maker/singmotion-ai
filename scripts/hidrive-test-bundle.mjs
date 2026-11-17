// Cloud-side preparation only. Returned secret bundle must never be logged or
// committed; pass directly to the authenticated connector controller after approval.
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { createTestPKI } from "./backup-network-certificates.mjs";
import { validateRuntimeKeys } from "../lib/ops/backup-key-policy.mjs";
export async function createCombinedBundle(now = Date.now()) {
  const pki = await createTestPKI("singmotion-backup.railway.internal");
  const encoding = {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  };
  const recovery = generateKeyPairSync("rsa", {
    ...encoding,
    modulusLength: 3072,
  });
  const signing = generateKeyPairSync("ed25519", encoding);
  const b64 = (x) => Buffer.from(x).toString("base64");
  const common = {
    BACKUP_RUN_ID: randomUUID(),
    BACKUP_ARTIFACT_ID: randomUUID(),
    BACKUP_MANIFEST_ID: randomUUID(),
    BACKUP_TEST_EXPIRES_AT: new Date(now + 25 * 60000).toISOString(),
    BACKUP_ENABLED: "false",
    BACKUP_SYNTHETIC_HIDRIVE_APPROVED: "YES",
    BACKUP_DATA_CLASS: "SYNTHETIC_ONLY",
    BACKUP_TEST_CA_B64: pki.BACKUP_TEST_CA_B64,
    BACKUP_TEST_ORIGIN: "https://singmotion-backup.railway.internal:8443",
  };
  const sender = {
    ...common,
    BACKUP_INTEGRATION_ROLE: "sender",
    BACKUP_TEST_WRITER_CERT_B64: pki.BACKUP_TEST_WRITER_CERT_B64,
    BACKUP_TEST_WRITER_KEY_B64: pki.BACKUP_TEST_WRITER_KEY_B64,
    BACKUP_RECOVERY_PUBLIC_KEY_B64: b64(recovery.publicKey),
    BACKUP_SIGNING_PRIVATE_KEY_B64: b64(signing.privateKey),
  };
  const restore = {
    ...common,
    BACKUP_INTEGRATION_ROLE: "restore",
    BACKUP_TEST_READER_CERT_B64: pki.BACKUP_TEST_READER_CERT_B64,
    BACKUP_TEST_READER_KEY_B64: pki.BACKUP_TEST_READER_KEY_B64,
    BACKUP_RECOVERY_PRIVATE_KEY_B64: b64(recovery.privateKey),
    BACKUP_SIGNING_PUBLIC_KEY_B64: b64(signing.publicKey),
  };
  const config = {
    approved: true,
    ...Object.fromEntries(
      [
        "BACKUP_RUN_ID",
        "BACKUP_ARTIFACT_ID",
        "BACKUP_MANIFEST_ID",
        "BACKUP_TEST_EXPIRES_AT",
      ].map((k) => [k, common[k]]),
    ),
    ...Object.fromEntries(
      [
        "BACKUP_TEST_CA_B64",
        "BACKUP_TEST_SERVER_CERT_B64",
        "BACKUP_TEST_SERVER_KEY_B64",
        "BACKUP_TEST_WRITER_FP",
        "BACKUP_TEST_READER_FP",
      ].map((k) => [k, pki[k]]),
    ),
  };
  // OpenSSL issues certificates after bundle creation begins. Compare their
  // notBefore against the actual post-generation clock rather than the
  // pre-generation timestamp, which can cross a whole-second boundary.
  const validationTime = Date.now();
  validateRuntimeKeys(sender, validationTime);
  validateRuntimeKeys(restore, validationTime);
  return {
    sender,
    restore,
    receiver: {
      BACKUP_MODE: "PRIVATE_SYNTHETIC_V2:" + b64(JSON.stringify(config)),
    },
  };
}
