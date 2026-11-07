import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "../db.ts";
import { sha256File, validateReference } from "../live/media.ts";
import { validateOmniAudio, validateEncodedDuration } from "../live/limits.ts";
import type { PreparedMedia } from "../live/store.ts";
import {ensureLocalMediaPath} from "../cloud-hydration.ts";

/** Verify only immutable, owned copies stored within the private media directory.
 * The hash check detects replaced or modified files even if the DB is unchanged. */
export async function verifyPrivatePaidMediaSnapshot(media: PreparedMedia): Promise<void> {
  await ensureLocalMediaPath(media.owner,media.audioPath);
  await ensureLocalMediaPath(media.owner,media.imagePath);
  const root = await realpath(path.join(dataDir, "media"));
  for (const filename of [media.audioPath, media.imagePath]) {
    const resolved = await realpath(filename);
    if (!resolved.startsWith(root + path.sep))
      throw Error("Paid video asset is outside private media storage");
  }
  const audio = await stat(media.audioPath);
  if (!audio.isFile()) throw Error("Invalid prepared audio asset");
  validateOmniAudio({format:"mp3",bytes:audio.size,duration:media.durationSeconds});
  validateEncodedDuration(media.durationSeconds,300);
  await validateReference(media.imagePath);
  if (media.tempo) {
    if (media.tempo.rate !== 0.9 ||
        !/^[a-f0-9]{64}$/.test(media.tempo.originalSha256) ||
        media.tempo.sourceSha256 !== media.recording?.sourceSha256 ||
        media.tempo.songId !== media.recording?.songId ||
        media.tempo.originalDuration <= 0 ||
        !media.tempo.authorizationDigest)
      throw Error("Invalid committed customer tempo metadata");
    await ensureLocalMediaPath(media.owner,media.tempo.originalPath);
    const original=await realpath(media.tempo.originalPath);
    if (!original.startsWith(root+path.sep) ||
        (await sha256File(original))!==media.tempo.originalSha256)
      throw Error("Original customer audio changed after checkout");
    if (Math.abs(media.durationSeconds * 0.9-media.tempo.originalDuration)>0.2)
      throw Error("Customer tempo duration no longer matches reviewed original");
  }
  const [audioHash,imageHash] = await Promise.all([
    sha256File(media.audioPath),sha256File(media.imagePath),
  ]);
  if (audioHash !== media.audioSha256 || imageHash !== media.imageSha256)
    throw Error("Prepared media bytes changed after customer review");
}
