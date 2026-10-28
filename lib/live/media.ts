import {
  validateOmniImage,
  validateOmniAudio,
  validateEncodedDuration,
} from "./limits.ts";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat, realpath, mkdir, copyFile, unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { trimAudio, validateAudio } from "../media.ts";
import { IMAGE_LIMIT, composePrompt } from "../domain.ts";
import { parseStudioDraft } from "../studio-draft.ts";
import type { PreparedMedia } from "./store.ts";

export async function sha256File(filename: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}
export async function validateReference(filename: string) {
  const info = await stat(filename);
  if (!info.isFile() || info.size <= 0 || info.size > IMAGE_LIMIT)
    throw new Error("Invalid reference image size.");
  const decoder = sharp(filename, {
    limitInputPixels: 4096 * 4096,
    failOn: "error",
  });
  const meta = await decoder.metadata();
  if (
    !["jpeg", "png"].includes(meta.format || "") ||
    !meta.width ||
    !meta.height ||
    meta.width > 4096 ||
    meta.height > 4096 ||
    (meta.pages || 1) !== 1
  )
    throw new Error("Use one still JPEG/PNG reference, at most 4096 × 4096.");
  validateOmniImage({
    format: meta.format!,
    bytes: info.size,
    width: meta.width,
    height: meta.height,
  });
  await decoder.stats();
}
async function privateAsset(filename: string, dataDir: string) {
  const root = await realpath(path.join(dataDir, "media"));
  const resolved = await realpath(filename);
  if (!resolved.startsWith(root + path.sep))
    throw new Error("Asset must remain in private storage.");
  return resolved;
}
/** Offline only. Does not upload files or contact BytePlus. */
export async function prepareExistingJob(
  jobId: string,
  owner: string,
  maxSeconds = 10,
): Promise<PreparedMedia> {
  const { job } = await import("../db.ts");
  return prepareOwnedSelection(job(jobId, owner), owner, maxSeconds);
}
/** A draft is a local selection, not a queued job. Resolve all assets by owner. */
export async function prepareStudioDraft(
  value: unknown,
  owner: string,
  maxSeconds = 10,
): Promise<PreparedMedia> {
  const draft = parseStudioDraft(value);
  if (draft.owner !== owner)
    throw new Error("Draft owner does not match the operator selection.");
  const id = `draft-${createHash("sha256").update(JSON.stringify(draft)).digest("hex").slice(0, 32)}`;
  return prepareOwnedSelection(
    {
      ...draft,
      id,
      prompt: composePrompt(
        draft.performance,
        draft.camera,
        draft.customPrompt,
      ),
    },
    owner,
    maxSeconds,
  );
}
async function prepareOwnedSelection(
  selected: {
    id: string;
    songId: string;
    imageId: string;
    start: number;
    end: number;
    prompt: string;
  },
  owner: string,
  maxSeconds: number,
): Promise<PreparedMedia> {
  const { asset, dataDir, putAsset } = await import("../db.ts");
  if (
    !Number.isFinite(maxSeconds) ||
    maxSeconds <= 0 ||
    selected.end - selected.start > Math.min(300, maxSeconds)
  )
    throw new Error("Selected segment exceeds the live-test duration limit.");
  const source = asset(selected.songId, owner),
    image = asset(selected.imageId, owner);
  if (source.kind !== "audio" || image.kind !== "image")
    throw new Error("A song and one reference image are required.");
  if (!selected.prompt.trim() || selected.prompt.length > 1500)
    throw new Error(
      "A composed performance prompt is required (at most 1,500 characters).",
    );
  const sourcePath = await privateAsset(source.path, dataDir),
    imagePath = await privateAsset(image.path, dataDir);
  const sourceSha256 = await sha256File(sourcePath);
  await validateReference(imagePath);
  const directory = path.join(dataDir, "media");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // Content-addressed immutable copies bind approval to the exact reviewed inputs.
  const temp = path.join(directory, `clip-${randomUUID()}.mp3`);
  let audioPath: string;
  let audioSha256: string;
  let durationSeconds: number;
  try {
    durationSeconds = await trimAudio(
      sourcePath,
      temp,
      selected.start,
      selected.end,
    );
    validateOmniAudio({
      format: "mp3",
      bytes: (await stat(temp)).size,
      duration: durationSeconds,
    });
    validateEncodedDuration(durationSeconds, maxSeconds);
    audioSha256 = await sha256File(temp);
    audioPath = path.join(directory, `${selected.id}-${audioSha256}.mp3`);
    await copyFile(temp, audioPath, 1).catch(async (error) => {
      if (
        error.code !== "EEXIST" ||
        (await sha256File(audioPath)) !== audioSha256
      )
        throw error;
    });
  } finally {
    await unlink(temp).catch(() => {});
  }
  const imageSha256 = await sha256File(imagePath);
  const reference = path.join(
    directory,
    `${selected.id}-${imageSha256}.reference`,
  );
  await copyFile(imagePath, reference, 1).catch(async (error) => {
    if (
      error.code !== "EEXIST" ||
      (await sha256File(reference)) !== imageSha256
    )
      throw error;
  });
  // Validate the copied bytes too: the source may have changed during preparation.
  if ((await sha256File(reference)) !== imageSha256)
    throw new Error("Reference changed while creating the immutable snapshot.");
  await validateReference(reference);
  for (const snapshot of [
    {
      ...source,
      id: `${selected.id}-audio-${audioSha256}`,
      path: audioPath,
      name: "live-test-clip.mp3",
      mime: "audio/mpeg",
      duration: durationSeconds,
    },
    {
      ...image,
      id: `${selected.id}-image-${imageSha256}`,
      path: reference,
      name: "live-test-reference",
    },
  ]) {
    try {
      asset(snapshot.id, owner);
    } catch {
      putAsset({
        ...snapshot,
        bytes: (await stat(snapshot.path)).size,
        created: Date.now(),
      });
    }
  }
  if ((await sha256File(sourcePath)) !== sourceSha256)
    throw new Error("Original recording changed during preparation.");
  return {
    recording: { songId: selected.songId, sourceSha256 },
    sourceJobId: selected.id,
    owner,
    audioPath,
    imagePath: reference,
    audioSha256,
    imageSha256,
    durationSeconds,
    prompt: selected.prompt,
    promptLanguageConfirmed: false,
  };
}
export async function revalidateMedia(media: PreparedMedia) {
  if (
    !media.prompt.trim() ||
    media.prompt.length > 1500 ||
    !media.promptLanguageConfirmed
  )
    throw new Error(
      "Confirm the composed prompt is English before authorizing a live test.",
    );
  const duration = await validateAudio(media.audioPath, true);
  validateOmniAudio({
    format: "mp3",
    bytes: (await stat(media.audioPath)).size,
    duration,
  });
  await validateReference(media.imagePath);
  if (
    Math.abs(duration - media.durationSeconds) > 0.001 ||
    (await sha256File(media.audioPath)) !== media.audioSha256 ||
    (await sha256File(media.imagePath)) !== media.imageSha256
  )
    throw new Error(
      "Prepared inputs changed after review. Approval is not valid for these files.",
    );
}
