/** Ciphertext-only receiver for the existing backup worker. Not a public app
 * route. No automatic activation; only the synthetic staging harness starts it.
 */
import https from "node:https";
import {
  backupError,
  failureCode,
  diagnostic,
  refusal,
} from "./backup-errors.mjs";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, lstat, writeFile, readFile, rm } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHash, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { isIP } from "node:net";
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const sha = /^[a-f0-9]{64}$/;
const valid = (run, id) => uuid.test(run) && uuid.test(id);

export function createPrivateReceiver({
  tls,
  clientFingerprint,
  readerFingerprint,
  sink,
  // Exact run binding is mandatory for real Production receivers. Synthetic
  // integration can omit it, preserving the original isolated fixture path.
  allowedRun = null,
  closeAfterCommit = false,
  maxBytes = 64 * 1024 * 1024,
  maxFiles = 10000,
  report = () => {},
}) {
  if (!clientFingerprint || !tls.ca || !tls.key || !tls.cert)
    throw Error("MTLS_REQUIRED");
  if (allowedRun !== null && !uuid.test(allowedRun))
    throw Error("APPROVED_RUN_ID_INVALID");
  // One run at a time; receiver is a one-shot worker, not a general blob server.
  let activeRun,
    busy = false,
    committed = false;
  const entries = new Map();
  const server = https.createServer(
    {
      ...tls,
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: "TLSv1.3",
    },
    async (req, res) => {
      const reply = (code) => {
        res.writeHead(code, { "Cache-Control": "no-store" });
        res.end();
      };
      const fingerprint = req.socket.getPeerCertificate().fingerprint256;
      if (!req.socket.authorized) return reply(403);
      if (req.method === "GET") {
        if (!readerFingerprint || fingerprint !== readerFingerprint)
          return reply(403);
        const read = /^\/v1\/([a-f0-9-]+)\/([a-f0-9-]+)$/.exec(req.url ?? "");
        if (
          !read ||
          !valid(read[1], read[2]) ||
          !committed ||
          read[1] !== activeRun ||
          !entries.has(read[2]) ||
          !sink.readStream
        )
          return reply(404);
        try {
          const stream = await sink.readStream(read[1], read[2]);
          res.writeHead(200, {
            "Cache-Control": "no-store",
            "Content-Type": "application/octet-stream",
            "Content-Length": entries.get(read[2]).bytes,
          });
          await pipeline(stream, res);
        } catch (error) {
          report(diagnostic("READ", error));
          if (!res.headersSent) reply(422);
          else res.destroy();
        }
        return;
      }
      if (fingerprint !== clientFingerprint) return reply(403);
      const parts = /^\/v1\/([a-f0-9-]+)\/([a-f0-9-]+|commit)$/.exec(
        req.url ?? "",
      );
      if (!parts || !uuid.test(parts[1]) ||
          (allowedRun !== null && parts[1] !== allowedRun) ||
          req.method !== "PUT")
        return reply(404);
      const [, run, id] = parts;
      if (committed || busy || (activeRun && activeRun !== run))
        return reply(409);
      if (
        id !== "commit" &&
        (!valid(run, id) || entries.has(id) || entries.size >= maxFiles)
      )
        return reply(409);
      busy = true;
      activeRun = run;
      try {
        if (id === "commit") {
          const chunks = [];
          let bytes = 0;
          for await (const chunk of req) {
            bytes += chunk.length;
            if (bytes > 2 * 1024 * 1024) throw backupError("VALIDATION");
            chunks.push(chunk);
          }
          const body = JSON.parse(Buffer.concat(chunks));
          if (
            !uuid.test(body.manifestId) ||
            !Array.isArray(body.files) ||
            body.files.length !== entries.size ||
            !entries.has(body.manifestId)
          )
            throw backupError("VALIDATION");
          const seen = new Set();
          for (const entry of body.files) {
            const saved = entries.get(entry.id);
            if (
              seen.has(entry.id) ||
              !saved ||
              saved.sha256 !== entry.sha256 ||
              saved.bytes !== entry.bytes
            )
              throw backupError("VALIDATION");
            seen.add(entry.id);
          }
          await sink.commit(run, body.manifestId, body.files);
          committed = true;
          if (closeAfterCommit) {
            // Finish the success reply before terminating this weekly cron job.
            res.once("finish", () => {
              server.closeAllConnections();
              server.close();
            });
          }
          reply(201);
        } else {
          const bytes = Number(req.headers["content-length"]),
            digest = req.headers["x-content-sha256"];
          if (
            !Number.isSafeInteger(bytes) ||
            bytes < 20 ||
            bytes > maxBytes ||
            !sha.test(digest)
          )
            throw backupError("VALIDATION");
          await sink.putStream(run, id, req, { bytes, sha256: digest });
          entries.set(id, { bytes, sha256: digest });
          reply(201);
        }
      } catch (error) {
        report(
          diagnostic(id === "commit" ? "COMMIT" : "ARTIFACT_UPLOAD", error),
        );
        reply(422);
      } finally {
        busy = false;
      }
    },
  );
  server.on("tlsClientError", (error) => report(diagnostic("SESSION", error)));
  server.requestTimeout = 60000;
  server.headersTimeout = 10000;
  return server;
}
export function isPrivateNetworkAddress(host) {
  if (isIP(host) === 6) return /^f[cd][0-9a-f]{2}:/i.test(host);
  if (isIP(host) !== 4) return false;
  const [a, b] = host.split(".").map(Number);
  return (
    a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  );
}
export async function listenPrivate(server, host, port, synthetic = false) {
  // Never bind 0.0.0.0/:: or expose this port with a Railway public domain/proxy.
  if (!isPrivateNetworkAddress(host) && !(synthetic && host === "127.0.0.1"))
    throw Error("PRIVATE_BIND_REQUIRED");
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
}
export function privateWorkerSink({ origin, tls, synthetic = false }) {
  const url = new URL(origin);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (!url.hostname.endsWith(".railway.internal") &&
      !(synthetic && url.hostname === "localhost"))
  )
    throw Error("PRIVATE_DESTINATION_REQUIRED");
  if (!tls.ca || !tls.cert || !tls.key) throw Error("MTLS_REQUIRED");
  async function request(route, body, headers) {
    await new Promise((resolve, reject) => {
      const req = https.request(
        new URL(route, origin),
        {
          ...tls,
          rejectUnauthorized: true,
          minVersion: "TLSv1.3",
          method: "PUT",
          headers,
          timeout: 60000,
        },
        (res) => {
          res.resume();
          if (res.statusCode !== 201) reject(refusal(res.statusCode));
          else resolve();
        },
      );
      req.on("timeout", () => req.destroy(backupError("TIMEOUT")));
      req.on("error", (error) =>
        reject(
          backupError(
            failureCode(error) === "UNKNOWN" ? "TRANSPORT" : failureCode(error),
          ),
        ),
      );
      if (typeof body === "string") req.end(body);
      else {
        body.once("error", () => reject(backupError("LOCAL_STREAM")));
        pipeline(body, req).catch(() => reject(backupError("LOCAL_STREAM")));
      }
    });
  }
  return {
    async put(run, id, file, meta) {
      if (!valid(run, id)) throw Error("INVALID_ARCHIVE_ID");
      await request(`/v1/${run}/${id}`, createReadStream(file), {
        "content-length": meta.bytes,
        "x-content-sha256": meta.sha256,
      });
    },
    /** Bounded encrypted segment directly to private mTLS receiver. The
     * producer supplies ONLY ciphertext, known exact length and SHA-256.
     * Receiver authenticates writer and re-checks exact length/hash before
     * ACK. The recovery private key is never present on sender/receiver. */
    async putStream(run, id, ciphertextStream, meta) {
      const maxCiphertextBytes = 8 * 1024 * 1024 + 8192 + 20;
      if (
        !valid(run, id) ||
        typeof ciphertextStream?.pipe !== "function" ||
        !Number.isSafeInteger(meta?.bytes) ||
        meta.bytes < 40 ||
        meta.bytes > maxCiphertextBytes ||
        !sha.test(meta.sha256)
      )
        throw Error("INVALID_ENCRYPTED_SEGMENT");
      await request(`/v1/${run}/${id}`, ciphertextStream, {
        "content-length": meta.bytes,
        "x-content-sha256": meta.sha256,
      });
    },
    async commit(run, manifestId, files) {
      if (!valid(run, manifestId)) throw Error("INVALID_ARCHIVE_ID");
      const body = JSON.stringify({ manifestId, files });
      await request(`/v1/${run}/commit`, body, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      });
    },
  };
}

// Synthetic storage and worker spool: ciphertext only; exclusive names; no
// arbitrary paths, overwrite, public sharing, or customer filenames.
export function fileCiphertextSink(root, maxBytes = 64 * 1024 * 1024) {
  return {
    async putStream(run, id, stream, meta) {
      if (!valid(run, id)) throw Error("INVALID_ARCHIVE_ID");
      const st = await lstat(root);
      if (!st.isDirectory() || st.isSymbolicLink() || st.mode & 0o077)
        throw Error("PRIVATE_SPOOL_REQUIRED");
      const dir = path.join(root, run);
      await mkdir(dir, { mode: 0o700 }).catch((error) => {
        if (error.code !== "EEXIST") throw error;
      });
      const dirInfo = await lstat(dir);
      if (
        !dirInfo.isDirectory() ||
        dirInfo.isSymbolicLink() ||
        dirInfo.mode & 0o077
      )
        throw Error("PRIVATE_SPOOL_REQUIRED");
      const target = path.join(dir, id),
        hash = createHash("sha256");
      let bytes = 0,
        created = false;
      const counter = new Transform({
        transform(chunk, encoding, callback) {
          bytes += chunk.length;
          if (bytes > maxBytes || bytes > meta.bytes)
            return callback(new Error("ARCHIVE_SIZE_LIMIT"));
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      const out = createWriteStream(target, { flags: "wx", mode: 0o600 });
      out.on("open", () => {
        created = true;
      });
      try {
        await pipeline(stream, counter, out);
        if (
          bytes !== meta.bytes ||
          !sha.test(meta.sha256) ||
          !timingSafeEqual(
            Buffer.from(hash.digest("hex")),
            Buffer.from(meta.sha256),
          )
        )
          throw Error("ARCHIVE_HASH_MISMATCH");
      } catch (error) {
        if (created) await rm(target, { force: true });
        throw error;
      }
    },
    async commit(run, manifestId, files) {
      if (!valid(run, manifestId)) throw Error("INVALID_ARCHIVE_ID");
      await writeFile(
        path.join(root, run, "COMMITTED.json"),
        JSON.stringify({ manifestId, files }),
        { flag: "wx", mode: 0o600 },
      );
    },
    async receipt(run) {
      if (!uuid.test(run)) throw Error("INVALID_ARCHIVE_ID");
      return JSON.parse(await readFile(path.join(root, run, "COMMITTED.json")));
    },
    async readStream(run, id) {
      if (!valid(run, id)) throw Error("INVALID_ARCHIVE_ID");
      const receipt = await this.receipt(run);
      if (!receipt.files.some((file) => file.id === id))
        throw Error("UNCOMMITTED_ARCHIVE");
      return createReadStream(path.join(root, run, id));
    },
  };
}
