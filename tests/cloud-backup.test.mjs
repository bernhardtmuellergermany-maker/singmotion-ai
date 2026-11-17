import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  generateKeyPairSync,
  X509Certificate,
  randomUUID,
  createHash,
} from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { Readable } from "node:stream";
import https from "node:https";
import {
  encryptFile,
  decryptFile,
  hashFile,
  localFiles,
  listR2,
  produceBackup,
  syntheticOnly,
  verifyManifest,
  nativePostgresDump,
  r2Source,
} from "../lib/ops/cloud-backup.mjs";
import {
  createPrivateReceiver,
  listenPrivate,
  privateWorkerSink,
  fileCiphertextSink,
} from "../lib/ops/private-backup-worker.mjs";
import { hidriveCiphertextSink } from "../lib/ops/hidrive-ciphertext-sink.mjs";
import { CreditWallet } from "../lib/commerce/credit-wallet.ts";
import { auditCreditLedger } from "../lib/commerce/credit-ledger-integrity.ts";

const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const signer = generateKeyPairSync("ed25519");
const temp = () => mkdtemp(path.join(tmpdir(), "sm-cloud-backup-"));
const sum = (value) => createHash("sha256").update(value).digest("hex");
function command(exe, args, cwd) {
  return execFileSync(exe, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  }).toString();
}
async function certificates(root) {
  command(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      "ca.key",
      "-out",
      "ca.crt",
      "-days",
      "1",
      "-subj",
      "/CN=fixture-ca",
    ],
    root,
  );
  for (const who of ["server", "client", "other"]) {
    command(
      "openssl",
      [
        "req",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        who + ".key",
        "-out",
        who + ".csr",
        "-subj",
        "/CN=" + who,
      ],
      root,
    );
    await writeFile(
      path.join(root, who + ".ext"),
      who === "server"
        ? "subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n"
        : "extendedKeyUsage=clientAuth\n",
    );
    command(
      "openssl",
      [
        "x509",
        "-req",
        "-in",
        who + ".csr",
        "-CA",
        "ca.crt",
        "-CAkey",
        "ca.key",
        "-CAcreateserial",
        "-out",
        who + ".crt",
        "-days",
        "1",
        "-extfile",
        who + ".ext",
      ],
      root,
    );
  }
  const ca = await readFile(path.join(root, "ca.crt"));
  const pair = async (who) => ({
    ca,
    key: await readFile(path.join(root, who + ".key")),
    cert: await readFile(path.join(root, who + ".crt")),
    family: 4,
  });
  return {
    server: await pair("server"),
    client: await pair("client"),
    other: await pair("other"),
  };
}
async function sourceFixture(root) {
  const source = path.join(root, "source");
  await mkdir(source, { mode: 0o700 });
  const live = new DatabaseSync(path.join(source, "commerce.sqlite"));
  live.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0");
  const wallet = new CreditWallet(live);
  const owner = "customer:synthetic-cloud-backup";
  const purchase = wallet.pending(
    {
      subject: owner,
      email: "fixture@example.invalid",
      customerId: "synthetic",
    },
    500,
    randomUUID(),
  );
  wallet.bind(
    purchase.id,
    "cs_live_syntheticoffline",
    "https://checkout.stripe.com/c/pay/offline",
  );
  wallet.settle({
    id: purchase.id,
    sessionId: "cs_live_syntheticoffline",
    amount: 500,
    currency: "eur",
    paymentStatus: "paid",
    livemode: true,
  });
  const project = randomUUID();
  wallet.reserveVideo(project, owner, 125);
  wallet.reconcileVideo(project, "completed");
  live.exec(
    "CREATE TABLE backup_fixture(value TEXT); INSERT INTO backup_fixture VALUES ('synthetic-wal-row')",
  );
  for (const name of ["demo.sqlite", "live-test.sqlite", "additional.store"]) {
    const db = new DatabaseSync(path.join(source, name));
    db.exec(
      "CREATE TABLE fixture(value TEXT); INSERT INTO fixture VALUES ('synthetic-only')",
    );
    db.close();
  }
  await mkdir(path.join(source, "cms-public"));
  await writeFile(
    path.join(source, "cms-public", "synthetic.jpg"),
    "synthetic-local-media",
  );
  return { source, live };
}
function fakeR2(count = 1001) {
  const objects = Array.from({ length: count }, (_, i) => ({
    Key: `synthetic-private/${i}.mp4`,
    Size: i ? 12 : 0,
    ETag: `"fixture-${i}"`,
  }));
  const calls = [];
  return {
    calls,
    async list(token) {
      calls.push(token);
      return token
        ? { Contents: objects.slice(1000) }
        : {
            Contents: objects.slice(0, 1000),
            IsTruncated: count > 1000,
            NextContinuationToken: count > 1000 ? "page2" : undefined,
          };
    },
    async get(key, etag) {
      const obj = objects.find((o) => o.Key === key);
      assert.equal(etag, obj.ETag);
      return {
        ETag: obj.ETag,
        ContentLength: obj.Size,
        Body: Readable.from([Buffer.alloc(obj.Size, 7)]),
      };
    },
  };
}
test("staging gate refuses production and inherited source credentials", () => {
  assert.throws(() =>
    syntheticOnly({
      RAILWAY_ENVIRONMENT_NAME: "production",
      BACKUP_DATA_CLASS: "SYNTHETIC_ONLY",
    }),
  );
  assert.throws(() =>
    syntheticOnly({
      RAILWAY_ENVIRONMENT_NAME: "staging",
      BACKUP_DATA_CLASS: "SYNTHETIC_ONLY",
      R2_ACCESS_KEY_ID: "fixture",
    }),
  );
  syntheticOnly({
    RAILWAY_ENVIRONMENT_NAME: "staging",
    BACKUP_DATA_CLASS: "SYNTHETIC_ONLY",
  });
});
test("envelope authenticates data/context; worker cannot decrypt; empty objects restore", async () => {
  const root = await temp();
  try {
    for (const content of ["", "synthetic-private-content"]) {
      const id = randomUUID(),
        src = path.join(root, id),
        enc = src + ".enc";
      await writeFile(src, content);
      await encryptFile(src, enc, rsa.publicKey, id);
      await decryptFile(enc, src + ".out", rsa.privateKey, id);
      assert.equal(await readFile(src + ".out", "utf8"), content);
      await assert.rejects(
        decryptFile(enc, src + ".bad", rsa.privateKey, "wrong"),
      );
      const bytes = await readFile(enc);
      bytes[bytes.length - 1] ^= 1;
      await writeFile(enc, bytes);
      await assert.rejects(
        decryptFile(enc, src + ".tampered", rsa.privateKey, id),
      );
      assert.ok(!(await readdir(root)).includes(id + ".tampered"));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("all local SQLite discovered, WAL not copied, symlinks rejected", async () => {
  const root = await temp(),
    f = await sourceFixture(root);
  try {
    const list = await localFiles(f.source);
    assert.equal(list.filter((x) => x.sqlite).length, 4);
    assert.ok(list.some((x) => x.name === "cms-public/synthetic.jpg"));
    assert.ok(!list.some((x) => /-(wal|shm)$/.test(x.name)));
    await symlink(
      path.join(f.source, "demo.sqlite"),
      path.join(f.source, "alias"),
    );
    await assert.rejects(localFiles(f.source), /SYMLINK/);
  } finally {
    f.live.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("R2 pagination fails closed; SDK adapter requests conditional private reads", async () => {
  const r2 = fakeR2();
  assert.equal((await listR2(r2)).length, 1001);
  await assert.rejects(
    listR2({ list: async () => ({ IsTruncated: true }) }),
    /PAGINATION/,
  );
  await assert.rejects(
    listR2({
      list: async () => ({
        Contents: [
          { Key: "a", ETag: "e", Size: 0 },
          { Key: "a", ETag: "e", Size: 0 },
        ],
      }),
    }),
    /INVALID/,
  );
  const calls = [];
  class Cmd {
    constructor(input) {
      this.input = input;
    }
  }
  const adapter = r2Source(
    { send: async (cmd) => calls.push(cmd.input) },
    "private-fixture",
    { ListObjectsV2Command: Cmd, GetObjectCommand: Cmd },
  );
  await adapter.list("next");
  await adapter.get("key", "etag");
  assert.deepEqual(calls[1], {
    Bucket: "private-fixture",
    Key: "key",
    IfMatch: "etag",
  });
});
test("native dump refuses unverified remote transport", async () => {
  await assert.rejects(
    nativePostgresDump("/tmp/never-created", {
      PGHOST: "remote",
      PGSSLMODE: "require",
    }),
    /VERIFIED_TLS/,
  );
});
test("HiDrive adapter uses ciphertext readback and final receipt without OAuth or deletes", async () => {
  const root = await temp();
  try {
    const stored = new Map(),
      calls = [];
    const session = {
      dir: "root/users/fixture/SingMotion-DR",
      async request(method, endpoint, params, body) {
        calls.push({ method, endpoint, params });
        if (method === "POST") {
          assert.equal(Object.hasOwn(params, "overwrite"), false);
          assert.ok(!stored.has(params.name));
          // The real HiDrive adapter sends a known-length Buffer. Iterating a
          // Buffer yields byte numbers, unlike iterating a Readable stream.
          if (Buffer.isBuffer(body)) stored.set(params.name, Buffer.from(body));
          else {
            const chunks = [];
            for await (const chunk of body) chunks.push(chunk);
            stored.set(params.name, Buffer.concat(chunks));
          }
          return { ok: true, status: 201 };
        }
        assert.equal(method, "GET");
        return {
          ok: true,
          body: Readable.from([stored.get(params.path.split("/").at(-1))]),
        };
      },
    };
    const sink = hidriveCiphertextSink({ session, spool: root });
    const run = randomUUID(),
      id = randomUUID(),
      bytes = Buffer.alloc(80, 9),
      meta = { bytes: bytes.length, sha256: sum(bytes) };
    await sink.putStream(run, id, Readable.from([bytes]), meta);
    await assert.rejects(sink.commit(run, id, []), /INCOMPLETE/);
    await sink.commit(run, id, [{ id, ...meta }]);
    assert.equal(stored.size, 2);
    assert.equal(calls.length, 4);
    assert.deepEqual(await readdir(path.join(root, run)), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("private worker enforces mTLS, immutable upload, hash/length and manifest completeness", async () => {
  const root = await temp();
  let server;
  try {
    const certs = await certificates(root),
      spool = path.join(root, "spool");
    await mkdir(spool, { mode: 0o700 });
    const store = fileCiphertextSink(spool);
    server = createPrivateReceiver({
      tls: certs.server,
      clientFingerprint: new X509Certificate(certs.client.cert).fingerprint256,
      sink: store,
      maxBytes: 1024,
    });
    await assert.rejects(listenPrivate(server, "0.0.0.0", 0), /PRIVATE_BIND/);
    await listenPrivate(server, "127.0.0.1", 0, true);
    const origin = `https://localhost:${server.address().port}`;
    assert.throws(
      () =>
        privateWorkerSink({
          origin: "https://public.example",
          tls: certs.client,
        }),
      /PRIVATE_DESTINATION/,
    );
    const sink = privateWorkerSink({
      origin,
      tls: certs.client,
      synthetic: true,
    });
    const other = privateWorkerSink({
      origin,
      tls: certs.other,
      synthetic: true,
    });
    const run = randomUUID(),
      id = randomUUID(),
      file = path.join(root, "ciphertext");
    await writeFile(file, "x".repeat(64));
    const meta = { bytes: 64, sha256: await hashFile(file) };
    // Network refusals intentionally expose only a fixed error message, with
    // machine-readable AUTH_REFUSED metadata for safe diagnostics.
    await assert.rejects(
      other.put(run, id, file, meta),
      (error) =>
        error?.message === "BACKUP_OPERATION_FAILED" &&
        error?.backupCode === "AUTH_REFUSED",
    );
    await assert.rejects(
      sink.put(run, id, file, { ...meta, sha256: "0".repeat(64) }),
    );
    await sink.put(run, id, file, meta);
    await assert.rejects(sink.put(run, id, file, meta));
    await assert.rejects(sink.commit(run, id, []));
    await sink.commit(run, id, [{ id, ...meta }]);
    assert.equal((await store.receipt(run)).manifestId, id);
    await assert.rejects(sink.put(run, randomUUID(), file, meta));
    await assert.rejects(
      new Promise((resolve, reject) => {
        const req = https.get(
          origin,
          { ca: certs.client.ca, family: 4 },
          resolve,
        );
        req.on("error", reject);
      }),
    );
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "staging native PG + WAL SQLite + 1001 R2 objects -> private worker -> independent restore",
  { skip: process.env.BACKUP_NATIVE_PG_TEST !== "YES", timeout: 240000 },
  async () => {
    syntheticOnly(process.env);
    const root = await temp(),
      f = await sourceFixture(root);
    let server;
    try {
      const certs = await certificates(root);
      const scratch = path.join(root, "scratch"),
        spool = path.join(root, "spool"),
        restore = path.join(root, "restore");
      for (const dir of [scratch, spool, restore])
        await mkdir(dir, { mode: 0o700 });
      const store = fileCiphertextSink(spool);
      server = createPrivateReceiver({
        tls: certs.server,
        clientFingerprint: new X509Certificate(certs.client.cert)
          .fingerprint256,
        sink: store,
      });
      await listenPrivate(server, "127.0.0.1", 0, true);
      const sink = privateWorkerSink({
        origin: `https://localhost:${server.address().port}`,
        tls: certs.client,
        synthetic: true,
      });
      const r2 = fakeR2();
      const pgEnv = {
        PGHOST: "/tmp",
        PGUSER: "fixture",
        PGDATABASE: "backup_fixture",
        BACKUP_SYNTHETIC_PG: "YES",
      };
      const result = await produceBackup({
        sourceDir: f.source,
        scratchParent: scratch,
        publicKey: rsa.publicKey,
        signingKey: signer.privateKey,
        pgEnv,
        r2,
        sink,
      });
      assert.equal(result.files, 1007);
      assert.deepEqual(await readdir(scratch), []);
      assert.deepEqual(r2.calls, [undefined, "page2", undefined, "page2"]);
      const receipt = await store.receipt(result.run);
      const manifestPath = path.join(restore, "manifest");
      await decryptFile(
        path.join(spool, result.run, receipt.manifestId),
        manifestPath,
        rsa.privateKey,
        `${result.run}/${receipt.manifestId}`,
      );
      const manifest = verifyManifest(
        await readFile(manifestPath),
        signer.publicKey,
      );
      assert.equal(manifest.run, result.run);
      assert.equal(manifest.atomicAcrossStores, false);
      for (const entry of manifest.files) {
        const ciphertext = path.join(spool, result.run, entry.id),
          target = path.join(restore, entry.id);
        assert.equal(await hashFile(ciphertext), entry.sha256);
        await decryptFile(
          ciphertext,
          target,
          rsa.privateKey,
          `${result.run}/${entry.id}`,
        );
        assert.equal(await hashFile(target), entry.plaintextSha256);
        if (entry.kind === "sqlite") {
          const db = new DatabaseSync(target, { readOnly: true });
          assert.equal(
            db.prepare("PRAGMA quick_check").get().quick_check,
            "ok",
          );
          if (entry.name === "commerce.sqlite") {
            assert.equal(auditCreditLedger(db).ok, true);
            assert.equal(
              db.prepare("SELECT value FROM backup_fixture").get().value,
              "synthetic-wal-row",
            );
          }
          db.close();
        }
        if (entry.kind === "postgres") {
          command(
            "createdb",
            ["-h", "/tmp", "-U", "fixture", "backup_restored"],
            root,
          );
          command(
            "pg_restore",
            [
              "-h",
              "/tmp",
              "-U",
              "fixture",
              "-d",
              "backup_restored",
              "--exit-on-error",
              "--no-owner",
              "--no-acl",
              target,
            ],
            root,
          );
          assert.equal(
            command(
              "psql",
              [
                "-h",
                "/tmp",
                "-U",
                "fixture",
                "-d",
                "backup_restored",
                "-Atc",
                "SELECT count(*) FROM fixture_content",
              ],
              root,
            ).trim(),
            "3",
          );
        }
        if (entry.kind === "r2")
          assert.equal(
            await hashFile(target),
            sum(Buffer.alloc(entry.name.endsWith("/0.mp4") ? 0 : 12, 7)),
          );
      }
      assert.equal(
        f.live.prepare("SELECT count(*) AS n FROM backup_fixture").get().n,
        1,
      );
      // Failure after source capture must not publish a completed archive.
      let aborted = false,
        committed = false,
        lists = 0;
      const unstable = fakeR2(1);
      const originalList = unstable.list;
      unstable.list = async (token) => {
        const page = await originalList(token);
        if (++lists > 1)
          page.Contents[0] = { ...page.Contents[0], ETag: "changed" };
        return page;
      };
      await assert.rejects(
        produceBackup({
          sourceDir: f.source,
          scratchParent: scratch,
          publicKey: rsa.publicKey,
          signingKey: signer.privateKey,
          pgEnv,
          r2: unstable,
          sink: {
            put: async () => {},
            commit: async () => {
              committed = true;
            },
            abort: async () => {
              aborted = true;
            },
          },
        }),
        /R2_SOURCE_CHANGED/,
      );
      assert.equal(aborted, true);
      assert.equal(committed, false);
      assert.deepEqual(await readdir(scratch), []);
      const signed = JSON.parse(await readFile(manifestPath));
      signed.payload += " ";
      assert.throws(
        () => verifyManifest(JSON.stringify(signed), signer.publicKey),
        /SIGNATURE/,
      );
      console.log(
        "SYNTHETIC_CLOUD_BACKUP_RESTORE_VERIFIED",
        JSON.stringify({
          sqlite: 4,
          postgres: 1,
          localMedia: 1,
          r2: 1001,
          productionData: false,
          hidriveContacted: false,
          crossServiceNetworkTested: false,
        }),
      );
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      f.live.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
