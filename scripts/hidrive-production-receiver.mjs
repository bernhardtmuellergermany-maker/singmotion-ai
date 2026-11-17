/**
 * One-shot, ciphertext-only Production HiDrive receiver.
 * Disabled by default: explicit short-lived run/approval and mTLS identities
 * are required. Never loads SQLite, PostgreSQL, R2, Stripe, provider, or RSA
 * recovery-private material. No public domain, proxy or general network bind.
 *
 * The existing OAuth state /state stays on the HiDrive-only service.
 */
import { X509Certificate, createPrivateKey } from "node:crypto";
import { networkInterfaces, tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { createPrivateReceiver, listenPrivate, isPrivateNetworkAddress } from "../lib/ops/private-backup-worker.mjs";
import { hidriveCiphertextSink } from "../lib/ops/hidrive-ciphertext-sink.mjs";
import { MAX_SEGMENT_BYTES, MAX_SEGMENTS } from "../lib/ops/backup-segmented-archive.mjs";

const PRODUCTION = "36adc41d-7e54-4396-ad1a-fd432ba0441d";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fingerprint = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const refused = (reason) => { throw Error(reason); };
const CERT_NAMES = Object.freeze([
  "BACKUP_RECEIVER_CA_B64", "BACKUP_RECEIVER_CERT_B64",
  "BACKUP_RECEIVER_KEY_B64",
]);
function pem(env,name) {
  const value = env[name];
  if (typeof value !== "string" || value.length < 80 ||
      value.length > 16_384 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) ||
      value.length % 4 !== 0)
    refused("RECEIVER_MTLS_CONFIG_INVALID");
  return Buffer.from(value,"base64");
}
/** Pure validation: NO OAuth refresh or HiDrive API activity until every
 * certificate, role, run, expiry and source-credential check passes. */
export function productionReceiverConfig(env, now = Date.now()) {
  if (env.RAILWAY_ENVIRONMENT_ID !== PRODUCTION ||
      env.RAILWAY_SERVICE_NAME !== "singmotion-backup" ||
      env.BACKUP_MODE !== "PRODUCTION_CIPHERTEXT_ONLY_RECEIVER" ||
      env.BACKUP_ENABLED !== "false" ||
      env.BACKUP_PROVIDER !== "STRATO_HIDRIVE" ||
      env.BACKUP_REAL_TRANSFER_APPROVED !== "YES" ||
      env.BACKUP_DATA_CLASS !== "PRODUCTION_ENCRYPTED_ONLY" ||
      env.HIDRIVE_AUTH_CODE ||
      !uuid.test(env.BACKUP_RUN_ID ?? "") ||
      typeof env.HIDRIVE_CLIENT_ID !== "string" ||
      !env.HIDRIVE_CLIENT_ID ||
      typeof env.HIDRIVE_CLIENT_SECRET !== "string" ||
      !env.HIDRIVE_CLIENT_SECRET ||
      typeof env.HIDRIVE_BACKUP_FOLDER !== "string" ||
      !env.HIDRIVE_BACKUP_FOLDER)
    refused("RECEIVER_PRODUCTION_ACTIVATION_REFUSED");
  if (Object.keys(env).some((key) =>
      key === "DATA_DIR" || key === "CMS_DATABASE_URL" ||
      /^(R2_|STRIPE_|BYTEPLUS_|PGPASSWORD|BACKUP_RECOVERY_PRIVATE|BACKUP_SIGNING_PRIVATE)/.test(key)))
    refused("RECEIVER_SOURCE_OR_RECOVERY_SECRET_REFUSED");
  const expiry = env.BACKUP_RECEIVER_EXPIRES_AT;
  const expiration = typeof expiry === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(expiry)
    ? Date.parse(expiry) : NaN;
  if (!Number.isFinite(expiration) || expiration <= now + 30_000 ||
      expiration - now > 2 * 60 * 60 * 1000)
    refused("RECEIVER_EXPIRY_INVALID");
  if (!fingerprint.test(env.BACKUP_RECEIVER_WRITER_FP ?? "") ||
      (env.BACKUP_RECEIVER_READER_FP !== undefined &&
       !fingerprint.test(env.BACKUP_RECEIVER_READER_FP)))
    refused("RECEIVER_CLIENT_IDENTITY_INVALID");
  const [caBytes,certBytes,keyBytes] = CERT_NAMES.map(name=>pem(env,name));
  let ca,cert,key;
  try {
    ca = new X509Certificate(caBytes);
    cert = new X509Certificate(certBytes);
    key = createPrivateKey(keyBytes);
  } catch { refused("RECEIVER_MTLS_CERTIFICATE_INVALID"); }
  if (!ca.ca || !cert.verify(ca.publicKey) ||
      !cert.checkPrivateKey(key) ||
      !cert.subjectAltName?.split(",").map(x=>x.trim()).includes(
        "DNS:singmotion-backup.railway.internal") ||
      Date.parse(ca.validFrom) > now ||
      Date.parse(cert.validFrom) > now ||
      Date.parse(ca.validTo) <= expiration ||
      Date.parse(cert.validTo) <= expiration ||
      Date.parse(cert.validTo)-now > 7*24*60*60*1000)
    refused("RECEIVER_MTLS_CERTIFICATE_INVALID");
  return {
    run:env.BACKUP_RUN_ID, expiry:expiration,
    clientFingerprint:env.BACKUP_RECEIVER_WRITER_FP,
    readerFingerprint:env.BACKUP_RECEIVER_READER_FP || null,
    tls:{ca:caBytes,cert:certBytes,key:keyBytes},
  };
}
function privateAddress(ifaces) {
  for(const entries of Object.values(ifaces)) {
    for(const item of entries ?? []) {
      if (!item.internal && isPrivateNetworkAddress(item.address))
        return item.address;
    }
  }
  return null;
}
/** Does not generate key material, create Railway services, expose a public
 * endpoint, activate a sender, accept arbitrary run IDs or send plaintext. */
export async function runProductionCiphertextReceiver(env,{
  now = Date.now,
  sessionFactory,
  interfaces = networkInterfaces,
  onReady = () => {},
}={}) {
  const config=productionReceiverConfig(env,now());
  if (typeof sessionFactory !== "function")
    refused("RECEIVER_OAUTH_FACTORY_MISSING");
  const host=privateAddress(interfaces());
  if (!host) refused("RECEIVER_PRIVATE_ADDRESS_UNAVAILABLE");
  // Only the exact, approved worker passes a synthesized internal transfer mode
  // to the already-validated OAuth refresh helper. It never updates Railway vars.
  const session=await sessionFactory({
    ...env,BACKUP_MODE:"PRIVATE_CIPHERTEXT_RECEIVER",
    BACKUP_TRANSFER_APPROVED:"YES",
  });
  const scratch=await mkdtemp(path.join(tmpdir(),"sm-private-ciphertext-"));
  let server;
  try {
    const sink=hidriveCiphertextSink({
      session,spool:scratch,maxBytes:MAX_SEGMENT_BYTES+8192+20,
    });
    server=createPrivateReceiver({
      tls:config.tls,clientFingerprint:config.clientFingerprint,
      readerFingerprint:config.readerFingerprint,
      allowedRun:config.run,
      sink,maxBytes:MAX_SEGMENT_BYTES+8192+20,
      maxFiles:MAX_SEGMENTS+1,
    });
    await listenPrivate(server,host,8443);
    onReady("HIDRIVE_PRIVATE_PRODUCTION_RECEIVER_READY");
    const shutdown=()=>{server.closeAllConnections();server.close();};
    const deadline=setTimeout(shutdown,Math.max(1,config.expiry-now()));
    try {
      await new Promise((resolve,reject)=>{
        server.once("close",resolve);
        server.once("error",reject);
      });
    } finally {
      clearTimeout(deadline);
    }
  } finally {
    if (server?.listening) await new Promise(resolve=>server.close(resolve));
    await rm(scratch,{recursive:true,force:true});
  }
}
