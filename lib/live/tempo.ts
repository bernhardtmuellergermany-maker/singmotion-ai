import { checkRecordingRejections } from "./recording-rejections.ts";
/** Local-only, pitch-preserving processing. Authorization is NOT moderation clearance. */
import { AppError } from "../domain.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat, copyFile, unlink, chmod, realpath } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { PreparedMedia, LiveTestStore } from "./store.ts";
import type { StudioDraftExport } from "../studio-draft.ts";
import type { VerifiedContract } from "./contract.ts";
import { sha256File } from "./media.ts";
import { probe, validateAudio } from "../media.ts";
import { validateOutput, outputTransferLimits } from "./output.ts";
import { validateEncodedDuration, validateOmniAudio } from "./limits.ts";
const exec = promisify(execFile);
export interface TempoMetadata {
  rate: 0.9;
  /** Decoded samples exclude MP3 encoder delay/padding; absent on legacy plans. */
  originalDecodedSeconds?: number;
  providerDecodedSeconds?: number;
  originalPath: string;
  originalSha256: string;
  originalDuration: number;
  sourceSha256: string;
  songId: string;
  authorizationDigest: string;
}
async function privateFile(root: string, file: string) {
  const base = await realpath(path.join(root, "media")),
    actual = await realpath(file);
  if (!actual.startsWith(base + path.sep))
    throw new AppError("Tempo input must remain private.");
  return actual;
}
export async function tempoAuthorization(
  root: string,
  store: LiveTestStore,
  selection: StudioDraftExport,
  owner: string,
  clipHash?: string,
) {
  if (process.env.AUDIO_TEMPO_ENABLED !== "true") return null;
  // The operator enables the standard workflow under their existing provider
  // authorization. This flag neither grants rights nor overrides moderation.
  // Hashes are automatic integrity/provenance binding, not an authorization form.
  if (selection.owner !== owner)
    throw new AppError("Draft ownership mismatch.", 403);
  const { asset } = await import("../db.ts");
  const source = asset(selection.songId, owner),
    image = asset(selection.imageId, owner);
  const sourceSha256 = await sha256File(await privateFile(root, source.path));
  const imageSha256 = await sha256File(await privateFile(root, image.path));
  await checkRecordingRejections(
    root,
    store,
    selection.songId,
    owner,
    sourceSha256,
    clipHash,
  );
  return {
    sourceSha256,
    digest: createHash("sha256")
      .update(
        JSON.stringify([
          "operator-standard-tempo-0.9-v1",
          owner,
          sourceSha256,
          imageSha256,
        ]),
      )
      .digest("hex"),
  };
}
/** Fixed diagnostic codes only; never persist FFmpeg stderr or private paths. */
export function tempoExportFailureCode(error: unknown): string {
  if (!(error instanceof Error)) return "TEMPO_EXPORT_UNKNOWN";
  const known: Record<string, string> = {
    "Tempo restoration inputs changed.": "TEMPO_INPUT_HASH_CHANGED",
    "Original excerpt changed.": "TEMPO_ORIGINAL_HASH_CHANGED",
    "Provider output cannot be restored within the original timing bounds.": "TEMPO_RATIO_MISMATCH",
    "Provider video is missing the required audio timeline; no automatic replacement generation.": "TEMPO_PROVIDER_TIMELINE_MISSING",
    "Restored output exceeds byte cap.": "TEMPO_RESTORED_TOO_LARGE",
    "Restored audio differs from original MP3 packets.": "TEMPO_AUDIO_PACKET_MISMATCH",
    "Restored audio/video start alignment failed.": "TEMPO_START_ALIGNMENT_MISMATCH",
  };
  if (known[error.message]) return known[error.message];
  const child = error as Error & { killed?: boolean; signal?: string };
  if (child.killed || child.signal === "SIGTERM" || child.signal === "SIGKILL")
    return "TEMPO_FFMPEG_TIMEOUT_OR_TERMINATED";
  if ("stderr" in error) return "TEMPO_FFMPEG_EXECUTION_FAILED";
  return "TEMPO_EXPORT_VALIDATION_FAILED";
}
async function ffmpeg(args: string[]) {
  await exec("ffmpeg", ["-nostdin", "-v", "error", "-y", ...args], {
    timeout: 120000,
    maxBuffer: 1024 * 1024,
  });
}
/** Decode to a bounded PCM buffer, not container length (which includes MP3 padding). */
async function decodedSeconds(file: string) {
  const { stdout } = await exec(
    "ffmpeg",
    [
      "-nostdin",
      "-v",
      "error",
      "-i",
      file,
      "-map",
      "0:a:0",
      "-f",
      "s16le",
      "-ac",
      "1",
      "-ar",
      "48000",
      "-",
    ],
    { encoding: "buffer", timeout: 120000, maxBuffer: 64 * 1024 * 1024 },
  );
  const seconds = stdout.length / (48000 * 2);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 334)
    throw new AppError("Decoded audio duration is outside processing bounds.");
  return seconds;
}
export async function slowExcerpt(
  media: PreparedMedia,
  root: string,
  songId: string,
  authorization: { sourceSha256: string; digest: string },
  maxSeconds: number,
): Promise<PreparedMedia> {
  const original = await privateFile(root, media.audioPath);
  if ((await sha256File(original)) !== media.audioSha256)
    throw new AppError("Original excerpt changed.");
  const temp = path.join(root, "media", `tempo-${randomUUID()}.mp3`);
  try {
    await ffmpeg([
      "-i",
      original,
      "-map",
      "0:a:0",
      "-vn",
      "-af",
      "atempo=0.9",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "192k",
      temp,
    ]);
    const duration = await validateAudio(temp, true);
    validateEncodedDuration(duration, maxSeconds);
    validateOmniAudio({
      format: "mp3",
      bytes: (await stat(temp)).size,
      duration,
    });
    if (Math.abs(duration * 0.9 - media.durationSeconds) > 0.2)
      throw new AppError("Tempo duration validation failed.");
    const originalDecodedSeconds = await decodedSeconds(original);
    const providerDecodedSeconds = await decodedSeconds(temp);
    if (Math.abs(originalDecodedSeconds / providerDecodedSeconds - 0.9) > 0.005)
      throw new AppError("Decoded tempo ratio failed validation.");
    const hash = await sha256File(temp),
      file = path.join(root, "media", `tempo-${hash}.mp3`);
    await copyFile(temp, file, 1).catch(async (e) => {
      if (e.code !== "EEXIST" || (await sha256File(file)) !== hash) throw e;
    });
    await chmod(file, 0o600);
    return {
      ...media,
      audioPath: file,
      audioSha256: hash,
      durationSeconds: duration,
      tempo: {
        rate: 0.9,
        originalDecodedSeconds,
        providerDecodedSeconds,
        originalPath: original,
        originalSha256: media.audioSha256,
        originalDuration: media.durationSeconds,
        sourceSha256: authorization.sourceSha256,
        songId,
        authorizationDigest: authorization.digest,
      },
    };
  } finally {
    await unlink(temp).catch(() => {});
  }
}
export async function checkTempoSubmission(
  media: PreparedMedia,
  root: string,
  store: LiveTestStore,
  selection: StudioDraftExport,
) {
  if (!media.tempo) return;
  const current = await tempoAuthorization(root, store, selection, media.owner);
  if (!current || current.digest !== media.tempo.authorizationDigest)
    throw new AppError(
      "Tempo review changed or processing is disabled; prepare a fresh cost review. No submission.",
    );
  await checkRecordingRejections(
    root,
    store,
    media.tempo.songId,
    media.owner,
    media.tempo.sourceSha256,
    media.tempo.originalSha256,
  );
  if (
    (await sha256File(await privateFile(root, media.tempo.originalPath))) !==
    media.tempo.originalSha256
  )
    throw new AppError("Original excerpt changed.");
}
async function audioPacketHash(file: string) {
  const { stdout } = await exec(
    "ffmpeg",
    [
      "-nostdin",
      "-v",
      "error",
      "-i",
      file,
      "-map",
      "0:a:0",
      "-c:a",
      "copy",
      "-f",
      "hash",
      "-hash",
      "sha256",
      "-",
    ],
    { timeout: 30000, maxBuffer: 1024 },
  );
  return stdout.trim();
}
export async function validateRestored(
  file: string,
  media: PreparedMedia,
  contract: VerifiedContract,
) {
  const t = media.tempo!;
  if ((await sha256File(t.originalPath)) !== t.originalSha256)
    throw new AppError("Original excerpt changed.");
  if ((await stat(file)).size > outputTransferLimits(contract).maxBytes)
    throw new AppError("Restored output exceeds byte cap.");
  await validateOutput(file, t.originalDuration, {
    outputHosts: contract.outputHosts,
    output: {
      ...contract.output,
      videoCodec: "h264",
      audioCodec: "mp3",
      durationToleranceSeconds: 0.2,
      maxDurationSeconds: t.originalDuration + 0.2,
    },
  });
  if ((await audioPacketHash(file)) !== (await audioPacketHash(t.originalPath)))
    throw new AppError("Restored audio differs from original MP3 packets.");
  const p = await probe(file);
  for (const stream of p.streams) {
    const start = Number(
      (stream as unknown as { start_time?: string }).start_time ?? 0,
    );
    if (!Number.isFinite(start) || Math.abs(start) > 0.1)
      throw new AppError("Restored audio/video start alignment failed.");
  }
}
export async function restoreTempoOutput(
  input: string,
  output: string,
  media: PreparedMedia,
  contract: VerifiedContract,
) {
  const t = media.tempo!;
  const originalSeconds = await decodedSeconds(t.originalPath);
  const providerSeconds = await decodedSeconds(media.audioPath);
  const ratio = originalSeconds / providerSeconds;
  // Recheck immutable inputs even during flag-off recovery. Never stretch arbitrary output.
  if (
    (await sha256File(media.audioPath)) !== media.audioSha256 ||
    (await sha256File(t.originalPath)) !== t.originalSha256
  )
    throw new AppError("Tempo restoration inputs changed.");
  if (
    Math.abs(ratio - 0.9) > 0.005 ||
    Math.abs(originalSeconds - t.originalDuration) > 0.2 ||
    (t.originalDecodedSeconds !== undefined &&
      Math.abs(originalSeconds - t.originalDecodedSeconds) > 0.001) ||
    (t.providerDecodedSeconds !== undefined &&
      Math.abs(providerSeconds - t.providerDecodedSeconds) > 0.001)
  )
    throw new AppError(
      "Provider output cannot be restored within the original timing bounds.",
    );
  await validateOutput(input, media.durationSeconds, contract);
  const video = (await probe(input)).streams.find(
    (s) => s.codec_type === "video",
  ) as { start_time?: string; duration?: string } | undefined;
  const start = Number(video?.start_time ?? 0);
  const videoSeconds = Number(video?.duration);
  if (
    !Number.isFinite(start) ||
    Math.abs(start) > 0.1 ||
    !Number.isFinite(videoSeconds) ||
    videoSeconds < providerSeconds - 1 / contract.output.fps
  )
    throw new AppError(
      "Provider video is missing the required audio timeline; no automatic replacement generation.",
    );
  await ffmpeg([
    "-i",
    input,
    "-i",
    t.originalPath,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-vf",
    `setpts=PTS-STARTPTS,trim=duration=${providerSeconds},setpts=${ratio}*PTS,fps=${contract.output.fps}`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "copy",
    "-map_metadata",
    "-1",
    "-movflags",
    "+faststart",
    output,
  ]);
  await chmod(output, 0o600);
  await validateRestored(output, media, contract);
}
