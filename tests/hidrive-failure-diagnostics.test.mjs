import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { hidriveRequest } from "../scripts/hidrive-backup-worker.mjs";
import { hidriveCiphertextSink } from "../lib/ops/hidrive-ciphertext-sink.mjs";
import {
  diagnostic,
  phase,
  refusal,
  backupError,
} from "../lib/ops/backup-errors.mjs";
const run = "be7fc257-d46d-49d9-92cd-f9cfd85da03e",
  id = "eaf749d6-2f2a-4bc6-b1dc-1d3189d6013b";
const bytes = Buffer.from(
  "only synthetic ciphertext bytes for contract testing",
);
const meta = {
  bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
};

test("real adapter HTTP construction: PUT, encoded query, bearer, fixed byte length, redirects refused", async () => {
  let called = false;
  await hidriveRequest(
    "fake-token",
    "POST",
    "/file",
    {
      dir: "/users/artificial/private folder",
      name: "fixture.enc",
    },
    bytes,
    async (url, options) => {
      called = true;
      assert.equal(url.origin, "https://api.hidrive.strato.com");
      assert.equal(url.pathname, "/2.1/file");
      assert.equal(url.searchParams.has("overwrite"), false);
      assert.equal(
        url.searchParams.get("dir"),
        "/users/artificial/private folder",
      );
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer fake-token");
      assert.equal(options.headers["Content-Length"], String(bytes.length));
      assert.equal(options.headers["Content-Type"], "application/octet-stream");
      assert.equal(options.duplex, undefined);
      assert.equal(options.redirect, "error");
      assert.equal(options.body, bytes);
      return new Response("", { status: 201 });
    },
  );
  assert.ok(called);
});

test("upload denial and readback denial have separate safe phases; no commit or cache fallback", async () => {
  for (const deniedStage of ["put", "readback"]) {
    const root = await mkdtemp(path.join(tmpdir(), "sm-errors-"));
    const logs = [],
      calls = [];
    try {
      const sink = hidriveCiphertextSink({
        spool: root,
        report: (c) => logs.push(c),
        session: {
          dir: "/private",
          request: async (method, endpoint, query, body) => {
            calls.push(method);
            if (method === "POST") {
              assert.ok(Buffer.isBuffer(body));
              assert.deepEqual(body, bytes);
              return new Response("", {
                status: deniedStage === "put" ? 411 : 201,
              });
            }
            return new Response("SECRET RESPONSE MUST NOT BE LOGGED", {
              status: 403,
            });
          },
        },
      });
      await assert.rejects(sink.putStream(run, id, Readable.from(bytes), meta));
      assert.deepEqual(logs, [
        deniedStage === "put"
          ? "BACKUP_HIDRIVE_CREATE_HTTP_411"
          : "BACKUP_HIDRIVE_READBACK_HTTP_403",
      ]);
      assert.deepEqual(calls, deniedStage === "put" ? ["POST"] : ["POST", "GET"]);
      await assert.rejects(sink.readStream(run, id));
      await assert.rejects(sink.commit(run, id, [{ id, ...meta }]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("receiver refusal statuses and transport TLS errors remain distinct without raw strings", async () => {
  for (const [status, code] of [
    [403, "AUTH_REFUSED"],
    [404, "NOT_FOUND"],
    [409, "CONFLICT"],
    [422, "RECEIVER_REJECTED"],
    [500, "REMOTE_HTTP"],
  ])
    assert.equal(
      diagnostic("ARTIFACT_UPLOAD", refusal(status)),
      `BACKUP_ARTIFACT_UPLOAD_${code}`,
    );
  assert.equal(
    diagnostic("ARTIFACT_UPLOAD", {
      code: "ERR_TLS_CERT_ALTNAME_INVALID",
      message: "secret host",
    }),
    "BACKUP_ARTIFACT_UPLOAD_TLS_HOSTNAME",
  );
  assert.equal(
    diagnostic("ARTIFACT_UPLOAD", { code: "CERT_HAS_EXPIRED" }),
    "BACKUP_ARTIFACT_UPLOAD_TLS_CERTIFICATE",
  );
  assert.equal(
    diagnostic("COMMIT", backupError("TIMEOUT")),
    "BACKUP_COMMIT_TIMEOUT",
  );
  const logs = [];
  await assert.rejects(
    phase(
      "SECRET_PHASE",
      async () => {
        throw Object.assign(Error("/secret/path token cert"), {
          backupCode: "PRIVATE_SECRET",
        });
      },
      (x) => logs.push(x),
    ),
  );
  assert.deepEqual(logs, ["BACKUP_PREPARE_UNKNOWN"]);
});

test("actual private receiver returns 422 for storage rejection and client preserves rejection code", async () => {
  const { createTestPKI } =
    await import("../scripts/backup-network-certificates.mjs");
  const { createPrivateReceiver, listenPrivate, privateWorkerSink } =
    await import("../lib/ops/private-backup-worker.mjs");
  const { writeFile } = await import("node:fs/promises");
  const pki = await createTestPKI("localhost"),
    decode = (k) => Buffer.from(pki[k], "base64");
  const root = await mkdtemp(path.join(tmpdir(), "sm-rejection-")),
    logs = [];
  const server = createPrivateReceiver({
    tls: {
      ca: decode("BACKUP_TEST_CA_B64"),
      cert: decode("BACKUP_TEST_SERVER_CERT_B64"),
      key: decode("BACKUP_TEST_SERVER_KEY_B64"),
    },
    clientFingerprint: pki.BACKUP_TEST_WRITER_FP,
    report: (c) => logs.push(c),
    sink: {
      putStream: async (_r, _i, stream) => {
        for await (const chunk of stream) void chunk;
        throw backupError("HTTP_411");
      },
    },
  });
  try {
    await listenPrivate(server, "127.0.0.1", 0, true);
    const file = path.join(root, "fixture");
    await writeFile(file, bytes);
    const client = privateWorkerSink({
      origin: `https://localhost:${server.address().port}`,
      synthetic: true,
      tls: {
        family: 4,
        ca: decode("BACKUP_TEST_CA_B64"),
        cert: decode("BACKUP_TEST_WRITER_CERT_B64"),
        key: decode("BACKUP_TEST_WRITER_KEY_B64"),
      },
    });
    await assert.rejects(
      client.put(run, id, file, meta),
      (e) => e.backupCode === "RECEIVER_REJECTED",
    );
    assert.deepEqual(logs, ["BACKUP_ARTIFACT_UPLOAD_HTTP_411"]);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("corrupt or oversized readback never commits; failed transport never reads back", async () => {
  for (const mode of ["corrupt", "oversized", "transport"]) {
    const root = await mkdtemp(path.join(tmpdir(), "sm-readback-errors-"));
    let reads = 0;
    try {
      const sink = hidriveCiphertextSink({
        spool: root,
        session: {
          dir: "/private",
          request: async (method) => {
            if (method === "POST") {
              if (mode === "transport") throw Error("HIDRIVE_API_UNREACHABLE");
              return new Response("", { status: 201 });
            }
            reads++;
            return new Response(
              mode === "oversized"
                ? Buffer.alloc(bytes.length + 1)
                : Buffer.alloc(bytes.length),
              { status: 200 },
            );
          },
        },
      });
      await assert.rejects(
        sink.putStream(run, id, Readable.from(bytes), meta),
        (e) =>
          mode === "transport" ||
          e.backupCode === (mode === "corrupt" ? "INTEGRITY" : "SIZE"),
      );
      assert.equal(reads, mode === "transport" ? 0 : 1);
      await assert.rejects(sink.commit(run, id, [{ id, ...meta }]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});
