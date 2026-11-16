/** Adapter for the existing worker's OAuth session. No login, token exposure,
 * delete, sharing, or overwrite. Not started by the existing worker entrypoint.
 * bounded ciphertext spool must be separate from the /state OAuth volume.
 */
import { createReadStream } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileCiphertextSink } from "./private-backup-worker.mjs";
import { hashFile } from "./cloud-backup.mjs";

export function hidriveCiphertextSink({
  session,
  spool,
  maxBytes = 64 * 1024 * 1024,
}) {
  const local = fileCiphertextSink(spool, maxBytes);
  const verified = new Map();
  let activeRun;
  async function upload(run, id, file, meta) {
    // A new, unguessable run prefix; overwrite explicitly disabled by HiDrive.
    const name = `sm-${run}-${id}.enc`;
    let response = await session.request(
      "PUT",
      "/file",
      { dir: session.dir, name, overwrite: "false" },
      createReadStream(file),
    );
    if (!response.ok) throw Error("HIDRIVE_ARCHIVE_UPLOAD_FAILED");
    response = await session.request(
      "GET",
      "/file",
      { path: session.dir + "/" + name },
      null,
    );
    if (!response.ok || !response.body)
      throw Error("HIDRIVE_ARCHIVE_READBACK_FAILED");
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > meta.bytes) throw Error("HIDRIVE_ARCHIVE_SIZE_MISMATCH");
      hash.update(chunk);
    }
    if (bytes !== meta.bytes || hash.digest("hex") !== meta.sha256)
      throw Error("HIDRIVE_ARCHIVE_HASH_MISMATCH");
  }
  return {
    async putStream(run, id, stream, meta) {
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
        const { size } = await (await import("node:fs/promises")).stat(file);
        await upload(run, "COMMITTED", file, {
          bytes: size,
          sha256: await hashFile(file),
        });
      } finally {
        await rm(file, { force: true });
      }
    },
  };
}
