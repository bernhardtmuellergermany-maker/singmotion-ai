import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "../db.ts";
import { sha256File, validateReference } from "../live/media.ts";
import { validateOmniAudio, validateEncodedDuration } from "../live/limits.ts";
import type { PreparedMedia } from "../live/store.ts";

/** Verify only immutable, owned copies stored within the private media directory.
 * The hash check detects replaced or modified files even if the DB is unchanged. */
export async function verifyPrivatePaidMediaSnapshot(media: PreparedMedia): Promise<void> {
  const root = await realpath(path.join(dataDir, "media"));
  for (const filename of [media.audioPath, media.imagePath]) {
    const resolved = await realpath(filename);
    if (!resolved.startsWith(root + path.sep))
      throw Error("Paid video asset is outside private media storage");
  }
  const audio = await stat(media.audioPath);
  if (!audio.isFile()) throw Error("Invalid prepared audio asset");
  validateOmniAudio({format:"mp3",bytes:audio.size,duration:media.durationSeconds});
  validateEncodedDuration(media.durationSeconds,10);
  await validateReference(media.imagePath);
  const [audioHash,imageHash] = await Promise.all([
    sha256File(media.audioPath),sha256File(media.imagePath),
  ]);
  if (audioHash !== media.audioSha256 || imageHash !== media.imageSha256)
    throw Error("Prepared media bytes changed after customer review");
}
