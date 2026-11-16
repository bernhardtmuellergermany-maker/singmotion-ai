/** Ciphertext-only receiver for the existing backup worker. Not a public app
 * route. No automatic activation; only the synthetic staging harness starts it.
 */
import https from "node:https";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, lstat, writeFile, readFile, rm } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHash, timingSafeEqual } from "node:crypto";
import path from "node:path";
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const sha = /^[a-f0-9]{64}$/;
const valid = (run, id) => uuid.test(run) && uuid.test(id);

export function createPrivateReceiver({
  tls,
  clientFingerprint,
  sink,
  maxBytes = 64 * 1024 * 1024,
  maxFiles = 10000,
}) {
  if (!clientFingerprint || !tls.ca || !tls.key || !tls.cert)
    throw Error("MTLS_REQUIRED");
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
      if (
        !req.socket.authorized ||
        req.socket.getPeerCertificate().fingerprint256 !== clientFingerprint
      )
        return reply(403);
      const parts = /^\/v1\/([a-f0-9-]+)\/([a-f0-9-]+|commit)$/.exec(
        req.url ?? "",
      );
      if (!parts || !uuid.test(parts[1]) || req.method !== "PUT")
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
            if (bytes > 2 * 1024 * 1024) throw Error();
            chunks.push(chunk);
          }
          const body = JSON.parse(Buffer.concat(chunks));
          if (
            !uuid.test(body.manifestId) ||
            !Array.isArray(body.files) ||
            body.files.length !== entries.size ||
            !entries.has(body.manifestId)
          )
            throw Error();
          const seen = new Set();
          for (const entry of body.files) {
            const saved = entries.get(entry.id);
            if (
              seen.has(entry.id) ||
              !saved ||
              saved.sha256 !== entry.sha256 ||
              saved.bytes !== entry.bytes
            )
              throw Error();
            seen.add(entry.id);
          }
          await sink.commit(run, body.manifestId, body.files);
          committed = true;
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
            throw Error();
          await sink.putStream(run, id, req, { bytes, sha256: digest });
          entries.set(id, { bytes, sha256: digest });
          reply(201);
        }
      } catch {
        reply(422);
      } finally {
        busy = false;
      }
    },
  );
  server.requestTimeout = 60000;
  server.headersTimeout = 10000;
  return server;
}
export async function listenPrivate(server, host, port, synthetic = false) {
  // Never bind 0.0.0.0/:: or expose this port with a Railway public domain/proxy.
  if (!/^f[cd][0-9a-f]{2}:/i.test(host) && !(synthetic && host === "127.0.0.1"))
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
          if (res.statusCode !== 201)
            reject(new Error("PRIVATE_RECEIVER_REFUSED"));
          else resolve();
        },
      );
      req.on("timeout", () =>
        req.destroy(new Error("PRIVATE_RECEIVER_TIMEOUT")),
      );
      req.on("error", () => reject(new Error("PRIVATE_RECEIVER_UNREACHABLE")));
      if (typeof body === "string") req.end(body);
      else
        pipeline(body, req).catch(() =>
          reject(new Error("PRIVATE_UPLOAD_FAILED")),
        );
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
  };
}
