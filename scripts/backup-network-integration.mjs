/** One-shot two-service STAGING integration, no customer/storage credentials. */
import assert from "node:assert/strict";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import {
  createPrivateReceiver,
  listenPrivate,
  isPrivateNetworkAddress,
  fileCiphertextSink,
  privateWorkerSink,
} from "../lib/ops/private-backup-worker.mjs";
import {
  encryptFile,
  decryptFile,
  hashFile,
  syntheticOnly,
} from "../lib/ops/cloud-backup.mjs";

const env = process.env;
const tls = (role) => ({
  ca: Buffer.from(env.BACKUP_TEST_CA_B64, "base64"),
  cert: Buffer.from(env[`BACKUP_TEST_${role}_CERT_B64`], "base64"),
  key: Buffer.from(env[`BACKUP_TEST_${role}_KEY_B64`], "base64"),
});
function probe(origin, config, route = "/probe", method = "GET") {
  return new Promise((resolve, reject) => {
    const req = https.request(
      new URL(route, origin),
      {
        ...config,
        method,
        rejectUnauthorized: true,
        minVersion: "TLSv1.3",
        timeout: 5000,
      },
      (res) => {
        res.resume();
        resolve({
          status: res.statusCode,
          authorized: req.socket.authorized,
          protocol: req.socket.getProtocol(),
          peer: req.socket.remoteAddress,
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(Error("TIMEOUT")));
    req.end();
  });
}
async function main() {
  syntheticOnly(env);
  const role = env.BACKUP_TEST_ROLE;
  assert.ok(["receiver", "sender"].includes(role));
  const root = await mkdtemp(path.join(tmpdir(), "backup-network-"));
  if (role === "receiver") {
    const domain = env.RAILWAY_PRIVATE_DOMAIN;
    assert.ok(domain?.endsWith(".railway.internal"));
    let address;
    for (let i = 0; i < 90; i++) {
      try {
        const records = await lookup(domain, { all: true });
        address = records.find((record) =>
          isPrivateNetworkAddress(record.address),
        )?.address;
        if (address) break;
      } catch {
        /* Railway private DNS may not be ready at container startup. */
      }
      await delay(1000);
    }
    if (!address)
      throw Object.assign(Error("PRIVATE_DNS_NOT_READY"), {
        code: "PRIVATE_DNS_NOT_READY",
      });
    const store = fileCiphertextSink(root, 1024 * 1024);
    let cleanupTimer;
    const server = createPrivateReceiver({
      tls: tls("SERVER"),
      clientFingerprint: env.BACKUP_TEST_WRITER_FP,
      readerFingerprint: env.BACKUP_TEST_READER_FP,
      maxBytes: 1024 * 1024,
      maxFiles: 4,
      sink: {
        ...store,
        async commit(...args) {
          await store.commit(...args);
          console.log(
            "BACKUP_PRIVATE_RECEIVER_COMMITTED",
            JSON.stringify({
              serviceId: env.RAILWAY_SERVICE_ID,
              synthetic: true,
              files: args[2].length,
            }),
          );
          cleanupTimer = setTimeout(() => server.close(), 90000);
        },
        readStream: (...args) => store.readStream(...args),
      },
    });
    const deadline = setTimeout(
      () => {
        process.exitCode = 1;
        server.closeAllConnections();
        server.close();
      },
      15 * 60 * 1000,
    );
    await listenPrivate(server, address, 8443);
    console.log(
      "BACKUP_PRIVATE_RECEIVER_READY",
      JSON.stringify({
        serviceId: env.RAILWAY_SERVICE_ID,
        privateAddress: true,
        addressFamily: address.includes(":") ? 6 : 4,
        mtls: true,
      }),
    );
    await new Promise((resolve) => server.once("close", resolve));
    clearTimeout(deadline);
    clearTimeout(cleanupTimer);
    await rm(root, { recursive: true, force: true });
    return;
  }
  try {
    const origin = env.BACKUP_TEST_ORIGIN;
    assert.ok(new URL(origin).hostname.endsWith(".railway.internal"));
    const writer = tls("WRITER"),
      reader = tls("READER"),
      other = tls("OTHER");
    let connection;
    for (let i = 0; i < 90; i++) {
      try {
        connection = await probe(origin, writer, "/probe", "PUT");
        break;
      } catch {
        if (i === 89) throw Error("PRIVATE_RECEIVER_NOT_READY");
        await delay(2000);
      }
    }
    assert.equal(connection.status, 404);
    assert.equal(connection.authorized, true);
    assert.equal(connection.protocol, "TLSv1.3");
    assert.ok(isPrivateNetworkAddress(connection.peer));
    // Exercise certificate chain, SAN and exact client identity over the real network.
    await assert.rejects(probe(origin, { ca: writer.ca }));
    await assert.rejects(
      probe(origin, {
        ...writer,
        ca: Buffer.from(env.BACKUP_TEST_WRONG_CA_B64, "base64"),
      }),
    );
    await assert.rejects(
      probe(origin, { ...writer, servername: "wrong.railway.internal" }),
      { code: "ERR_TLS_CERT_ALTNAME_INVALID" },
    );
    assert.equal((await probe(origin, other, "/probe", "PUT")).status, 403);
    assert.equal((await probe(origin, reader, "/probe", "PUT")).status, 403);
    const sink = privateWorkerSink({ origin, tls: writer });
    const run = randomUUID(),
      id = randomUUID();
    const source = path.join(root, "synthetic"),
      archive = path.join(root, "archive");
    const recovery = generateKeyPairSync("rsa", { modulusLength: 2048 });
    await writeFile(
      source,
      "SingMotion independent private network fixture\n" + run,
      { mode: 0o600 },
    );
    const plainHash = await hashFile(source);
    const meta = await encryptFile(
      source,
      archive,
      recovery.publicKey,
      `${run}/${id}`,
    );
    assert.equal((await probe(origin, reader, `/v1/${run}/${id}`)).status, 404);
    await sink.put(run, id, archive, meta);
    await sink.commit(run, id, [{ id, ...meta }]);
    assert.equal((await probe(origin, writer, `/v1/${run}/${id}`)).status, 403);
    // Discard local source and ciphertext, then restore only downloaded bytes.
    await rm(source);
    await rm(archive);
    await new Promise((resolve, reject) => {
      const req = https.get(
        new URL(`/v1/${run}/${id}`, origin),
        {
          ...reader,
          rejectUnauthorized: true,
          minVersion: "TLSv1.3",
          timeout: 10000,
        },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            reject(Error("DOWNLOAD_REFUSED"));
            return;
          }
          pipeline(
            res,
            createWriteStream(archive, { flags: "wx", mode: 0o600 }),
          ).then(resolve, reject);
        },
      );
      req.on("error", reject);
      req.on("timeout", () => req.destroy(Error("TIMEOUT")));
    });
    assert.equal(await hashFile(archive), meta.sha256);
    await decryptFile(archive, source, recovery.privateKey, `${run}/${id}`);
    assert.equal(await hashFile(source), plainHash);
    assert.ok(
      (await readFile(source, "utf8")).startsWith("SingMotion independent"),
    );
    console.log(
      "BACKUP_TWO_SERVICE_MTLS_VERIFIED",
      JSON.stringify({
        senderServiceId: env.RAILWAY_SERVICE_ID,
        receiverServiceId: env.BACKUP_TEST_RECEIVER_ID,
        tls: "TLSv1.3",
        privateAddress: true,
        addressFamily: connection.peer.includes(":") ? 6 : 4,
        missingCertificateDenied: true,
        wrongCADenied: true,
        wrongHostnameDenied: true,
        unpinnedClientDenied: true,
        readerWriteDenied: true,
        writerReadDenied: true,
        encryptedUpload: true,
        downloadedCiphertextHash: true,
        independentDownloadedRestore: true,
        customerData: false,
        hidriveContacted: false,
        r2Contacted: false,
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(
    "BACKUP_NETWORK_INTEGRATION_FAILED",
    error.code ?? "ASSERTION_OR_RUNTIME_FAILURE",
  );
  process.exitCode = 1;
});
