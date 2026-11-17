/** Explicit one-run synthetic HiDrive integration; never called by app startup.
 * Provisioning/activation is deliberately separate from this implementation.
 */
import assert from "node:assert/strict";
import { inspectResiduals } from "../lib/ops/hidrive-residual-check.mjs";
import { keyId, validateRuntimeKeys } from "../lib/ops/backup-key-policy.mjs";
import { phase } from "../lib/ops/backup-errors.mjs";
const report = (code) => console.error(code);
import https from "node:https";
import { lookup } from "node:dns/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { sign } from "node:crypto";
import {
  encryptFile,
  decryptFile,
  hashFile,
  verifyManifest,
} from "../lib/ops/cloud-backup.mjs";
import {
  createPrivateReceiver,
  listenPrivate,
  isPrivateNetworkAddress,
  privateWorkerSink,
} from "../lib/ops/private-backup-worker.mjs";
import { hidriveCiphertextSink } from "../lib/ops/hidrive-ciphertext-sink.mjs";
import { existingHiDriveSession } from "./hidrive-backup-worker.mjs";

const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
// One existing variable contains the temporary receiver-only configuration.
// Restoring BACKUP_MODE removes it completely; no new Production secret variables
// or copies of OAuth credentials are needed for the proposed test.
export function receiverEnvironment(env) {
  const prefix = "PRIVATE_SYNTHETIC_V2:";
  if (
    env.RAILWAY_SERVICE_NAME !== "singmotion-backup" ||
    !env.BACKUP_MODE?.startsWith(prefix) ||
    env.BACKUP_MODE.length > 32768
  )
    throw Error("EXPLICIT_RECEIVER_MODE_REQUIRED");
  const config = JSON.parse(
    Buffer.from(env.BACKUP_MODE.slice(prefix.length), "base64").toString(
      "utf8",
    ),
  );
  const keys = [
    "BACKUP_TEST_EXPIRES_AT",
    "BACKUP_RUN_ID",
    "BACKUP_ARTIFACT_ID",
    "BACKUP_MANIFEST_ID",
    "BACKUP_TEST_CA_B64",
    "BACKUP_TEST_SERVER_CERT_B64",
    "BACKUP_TEST_SERVER_KEY_B64",
    "BACKUP_TEST_WRITER_FP",
    "BACKUP_TEST_READER_FP",
  ];
  if (
    config.approved !== true ||
    Object.keys(config).some(
      (key) => key !== "approved" && !keys.includes(key),
    ) ||
    keys.some((key) => typeof config[key] !== "string" || !config[key])
  )
    throw Error("INVALID_RECEIVER_CONFIGURATION");
  const result = {
    ...env,
    ...Object.fromEntries(keys.map((key) => [key, config[key]])),
    BACKUP_MODE: "PRIVATE_CIPHERTEXT_RECEIVER",
    BACKUP_TRANSFER_APPROVED: "YES",
    BACKUP_SYNTHETIC_HIDRIVE_APPROVED: "YES",
    BACKUP_DATA_CLASS: "SYNTHETIC_ONLY",
    BACKUP_INTEGRATION_ROLE: "receiver",
  };
  validateIntegration(result);
  return result;
}
export function validateIntegration(env) {
  if (
    env.BACKUP_DATA_CLASS !== "SYNTHETIC_ONLY" ||
    env.BACKUP_SYNTHETIC_HIDRIVE_APPROVED !== "YES" ||
    env.BACKUP_ENABLED !== "false"
  )
    throw Error("SYNTHETIC_HIDRIVE_APPROVAL_REQUIRED");
  if (!["sender", "receiver", "restore"].includes(env.BACKUP_INTEGRATION_ROLE))
    throw Error("INVALID_ROLE");
  for (const k of ["BACKUP_RUN_ID", "BACKUP_ARTIFACT_ID", "BACKUP_MANIFEST_ID"])
    if (!uuid.test(env[k])) throw Error("INVALID_SYNTHETIC_ID");
  if (
    new Set([env.BACKUP_RUN_ID, env.BACKUP_ARTIFACT_ID, env.BACKUP_MANIFEST_ID])
      .size !== 3
  )
    throw Error("DUPLICATE_SYNTHETIC_ID");
  if (
    Object.keys(env).some((k) =>
      /^(DATA_DIR$|CMS_DATABASE_URL$|R2_|STRIPE_|BYTEPLUS_|HIDRIVE_AUTH_CODE$)/.test(
        k,
      ),
    )
  )
    throw Error("SOURCE_CREDENTIALS_FORBIDDEN");
  if (
    env.BACKUP_INTEGRATION_ROLE !== "receiver" &&
    Object.keys(env).some((k) => k.startsWith("HIDRIVE_"))
  )
    throw Error("OAUTH_ONLY_ON_RECEIVER");
  if (
    env.BACKUP_INTEGRATION_ROLE !== "restore" &&
    env.BACKUP_RECOVERY_PRIVATE_KEY_B64
  )
    throw Error("RECOVERY_KEY_ONLY_ON_RESTORE");
  if (
    env.BACKUP_INTEGRATION_ROLE !== "sender" &&
    env.BACKUP_SIGNING_PRIVATE_KEY_B64
  )
    throw Error("SIGNING_KEY_ONLY_ON_SENDER");
}
const decode = (env, key) => Buffer.from(env[key] ?? "", "base64");
const tls = (env, role) => ({
  ca: decode(env, "BACKUP_TEST_CA_B64"),
  cert: decode(env, `BACKUP_TEST_${role}_CERT_B64`),
  key: decode(env, `BACKUP_TEST_${role}_KEY_B64`),
});
async function download(origin, route, config, target) {
  await new Promise((resolve, reject) => {
    const req = https.get(
      new URL(route, origin),
      {
        ...config,
        rejectUnauthorized: true,
        minVersion: "TLSv1.3",
        timeout: 30000,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(
            Object.assign(Error("ARCHIVE_NOT_READY"), {
              code: res.statusCode === 404 ? "NOT_READY" : "DOWNLOAD_REFUSED",
            }),
          );
          return;
        }
        let n = 0;
        res.on("data", (chunk) => {
          n += chunk.length;
          if (n > 1024 * 1024) res.destroy(Error("SIZE_LIMIT"));
        });
        pipeline(
          res,
          createWriteStream(target, { flags: "wx", mode: 0o600 }),
        ).then(resolve, reject);
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(Error("TIMEOUT")));
  });
}
export async function runHiDriveIntegration(env = process.env) {
  validateIntegration(env);
  validateRuntimeKeys(env);
  const role = env.BACKUP_INTEGRATION_ROLE,
    run = env.BACKUP_RUN_ID,
    id = env.BACKUP_ARTIFACT_ID,
    manifestId = env.BACKUP_MANIFEST_ID;
  const root = await mkdtemp(path.join(tmpdir(), "sm-hidrive-integration-"));
  // Bounds CPU/memory charges and all network waits for this single execution.
  const watchdog = setTimeout(
    () => {
      console.error("HIDRIVE_SYNTHETIC_DEADLINE_EXCEEDED");
      process.exit(1);
    },
    Math.min(
      15 * 60 * 1000,
      Date.parse(env.BACKUP_TEST_EXPIRES_AT) - Date.now(),
    ),
  );
  try {
    if (role === "receiver") {
      const session = await phase(
        "SESSION",
        () => existingHiDriveSession(env),
        report,
      );
      await phase(
        "READ",
        () =>
          inspectResiduals(session, (result) =>
            console.log("HIDRIVE_RESIDUAL_RESULT", JSON.stringify(result)),
          ),
        report,
      );
      console.log("HIDRIVE_RESIDUAL_CHECK_COMPLETED");
      const storage = hidriveCiphertextSink({
        session,
        report,
        spool: root,
        maxBytes: 1024 * 1024,
      });
      const scope = (r, i) => {
        if (r !== run || ![id, manifestId].includes(i))
          throw Error("SYNTHETIC_SCOPE_ONLY");
      };
      const server = createPrivateReceiver({
        report,
        tls: tls(env, "SERVER"),
        clientFingerprint: env.BACKUP_TEST_WRITER_FP,
        readerFingerprint: env.BACKUP_TEST_READER_FP,
        maxFiles: 2,
        maxBytes: 1024 * 1024,
        sink: {
          putStream: (r, i, ...rest) => {
            scope(r, i);
            return storage.putStream(r, i, ...rest);
          },
          commit: async (r, m, files) => {
            scope(r, m);
            if (m !== manifestId || files.length !== 2)
              throw Error("SYNTHETIC_MANIFEST_REQUIRED");
            await storage.commit(r, m, files);
            console.log("HIDRIVE_SYNTHETIC_REMOTE_COMMIT_VERIFIED");
          },
          readStream: (r, i) => {
            scope(r, i);
            return storage.readStream(r, i);
          },
        },
      });
      let address;
      for (let i = 0; i < 90; i++) {
        try {
          const records = await lookup(env.RAILWAY_PRIVATE_DOMAIN, {
            all: true,
          });
          if (records.some((x) => isPrivateNetworkAddress(x.address))) {
            const interfaces = Object.values(networkInterfaces())
              .flat()
              .filter(
                (x) => x && !x.internal && isPrivateNetworkAddress(x.address),
              );
            address = (
              interfaces.find((x) => x.family === "IPv6") ?? interfaces[0]
            )?.address;
          }
        } catch {}
        if (address) break;
        await delay(1000);
      }
      if (!address) throw Error("PRIVATE_ADDRESS_UNAVAILABLE");
      await phase("LISTEN", () => listenPrivate(server, address, 8443), report);
      console.log("HIDRIVE_SYNTHETIC_PRIVATE_RECEIVER_READY");
      const deadline = setTimeout(
        () => {
          server.closeAllConnections();
          server.close();
        },
        10 * 60 * 1000,
      );
      await new Promise((resolve) => server.once("close", resolve));
      clearTimeout(deadline);
      return;
    }
    const origin = env.BACKUP_TEST_ORIGIN,
      url = new URL(origin);
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".railway.internal") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw Error("PRIVATE_ORIGIN_REQUIRED");
    if (role === "sender") {
      const plain = path.join(root, "fixture");
      // Fixed artificial bytes only: no user path, file, DB or remote source accepted.
      await writeFile(
        plain,
        `SingMotion artificial HiDrive integration\n${run}\n`,
        { mode: 0o600 },
      );
      const archive = path.join(root, "archive");
      const meta = await encryptFile(
        plain,
        archive,
        decode(env, "BACKUP_RECOVERY_PUBLIC_KEY_B64"),
        `${run}/${id}`,
      );
      const manifest = {
        version: 1,
        run,
        synthetic: true,
        recoveryKeyId: keyId(decode(env, "BACKUP_RECOVERY_PUBLIC_KEY_B64")),
        signingKeyId: keyId(decode(env, "BACKUP_SIGNING_PRIVATE_KEY_B64")),
        files: [
          {
            id,
            kind: "synthetic",
            plaintextSha256: await hashFile(plain),
            ...meta,
          },
        ],
      };
      const payload = JSON.stringify(manifest),
        manifestPlain = path.join(root, "manifest");
      await writeFile(
        manifestPlain,
        JSON.stringify({
          payload,
          signature: sign(
            null,
            Buffer.from(payload),
            decode(env, "BACKUP_SIGNING_PRIVATE_KEY_B64"),
          ).toString("base64"),
        }),
        { mode: 0o600 },
      );
      const manifestArchive = path.join(root, "manifest.enc"),
        sealed = await encryptFile(
          manifestPlain,
          manifestArchive,
          decode(env, "BACKUP_RECOVERY_PUBLIC_KEY_B64"),
          `${run}/${manifestId}`,
        );
      const sink = privateWorkerSink({ origin, tls: tls(env, "WRITER") });
      await phase(
        "ARTIFACT_UPLOAD",
        () => sink.put(run, id, archive, meta),
        report,
      );
      await phase(
        "MANIFEST_UPLOAD",
        () => sink.put(run, manifestId, manifestArchive, sealed),
        report,
      );
      await phase(
        "COMMIT",
        () =>
          sink.commit(run, manifestId, [
            { id, ...meta },
            { id: manifestId, ...sealed },
          ]),
        report,
      );
      console.log("HIDRIVE_SYNTHETIC_SENDER_COMPLETED");
      return;
    }
    const manifestArchive = path.join(root, "manifest.enc");
    await phase(
      "READ",
      () =>
        download(
          origin,
          `/v1/${run}/${manifestId}`,
          tls(env, "READER"),
          manifestArchive,
        ),
      report,
    );
    const archive = path.join(root, "archive"),
      restored = path.join(root, "restored");
    await download(origin, `/v1/${run}/${id}`, tls(env, "READER"), archive);
    await verifySyntheticRecovery({
      run,
      id,
      manifestId,
      manifestArchive,
      archive,
      restored,
      privateKey: decode(env, "BACKUP_RECOVERY_PRIVATE_KEY_B64"),
      signingPublicKey: decode(env, "BACKUP_SIGNING_PUBLIC_KEY_B64"),
    });
    console.log(
      "HIDRIVE_INDEPENDENT_RESTORE_VERIFIED",
      JSON.stringify({
        run,
        restoreServiceId: env.RAILWAY_SERVICE_ID,
        artificialData: true,
        signature: true,
        ciphertextSha256: true,
        aead: true,
        plaintextSha256: true,
      }),
    );
  } finally {
    clearTimeout(watchdog);
    await rm(root, { recursive: true, force: true });
  }
}
export async function verifySyntheticRecovery({
  run,
  id,
  manifestId,
  manifestArchive,
  archive,
  restored,
  privateKey,
  signingPublicKey,
}) {
  const manifestPlain = restored + ".manifest";
  try {
    await decryptFile(
      manifestArchive,
      manifestPlain,
      privateKey,
      `${run}/${manifestId}`,
    );
    const manifest = verifyManifest(
      await readFile(manifestPlain),
      signingPublicKey,
    );
    assert.equal(manifest.run, run);
    assert.equal(manifest.synthetic, true);
    assert.equal(manifest.recoveryKeyId, keyId(privateKey));
    assert.equal(manifest.signingKeyId, keyId(signingPublicKey));
    assert.equal(manifest.files.length, 1);
    assert.equal(manifest.files[0].id, id);
    assert.equal(await hashFile(archive), manifest.files[0].sha256);
    await decryptFile(archive, restored, privateKey, `${run}/${id}`);
    assert.equal(await hashFile(restored), manifest.files[0].plaintextSha256);
    assert.equal(
      await readFile(restored, "utf8"),
      `SingMotion artificial HiDrive integration\n${run}\n`,
    );
  } catch (error) {
    await rm(restored, { force: true });
    throw error;
  } finally {
    await rm(manifestPlain, { force: true });
  }
}
