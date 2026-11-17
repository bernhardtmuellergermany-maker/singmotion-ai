import {
  createPrivateKey,
  createPublicKey,
  createHash,
  X509Certificate,
} from "node:crypto";
export function keyId(pem) {
  const key = pem?.type === "public" ? pem : createPublicKey(pem);
  return createHash("sha256")
    .update(key.export({ type: "spki", format: "der" }))
    .digest("hex");
}
const decode = (env, name) => Buffer.from(env[name] ?? "", "base64");
export function validateRuntimeKeys(env, now = Date.now()) {
  const expires = Date.parse(env.BACKUP_TEST_EXPIRES_AT);
  if (
    !Number.isFinite(expires) ||
    expires <= now ||
    expires - now > 30 * 60 * 1000
  )
    throw Error("TEST_ACTIVATION_EXPIRED");
  const role = env.BACKUP_INTEGRATION_ROLE;
  const identity = { receiver: "SERVER", sender: "WRITER", restore: "READER" }[
    role
  ];
  if (!identity) throw Error("INVALID_ROLE");
  const cert = new X509Certificate(
    decode(env, `BACKUP_TEST_${identity}_CERT_B64`),
  );
  const ca = new X509Certificate(decode(env, "BACKUP_TEST_CA_B64"));
  const key = createPrivateKey(decode(env, `BACKUP_TEST_${identity}_KEY_B64`));
  if (
    !ca.ca ||
    !cert.verify(ca.publicKey) ||
    !cert.checkPrivateKey(key) ||
    Date.parse(cert.validFrom) > now ||
    Date.parse(cert.validTo) < expires ||
    Date.parse(ca.validTo) < expires ||
    Date.parse(ca.validFrom) > now ||
    Date.parse(cert.validTo) - now > 3 * 86400000
  )
    throw Error("TEST_CERTIFICATE_INVALID");
  if (role === "receiver") return;
  const recovery =
    role === "restore"
      ? createPrivateKey(decode(env, "BACKUP_RECOVERY_PRIVATE_KEY_B64"))
      : createPublicKey(decode(env, "BACKUP_RECOVERY_PUBLIC_KEY_B64"));
  const signing =
    role === "sender"
      ? createPrivateKey(decode(env, "BACKUP_SIGNING_PRIVATE_KEY_B64"))
      : createPublicKey(decode(env, "BACKUP_SIGNING_PUBLIC_KEY_B64"));
  if (
    recovery.asymmetricKeyType !== "rsa" ||
    recovery.asymmetricKeyDetails.modulusLength < 3072 ||
    signing.asymmetricKeyType !== "ed25519"
  )
    throw Error("BACKUP_KEY_POLICY_FAILED");
}
