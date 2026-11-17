/** Adapter for the existing worker's OAuth session. No login, token exposure,
 * delete, sharing, or overwrite. Not started by the existing worker entrypoint.
 * bounded ciphertext spool must be separate from the /state OAuth volume.
 */
import { createReadStream, createWriteStream } from "node:fs";
import { rm, writeFile, readFile, mkdtemp, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileCiphertextSink } from "./private-backup-worker.mjs";
import { backupError, phase, remoteHttp } from "./backup-errors.mjs";
// Receiver stays ciphertext-only: do not import the app's SQLite/PG/R2 stack.
async function hashFile(file) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}

export function hidriveCiphertextSink({
  session,
  report = () => {},
  spool,
  maxBytes = 64 * 1024 * 1024,
}) {
  async function request(stage, ...args) {
    return phase(
      stage,
      async () => {
        const response = await session.request(...args);
        if (!response.ok) throw remoteHttp(response.status);
        return response;
      },
      report,
    );
  }
  const local = fileCiphertextSink(spool, maxBytes);
  const verified = new Map();
  let activeRun,
    committed = false;
  async function upload(run, id, file, meta) {
    // A new, unguessable run prefix. POST /file is create-only and refuses collisions.
    const name = `sm-${run}-${id}.enc`;
    // Bounded synthetic adapter: known-length Buffer matches the successful
    // existing probe. Never send a chunked unknown-length file upload.
    if ((await stat(file)).size !== meta.bytes || meta.bytes > maxBytes)
      throw backupError("SIZE");
    const payload = await readFile(file);
    let response = await request(
      "HIDRIVE_CREATE",
      "POST",
      "/file",
      { dir: session.dir, name },
      payload,
    );
    if (!response.ok) throw backupError("REMOTE_HTTP");
    response = await request(
      "HIDRIVE_READBACK",
      "GET",
      "/file",
      { path: session.dir + "/" + name },
      null,
    );
    if (!response.ok || !response.body) throw backupError("REMOTE_HTTP");
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > meta.bytes) throw backupError("SIZE");
      hash.update(chunk);
    }
    if (bytes !== meta.bytes || hash.digest("hex") !== meta.sha256)
      throw backupError("INTEGRITY");
  }
  return {
    async putStream(run, id, stream, meta) {
      if (committed) throw Error("ARCHIVE_ALREADY_COMMITTED");
      if (activeRun && activeRun !== run) throw Error("ONE_RUN_ONLY");
      if (verified.has(id)) throw Error("ARCHIVE_ALREADY_UPLOADED");
      await local.putStream(run, id, stream, meta);
      activeRun = run;
      const file = path.join(spool, run, id);
      try {
        await upload(run, id, file, meta);
        verified.set(id, meta);
      } finally {
        await rm(file, { force: true });
      }
    },
    async commit(run, manifestId, files) {
      if (
        committed ||
        run !== activeRun ||
        !verified.has(manifestId) ||
        files.length !== verified.size ||
        new Set(files.map((f) => f.id)).size !== files.length ||
        files.some(
          (f) =>
            verified.get(f.id)?.sha256 !== f.sha256 ||
            verified.get(f.id)?.bytes !== f.bytes,
        )
      )
        throw Error("INCOMPLETE_REMOTE_ARCHIVE");
      // Receipt contains random IDs and ciphertext hashes only. The source names,
      // plaintext hashes, metadata and signed manifest remain encrypted.
      const file = path.join(spool, run, "receipt");
      await writeFile(file, JSON.stringify({ run, manifestId, files }), {
        flag: "wx",
        mode: 0o600,
      });
      try {
        const { size } = await stat(file);
        await upload(run, "COMMITTED", file, {
          bytes: size,
          sha256: await hashFile(file),
        });
        committed = true;
      } finally {
        await rm(file, { force: true });
      }
    },
    async readStream(run, id) {
      // No OAuth state, arbitrary path, source name or uncommitted object is readable.
      const meta = verified.get(id);
      if (!committed || run !== activeRun || !meta)
        throw Error("UNCOMMITTED_REMOTE_ARCHIVE");
      const response = await request(
        "HIDRIVE_GET",
        "GET",
        "/file",
        { path: session.dir + `/sm-${run}-${id}.enc` },
        null,
      );
      if (!response.ok || !response.body)
        throw Error("HIDRIVE_ARCHIVE_DOWNLOAD_FAILED");
      const dir = await mkdtemp(path.join(spool, "restore-")),
        file = path.join(dir, "ciphertext");
      const hash = createHash("sha256");
      let bytes = 0;
      const check = new Transform({
        transform(chunk, encoding, callback) {
          bytes += chunk.length;
          if (bytes > meta.bytes || bytes > maxBytes)
            return callback(backupError("SIZE"));
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      try {
        await pipeline(
          response.body,
          check,
          createWriteStream(file, { flags: "wx", mode: 0o600 }),
        );
        if (bytes !== meta.bytes || hash.digest("hex") !== meta.sha256)
          throw backupError("INTEGRITY");
        const stream = createReadStream(file);
        stream.once("close", () => {
          rm(dir, { recursive: true, force: true }).catch(() => {});
        });
        return stream;
      } catch (error) {
        await rm(dir, { recursive: true, force: true });
        throw error;
      }
    },
  };
}
