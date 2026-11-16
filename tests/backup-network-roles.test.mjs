import test from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createTestPKI } from "../scripts/backup-network-certificates.mjs";
import {
  createPrivateReceiver,
  listenPrivate,
  fileCiphertextSink,
  privateWorkerSink,
} from "../lib/ops/private-backup-worker.mjs";
import { hashFile } from "../lib/ops/cloud-backup.mjs";
test("separate read identity can only download committed ciphertext; writer cannot read", async () => {
  const pki = await createTestPKI("localhost");
  const tls = (role) => ({
    ca: Buffer.from(pki.BACKUP_TEST_CA_B64, "base64"),
    cert: Buffer.from(pki[`BACKUP_TEST_${role}_CERT_B64`], "base64"),
    key: Buffer.from(pki[`BACKUP_TEST_${role}_KEY_B64`], "base64"),
    family: 4,
  });
  const root = await mkdtemp(path.join(tmpdir(), "sm-network-roles-"));
  const store = fileCiphertextSink(root);
  const server = createPrivateReceiver({
    tls: tls("SERVER"),
    clientFingerprint: pki.BACKUP_TEST_WRITER_FP,
    readerFingerprint: pki.BACKUP_TEST_READER_FP,
    sink: store,
  });
  try {
    await listenPrivate(server, "127.0.0.1", 0, true);
    const origin = `https://localhost:${server.address().port}`;
    const run = randomUUID(),
      id = randomUUID(),
      file = path.join(root, "fixture");
    await writeFile(file, Buffer.alloc(64, 7));
    const meta = { bytes: 64, sha256: await hashFile(file) };
    const request = (role, method, url) =>
      new Promise((resolve, reject) => {
        const req = https.request(
          new URL(url, origin),
          { ...tls(role), method },
          (res) => {
            const chunks = [];
            res.on("data", (x) => chunks.push(x));
            res.on("end", () =>
              resolve({ code: res.statusCode, body: Buffer.concat(chunks) }),
            );
          },
        );
        req.on("error", reject);
        req.end();
      });
    assert.equal(
      (await request("READER", "GET", `/v1/${run}/${id}`)).code,
      404,
    );
    assert.equal(
      (await request("READER", "PUT", `/v1/${run}/${id}`)).code,
      403,
    );
    const sink = privateWorkerSink({
      origin,
      tls: tls("WRITER"),
      synthetic: true,
    });
    await sink.put(run, id, file, meta);
    await sink.commit(run, id, [{ id, ...meta }]);
    assert.equal(
      (await request("WRITER", "GET", `/v1/${run}/${id}`)).code,
      403,
    );
    assert.equal((await request("OTHER", "GET", `/v1/${run}/${id}`)).code, 403);
    assert.equal(
      (await request("READER", "GET", `/v1/${randomUUID()}/${id}`)).code,
      404,
    );
    const downloaded = await request("READER", "GET", `/v1/${run}/${id}`);
    assert.equal(downloaded.code, 200);
    assert.deepEqual(downloaded.body, await readFile(file));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
