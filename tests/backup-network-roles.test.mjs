import test from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, randomBytes, generateKeyPairSync } from "node:crypto";
import { Readable } from "node:stream";
import { mkdir, stat } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { CreditWallet } from "../lib/commerce/credit-wallet.ts";
import { auditCreditLedger } from "../lib/commerce/credit-ledger-integrity.ts";
import { produceMultiStoreArchive, restoreMultiStoreArchive } from "../lib/ops/multistore-segmented-backup.mjs";
import { createTestPKI } from "../scripts/backup-network-certificates.mjs";
import {
  createPrivateReceiver,
  listenPrivate,
  isPrivateNetworkAddress,
  fileCiphertextSink,
  privateWorkerSink,
} from "../lib/ops/private-backup-worker.mjs";
import { hashFile } from "../lib/ops/cloud-backup.mjs";
test("only valid private unicast addresses are accepted for live binding", () => {
  for (const address of [
    "10.0.0.1",
    "172.16.1.2",
    "172.31.255.254",
    "192.168.1.2",
    "fd12:3456::1",
  ])
    assert.equal(isPrivateNetworkAddress(address), true);
  for (const address of [
    "0.0.0.0",
    "::",
    "127.0.0.1",
    "172.32.0.1",
    "8.8.8.8",
    "10.999.0.1",
    "fdxx::1",
    "::ffff:8.8.8.8",
  ])
    assert.equal(isPrivateNetworkAddress(address), false);
});
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

test("complete encrypted SQLite/Postgres/R2 archive crosses mutually-authenticated private streaming transport and restores without sender", async () => {
  const pki = await createTestPKI("localhost");
  const tls = (role) => ({
    ca: Buffer.from(pki.BACKUP_TEST_CA_B64, "base64"),
    cert: Buffer.from(pki["BACKUP_TEST_"+role+"_CERT_B64"], "base64"),
    key: Buffer.from(pki["BACKUP_TEST_"+role+"_KEY_B64"], "base64"),
    family: 4,
  });
  const recovery = generateKeyPairSync("rsa",{modulusLength:3072});
  const signing = generateKeyPairSync("ed25519");
  const root = await mkdtemp(path.join(tmpdir(),"sm-full-private-mtls-"));
  const sources = path.join(root,"source"),scratch=path.join(root,"scratch");
  const spool = path.join(root,"ciphertext"),recoveryRoot=path.join(root,"recovery");
  for(const dir of [sources,scratch,spool,recoveryRoot]) await mkdir(dir,{mode:0o700});
  const db = new DatabaseSync(path.join(sources,"commerce.sqlite"));
  db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0");
  const wallet = new CreditWallet(db);
  const owner = "customer:synthetic-mtls";
  const purchase = wallet.pending({subject:owner,email:"test@example.invalid",customerId:"test"},500,randomUUID());
  wallet.bind(purchase.id,"cs_live_mtls_fixture","https://checkout.stripe.com/c/pay/offline");
  wallet.settle({id:purchase.id,sessionId:"cs_live_mtls_fixture",amount:500,currency:"eur",paymentStatus:"paid",livemode:true});
  for(const name of ["demo.sqlite","live-test.sqlite"]) {
    const aux = new DatabaseSync(path.join(sources,name));
    aux.exec("CREATE TABLE fixtures(id INTEGER PRIMARY KEY); INSERT INTO fixtures VALUES(1)");
    aux.close();
  }
  await writeFile(path.join(sources,"large.bin"),randomBytes(9*1024*1024+9));
  const receiver = fileCiphertextSink(spool);
  const server = createPrivateReceiver({
    tls:tls("SERVER"),
    clientFingerprint:pki.BACKUP_TEST_WRITER_FP,
    readerFingerprint:pki.BACKUP_TEST_READER_FP,
    sink:receiver,
  });
  try {
    await listenPrivate(server,"127.0.0.1",0,true);
    const writer=privateWorkerSink({
      origin:"https://localhost:"+server.address().port,
      tls:tls("WRITER"),synthetic:true,
    });
    await assert.rejects(writer.putStream(randomUUID(),"../../state",Readable.from([Buffer.from("x")]),{
      bytes:50,sha256:"0".repeat(64),
    }),/INVALID_ENCRYPTED_SEGMENT/);
    const r2 = {
      async list() {return {Contents:[
        {Key:"private/example.mp4",ETag:'"fixture-etag"',Size:160},
        {Key:"private/zero.mp4",ETag:'"empty"',Size:0},
      ]};},
      async get(key,tag) {
        assert.ok(key.startsWith("private/"));
        return {ETag:tag,ContentLength:key.endsWith("zero.mp4")?0:160,
          Body:Readable.from([Buffer.alloc(key.endsWith("zero.mp4")?0:160,5)])};
      },
    };
    const result=await produceMultiStoreArchive({
      sourceDir:sources,scratchParent:scratch,
      pgEnv:{test:true},
      pgDump:async target=>writeFile(target,"PGDMP_MTLS_SYNTHETIC",{flag:"wx",mode:0o600}),
      r2,sink:writer,
      recoveryPublicKey:recovery.publicKey,
      signingPrivateKey:signing.privateKey,
      segmentBytes:1024*1024,
    });
    assert.equal(result.remoteReceiptCommitted,true);
    assert.equal(result.independentRestoreVerified,false);
    assert.ok(result.segments>9);
    assert.equal(result.stores.sqlite,3);
    assert.equal(result.stores.postgres,1);
    assert.equal(result.stores.r2,2);
    assert.equal((await stat(path.join(spool,result.run,"COMMITTED.json"))).isFile(),true);
    // The network receiver and writer are gone: the restored archive is
    // verified exclusively against the immutable committed ciphertext spool.
    await new Promise((resolve)=>server.close(resolve));
    const independentReader=fileCiphertextSink(spool);
    const target=path.join(recoveryRoot,"isolated");
    const restored=await restoreMultiStoreArchive({
      sink:independentReader,run:result.run,
      manifestId:result.manifestId,manifestMeta:result.manifestMeta,
      recoveryPrivateKey:recovery.privateKey,
      signingPublicKey:signing.publicKey,targetDir:target,
    });
    assert.equal(restored.recovered,true);
    const check = new DatabaseSync(path.join(target,"sqlite","commerce.sqlite"),{readOnly:true});
    try {assert.equal(auditCreditLedger(check).ok,true);} finally {check.close();}
    assert.deepEqual(await readFile(path.join(target,"local","large.bin")),
      await readFile(path.join(sources,"large.bin")));
    assert.equal(await readFile(path.join(target,"postgres","cms.dump"),"utf8"),
      "PGDMP_MTLS_SYNTHETIC");
    assert.equal((await readFile(path.join(target,"r2","private","zero.mp4"))).length,0);
  } finally {
    db.close();
    if(server.listening) await new Promise(resolve=>server.close(resolve));
    await rm(root,{recursive:true,force:true});
  }
});
