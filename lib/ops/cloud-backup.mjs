/** Private application-context producer. No web route, timer or startup hook.
 * The shipping runner is synthetic-only until a separately reviewed activation.
 * Worker receives ciphertext; recovery private key never belongs on either service.
 */
import { backup, DatabaseSync } from "node:sqlite";
import { constants, createReadStream, createWriteStream } from "node:fs";
import {
  lstat,
  readdir,
  realpath,
  open,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  createHash,
  randomBytes,
  randomUUID,
  publicEncrypt,
  privateDecrypt,
  createCipheriv,
  createDecipheriv,
  sign,
  verify,
} from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import path from "node:path";
import { auditCreditLedger } from "../commerce/credit-ledger-integrity.ts";

export const hashFile = async (file) => {
  const hash = createHash("sha256");
  for await (const block of createReadStream(file)) hash.update(block);
  return hash.digest("hex");
};
const fail = (code) => {
  throw new Error(code);
};
export function syntheticOnly(env) {
  if (
    env.BACKUP_DATA_CLASS !== "SYNTHETIC_ONLY" ||
    env.RAILWAY_ENVIRONMENT_NAME !== "staging"
  )
    fail("SYNTHETIC_STAGING_REQUIRED");
  // No live data paths or credentials may be inherited by the fixture runner.
  if (
    Object.keys(env).some((k) =>
      /^(HIDRIVE_|STRIPE_|BYTEPLUS_|R2_|CMS_DATABASE_URL$|DATA_DIR$)/.test(k),
    )
  )
    fail("SOURCE_CREDENTIALS_FORBIDDEN");
}
export async function encryptFile(source, target, publicKey, context) {
  const key = randomBytes(32),
    iv = randomBytes(12);
  const wrapped = publicEncrypt({ key: publicKey, oaepHash: "sha256" }, key);
  const header = Buffer.from(
    JSON.stringify({
      v: 1,
      context,
      iv: iv.toString("base64"),
      wrapped: wrapped.toString("base64"),
    }),
  );
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(header);
  const output = createWriteStream(target, { flags: "wx", mode: 0o600 });
  output.write(length);
  output.write(header);
  try {
    await pipeline(createReadStream(source), cipher, output, { end: false });
    output.end(cipher.getAuthTag());
    await new Promise((resolve, reject) => {
      output.on("finish", resolve);
      output.on("error", reject);
    });
    return {
      sha256: await hashFile(target),
      bytes: (await lstat(target)).size,
    };
  } finally {
    key.fill(0);
  }
}
export async function decryptFile(source, target, privateKey, context) {
  const fd = await open(source, "r");
  let header, tag, size, offset;
  try {
    size = (await fd.stat()).size;
    const len = Buffer.alloc(4);
    await fd.read(len, 0, 4, 0);
    const n = len.readUInt32BE();
    if (n < 20 || n > 8192 || size < n + 20) fail("INVALID_ENVELOPE");
    header = Buffer.alloc(n);
    await fd.read(header, 0, n, 4);
    tag = Buffer.alloc(16);
    await fd.read(tag, 0, 16, size - 16);
    offset = n + 4;
  } finally {
    await fd.close();
  }
  const meta = JSON.parse(header);
  if (meta.v !== 1 || meta.context !== context)
    fail("ENVELOPE_CONTEXT_MISMATCH");
  const key = privateDecrypt(
    { key: privateKey, oaepHash: "sha256" },
    Buffer.from(meta.wrapped, "base64"),
  );
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(meta.iv, "base64"),
    );
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    const input =
      size === offset + 16
        ? Readable.from([])
        : createReadStream(source, { start: offset, end: size - 17 });
    await pipeline(
      input,
      decipher,
      createWriteStream(target, { flags: "wx", mode: 0o600 }),
    );
  } catch (error) {
    await rm(target, { force: true });
    throw error;
  } finally {
    key.fill(0);
  }
}

// Enumerate every local file. DB+WAL are never copied as mutable files.
export async function localFiles(root) {
  if (
    (await realpath(root)) !== path.resolve(root) ||
    (await lstat(root)).isSymbolicLink()
  )
    fail("UNSAFE_SOURCE");
  const entries = [];
  async function walk(dir, depth) {
    if (depth > 64) fail("SOURCE_DEPTH_LIMIT");
    for (const name of (await readdir(dir)).sort()) {
      const file = path.join(dir, name),
        stat = await lstat(file);
      if (stat.isSymbolicLink()) fail("SOURCE_SYMLINK_REFUSED");
      if (stat.isDirectory()) {
        await walk(file, depth + 1);
        continue;
      }
      if (!stat.isFile() || stat.nlink !== 1 || entries.length >= 1000000)
        fail("UNSAFE_SOURCE");
      const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      const header = Buffer.alloc(16);
      try {
        await fd.read(header, 0, 16, 0);
      } finally {
        await fd.close();
      }
      entries.push({
        file,
        name: path.relative(root, file),
        sqlite: header.equals(Buffer.from("SQLite format 3\0")),
        stat,
      });
    }
  }
  await walk(root, 0);
  const databases = new Set(entries.filter((e) => e.sqlite).map((e) => e.name));
  for (const required of ["commerce.sqlite", "demo.sqlite", "live-test.sqlite"])
    if (!databases.has(required)) fail("CRITICAL_SQLITE_MISSING");
  return entries.filter((e) => {
    if (!/-(wal|shm|journal)$/.test(e.name)) return true;
    if (!databases.has(e.name.replace(/-(wal|shm|journal)$/, "")))
      fail("ORPHAN_SQLITE_COMPANION");
    return false;
  });
}
export async function listR2(source) {
  const objects = [],
    keys = new Set(),
    tokens = new Set();
  let token;
  do {
    const page = await source.list(token);
    for (const obj of page.Contents ?? []) {
      if (
        !obj.Key ||
        !obj.ETag ||
        !Number.isSafeInteger(obj.Size) ||
        obj.Size < 0 ||
        keys.has(obj.Key)
      )
        fail("INVALID_R2_LIST");
      keys.add(obj.Key);
      objects.push({ Key: obj.Key, ETag: obj.ETag, Size: obj.Size });
      if (objects.length > 1000000) fail("R2_OBJECT_LIMIT");
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
    if (page.IsTruncated && (!token || tokens.has(token)))
      fail("INCOMPLETE_R2_PAGINATION");
    if (token) tokens.add(token);
  } while (token);
  return objects.sort((a, b) => (a.Key < b.Key ? -1 : a.Key > b.Key ? 1 : 0));
}
// Never emit postgres stderr to logs. Only fixed, reviewed classifications escape
// this process; error text may contain private hostnames or authentication details.
export function classifyPgDumpFailure(stderr) {
  const detail = String(stderr).slice(0, 8192);
  if (/error while loading shared libraries|libpq\.so\.5.*cannot open shared object/i.test(detail))
    return "PG_LOADER_FAILED";
  if (/server version:.*pg_dump version:|aborting because of server version mismatch/i.test(detail))
    return "PG_VERSION_MISMATCH";
  if (/certificate verify failed|server certificate|root certificate|SSL error|SSL SYSCALL error/i.test(detail))
    return "PG_TLS_VERIFICATION_FAILED";
  if (/password authentication failed|no password supplied|fe_sendauth/i.test(detail))
    return "PG_AUTH_FAILED";
  if (/no pg_hba\.conf entry|pg_hba\.conf rejects/i.test(detail))
    return "PG_HBA_REJECTED";
  if (/permission denied|must be superuser|insufficient privilege/i.test(detail))
    return "PG_PRIVILEGE_FAILED";
  if (/invalid configuration parameter|unrecognized configuration parameter|invalid value for parameter/i.test(detail))
    return "PG_OPTIONS_REJECTED";
  if (/connection refused|timeout expired|could not translate host name|network is unreachable|could not connect to server|connection to server.*failed|server closed the connection unexpectedly/i.test(detail))
    return "PG_CONNECT_FAILED";
  return "PG_DUMP_FAILED";
}
// The runtime image intentionally ships its PG18 libpq under /usr/local/lib.
// A minimal child environment must retain this loader path, otherwise pg_dump
// fails before opening any TCP connection ("libpq.so.5" cannot be loaded).
// Never inherit unrelated process credentials or untrusted loader paths.
export function postgresDumpChildEnv(pgEnv) {
  return {
    PATH: process.env.PATH,
    ...pgEnv,
    LD_LIBRARY_PATH: "/usr/local/lib",
    PGOPTIONS:
      "-c default_transaction_read_only=on -c statement_timeout=300000",
  };
}

export async function nativePostgresDump(target, pgEnv) {
  // Credentials only in the child environment; never pass credentials via argv.
  if (
    pgEnv.PGSSLMODE !== "verify-full" &&
    !(pgEnv.PGHOST?.startsWith("/") && pgEnv.BACKUP_SYNTHETIC_PG === "YES")
  )
    fail("PG_VERIFIED_TLS_REQUIRED");
  const child = spawn(
    "pg_dump",
    ["--format=custom", "--no-owner", "--no-acl", "--lock-wait-timeout=10000"],
    {
      env: postgresDumpChildEnv(pgEnv),
      // Capture bounded stderr privately to classify errors, never print it.
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "", timedOut = false;
  child.stderr.on("data", (block) => {
    if (stderr.length < 8192) stderr += block.toString("utf8").slice(0, 8192 - stderr.length);
  });
  const done = new Promise((resolve, reject) => {
    child.on("error", () => reject(new Error("PG_SPAWN_FAILED")));
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(
        timedOut ? "PG_DUMP_TIMEOUT" : classifyPgDumpFailure(stderr)
      )),
    );
  });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, 300000);
  try {
    await Promise.all([
      done,
      pipeline(
        child.stdout,
        createWriteStream(target, { flags: "wx", mode: 0o600 }),
      ),
    ]);
  } catch (error) {
    child.kill("SIGKILL");
    await rm(target, { force: true });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Runs inside the application context that owns DATA_DIR. Sink only accepts
 * encrypted files, then a final encrypted manifest. An incomplete run never commits.
 * Per-store consistent, NOT a global cross-store recovery point. */
export function verifyManifest(encoded, signingPublicKey) {
  const envelope = JSON.parse(encoded);
  if (
    typeof envelope.payload !== "string" ||
    !verify(
      null,
      Buffer.from(envelope.payload),
      signingPublicKey,
      Buffer.from(envelope.signature, "base64"),
    )
  )
    fail("MANIFEST_SIGNATURE_INVALID");
  return JSON.parse(envelope.payload);
}
export async function produceBackup({
  sourceDir,
  scratchParent,
  publicKey,
  signingKey,
  pgEnv,
  r2,
  sink,
}) {
  const source = await realpath(sourceDir),
    parent = await realpath(scratchParent);
  const within = (a, b) => b === a || b.startsWith(a + path.sep);
  if (
    within(source, parent) ||
    within(parent, source) ||
    (await lstat(parent)).mode & 0o077
  )
    fail("PRIVATE_SEPARATE_SCRATCH_REQUIRED");
  const scratch = await mkdtemp(path.join(parent, "backup-"));
  const run = randomUUID(),
    manifest = {
      version: 1,
      run,
      startedAt: new Date().toISOString(),
      atomicAcrossStores: false,
      files: [],
    };
  let committed = false;
  async function send(plain, metadata) {
    const id = randomUUID(),
      encrypted = path.join(scratch, id + ".enc");
    const plaintextSha256 = await hashFile(plain);
    const sealed = await encryptFile(
      plain,
      encrypted,
      publicKey,
      `${run}/${id}`,
    );
    await sink.put(run, id, encrypted, sealed);
    await rm(encrypted);
    return { id, ...metadata, plaintextSha256, ...sealed };
  }
  try {
    const files = await localFiles(source);
    for (const entry of files) {
      const plain = path.join(scratch, randomUUID());
      if (entry.sqlite) {
        const db = new DatabaseSync(entry.file, { readOnly: true });
        try {
          await backup(db, plain);
        } finally {
          db.close();
        }
        const check = new DatabaseSync(plain, { readOnly: true });
        try {
          if (check.prepare("PRAGMA quick_check").get().quick_check !== "ok")
            fail("SQLITE_SNAPSHOT_INVALID");
          if (entry.name === "commerce.sqlite" && !auditCreditLedger(check).ok)
            fail("SQLITE_LEDGER_INVALID");
        } finally {
          check.close();
        }
      } else {
        const fd = await open(
          entry.file,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        try {
          const before = await fd.stat();
          if (
            before.ino !== entry.stat.ino ||
            before.dev !== entry.stat.dev ||
            before.nlink !== 1
          )
            fail("SOURCE_CHANGED");
          await pipeline(
            fd.createReadStream({ autoClose: false }),
            createWriteStream(plain, { flags: "wx", mode: 0o600 }),
          );
          const after = await fd.stat();
          if (
            before.size !== after.size ||
            before.mtimeMs !== after.mtimeMs ||
            before.ctimeMs !== after.ctimeMs
          )
            fail("SOURCE_CHANGED");
        } finally {
          await fd.close();
        }
      }
      manifest.files.push(
        await send(plain, {
          kind: entry.sqlite ? "sqlite" : "local",
          name: entry.name,
        }),
      );
      await rm(plain);
    }
    const dump = path.join(scratch, "cms.dump");
    await nativePostgresDump(dump, pgEnv);
    manifest.files.push(
      await send(dump, { kind: "postgres", name: "cms.dump" }),
    );
    await rm(dump);
    const first = await listR2(r2);
    for (const obj of first) {
      const response = await r2.get(obj.Key, obj.ETag); // adapter MUST send IfMatch
      if (response.ETag !== obj.ETag || response.ContentLength !== obj.Size)
        fail("R2_SOURCE_CHANGED");
      const plain = path.join(scratch, randomUUID());
      await pipeline(
        response.Body,
        createWriteStream(plain, { flags: "wx", mode: 0o600 }),
      );
      if ((await lstat(plain)).size !== obj.Size) fail("R2_TRUNCATED_BODY");
      manifest.files.push(
        await send(plain, { kind: "r2", name: obj.Key, etag: obj.ETag }),
      );
      await rm(plain);
    }
    if (JSON.stringify(first) !== JSON.stringify(await listR2(r2)))
      fail("R2_SOURCE_CHANGED");
    manifest.finishedAt = new Date().toISOString();
    const plain = path.join(scratch, "manifest.json");
    const payload = JSON.stringify(manifest);
    await writeFile(
      plain,
      JSON.stringify({
        payload,
        signature: sign(null, Buffer.from(payload), signingKey).toString(
          "base64",
        ),
      }),
      { flag: "wx", mode: 0o600 },
    );
    const sealedManifest = await send(plain, { kind: "manifest" });
    await sink.commit(
      run,
      sealedManifest.id,
      manifest.files
        .map(({ id, sha256, bytes }) => ({ id, sha256, bytes }))
        .concat([
          {
            id: sealedManifest.id,
            sha256: sealedManifest.sha256,
            bytes: sealedManifest.bytes,
          },
        ]),
    );
    committed = true;
    return {
      run,
      manifestId: sealedManifest.id,
      files: manifest.files.length,
      backupVerified: false,
      restoreVerified: false,
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
    if (!committed) await sink.abort?.(run);
  }
}

// Existing app's SDK client stays in the app; no R2 credentials reach the worker.
export function r2Source(
  client,
  bucket,
  { ListObjectsV2Command, GetObjectCommand },
) {
  return {
    list: (ContinuationToken) =>
      client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          MaxKeys: 1000,
          ContinuationToken,
        }),
        { abortSignal: AbortSignal.timeout(30000) },
      ),
    get: (Key, IfMatch) =>
      client.send(new GetObjectCommand({ Bucket: bucket, Key, IfMatch }), {
        abortSignal: AbortSignal.timeout(30000),
      }),
  };
}
