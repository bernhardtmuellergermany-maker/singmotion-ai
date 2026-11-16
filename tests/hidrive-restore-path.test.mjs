import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import { hidriveCiphertextSink } from "../lib/ops/hidrive-ciphertext-sink.mjs";
import { encryptFile, hashFile } from "../lib/ops/cloud-backup.mjs";
import {
  validateIntegration,
  receiverEnvironment,
  verifySyntheticRecovery,
} from "../scripts/hidrive-private-integration.mjs";
test("temporary receiver mode is reversible and cannot replace OAuth credentials", () => {
  const config = {
    approved: true,
    BACKUP_RUN_ID: randomUUID(),
    BACKUP_ARTIFACT_ID: randomUUID(),
    BACKUP_MANIFEST_ID: randomUUID(),
    BACKUP_TEST_CA_B64: "fixture",
    BACKUP_TEST_SERVER_CERT_B64: "fixture",
    BACKUP_TEST_SERVER_KEY_B64: "fixture",
    BACKUP_TEST_WRITER_FP: "fixture",
    BACKUP_TEST_READER_FP: "fixture",
  };
  const base = {
    RAILWAY_SERVICE_NAME: "singmotion-backup",
    BACKUP_ENABLED: "false",
    HIDRIVE_CLIENT_SECRET: "existing-unchanged",
  };
  const mode = (value) =>
    "PRIVATE_SYNTHETIC_V1:" +
    Buffer.from(JSON.stringify(value)).toString("base64");
  const env = { ...base, BACKUP_MODE: mode(config) },
    result = receiverEnvironment(env);
  assert.equal(result.HIDRIVE_CLIENT_SECRET, base.HIDRIVE_CLIENT_SECRET);
  assert.equal(env.BACKUP_MODE, mode(config));
  assert.throws(() =>
    receiverEnvironment({
      ...base,
      BACKUP_MODE: mode({ ...config, HIDRIVE_CLIENT_SECRET: "replacement" }),
    }),
  );
  assert.throws(() =>
    receiverEnvironment({
      ...base,
      BACKUP_MODE: "SETUP_ONLY_NO_DATA_TRANSFER",
    }),
  );
});

function fakeRemote() {
  const files = new Map(),
    calls = [];
  let corrupt = false;
  return {
    files,
    calls,
    setCorrupt() {
      corrupt = true;
    },
    session: {
      dir: "root/users/fixture/SingMotion-DR",
      async request(method, endpoint, params, body) {
        calls.push({ method, endpoint, params });
        if (method === "PUT") {
          assert.equal(params.overwrite, "false");
          if (files.has(params.name)) return { ok: false };
          const chunks = [];
          for await (const chunk of body) chunks.push(chunk);
          files.set(params.name, Buffer.concat(chunks));
          return { ok: true };
        }
        assert.equal(method, "GET");
        let data = files.get(params.path.split("/").at(-1));
        if (!data) return { ok: false };
        data = Buffer.from(data);
        if (corrupt) data[0] ^= 1;
        return { ok: true, body: Readable.from([data]) };
      },
    },
  };
}
const collect = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
};
test("HiDrive read path serves fresh verified remote ciphertext only after complete commit", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sm-hidrive-read-"));
  try {
    const remote = fakeRemote(),
      sink = hidriveCiphertextSink({ session: remote.session, spool: root });
    const run = randomUUID(),
      id = randomUUID(),
      source = path.join(root, "input");
    await writeFile(source, Buffer.alloc(128, 23));
    const meta = { bytes: 128, sha256: await hashFile(source) };
    await assert.rejects(sink.readStream(run, id), /UNCOMMITTED/);
    await sink.putStream(
      run,
      id,
      Readable.from([await readFile(source)]),
      meta,
    );
    await assert.rejects(sink.readStream(run, id), /UNCOMMITTED/);
    await sink.commit(run, id, [{ id, ...meta }]);
    await rm(source);
    await rm(path.join(root, run), { recursive: true, force: true }); // no upload cache remains
    assert.deepEqual(
      await collect(await sink.readStream(run, id)),
      Buffer.alloc(128, 23),
    );
    await assert.rejects(sink.readStream(randomUUID(), id), /UNCOMMITTED/);
    await assert.rejects(sink.readStream(run, "../../state"), /UNCOMMITTED/);
    remote.setCorrupt();
    await assert.rejects(sink.readStream(run, id), /HASH_MISMATCH/);
    assert.ok(
      remote.calls.every(
        (c) => c.endpoint === "/file" && ["GET", "PUT"].includes(c.method),
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("restore verifies signed manifest, AEAD, ciphertext/plaintext hashes and exact synthetic content", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sm-hidrive-restore-"));
  try {
    const recovery = generateKeyPairSync("rsa", { modulusLength: 2048 }),
      signer = generateKeyPairSync("ed25519");
    const run = randomUUID(),
      id = randomUUID(),
      manifestId = randomUUID();
    const plain = path.join(root, "plain"),
      archive = path.join(root, "archive"),
      manifestArchive = path.join(root, "manifest.enc"),
      restored = path.join(root, "restored");
    await writeFile(
      plain,
      `SingMotion artificial HiDrive integration\n${run}\n`,
    );
    const sealed = await encryptFile(
      plain,
      archive,
      recovery.publicKey,
      `${run}/${id}`,
    );
    const payload = JSON.stringify({
      run,
      synthetic: true,
      files: [{ id, ...sealed, plaintextSha256: await hashFile(plain) }],
    });
    const signed = path.join(root, "signed");
    await writeFile(
      signed,
      JSON.stringify({
        payload,
        signature: sign(null, Buffer.from(payload), signer.privateKey).toString(
          "base64",
        ),
      }),
    );
    await encryptFile(
      signed,
      manifestArchive,
      recovery.publicKey,
      `${run}/${manifestId}`,
    );
    await rm(plain);
    await rm(signed);
    const args = {
      run,
      id,
      manifestId,
      archive,
      manifestArchive,
      restored,
      privateKey: recovery.privateKey,
      signingPublicKey: signer.publicKey,
    };
    // A separate recovery process receives only ciphertext locations, recovery
    // private key and public signing key, not plaintext or signing private key.
    const moduleURL = new URL(
      "../scripts/hidrive-private-integration.mjs",
      import.meta.url,
    ).href;
    await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--experimental-strip-types",
          "--input-type=module",
          "-e",
          `import {verifySyntheticRecovery} from ${JSON.stringify(moduleURL)};let data='';for await(const chunk of process.stdin)data+=chunk;await verifySyntheticRecovery(JSON.parse(data));`,
        ],
        {
          cwd: root,
          env: { PATH: process.env.PATH },
          stdio: ["pipe", "ignore", "pipe"],
        },
      );
      child.on("error", reject);
      child.stderr.resume();
      child.on("close", (code) =>
        code === 0 ? resolve() : reject(Error("INDEPENDENT_RESTORE_FAILED")),
      );
      child.stdin.end(
        JSON.stringify({
          ...args,
          privateKey: recovery.privateKey.export({
            type: "pkcs8",
            format: "pem",
          }),
          signingPublicKey: signer.publicKey.export({
            type: "spki",
            format: "pem",
          }),
        }),
      );
    });
    assert.equal(
      await readFile(restored, "utf8"),
      `SingMotion artificial HiDrive integration\n${run}\n`,
    );
    await rm(restored);
    await assert.rejects(
      verifySyntheticRecovery({
        ...args,
        signingPublicKey: generateKeyPairSync("ed25519").publicKey,
      }),
    );
    const corrupt = await readFile(archive);
    corrupt[corrupt.length - 1] ^= 1;
    await writeFile(archive, corrupt);
    await assert.rejects(verifySyntheticRecovery(args));
    await assert.rejects(readFile(restored));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("synthetic approval and role-specific secret custody fail closed", () => {
  const env = {
    BACKUP_DATA_CLASS: "SYNTHETIC_ONLY",
    BACKUP_SYNTHETIC_HIDRIVE_APPROVED: "YES",
    BACKUP_ENABLED: "false",
    BACKUP_INTEGRATION_ROLE: "restore",
    BACKUP_RUN_ID: randomUUID(),
    BACKUP_ARTIFACT_ID: randomUUID(),
    BACKUP_MANIFEST_ID: randomUUID(),
  };
  validateIntegration(env);
  for (const changes of [
    { BACKUP_ENABLED: "true" },
    { BACKUP_SYNTHETIC_HIDRIVE_APPROVED: "" },
    { HIDRIVE_CLIENT_SECRET: "no" },
    { DATA_DIR: "/app/.data" },
    { R2_BUCKET: "no" },
    { BACKUP_SIGNING_PRIVATE_KEY_B64: "no" },
  ])
    assert.throws(() => validateIntegration({ ...env, ...changes }));
  assert.throws(() =>
    validateIntegration({
      ...env,
      BACKUP_INTEGRATION_ROLE: "sender",
      BACKUP_RECOVERY_PRIVATE_KEY_B64: "no",
    }),
  );
});
