import { createHash } from "node:crypto";
import type { PreparedMedia } from "@/lib/live/store";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const validHash = (value: string) => /^[a-f0-9]{64}$/.test(value);

/** A deterministic commitment to the prepared PRIVATE media, not browser-supplied IDs.
 * Call only after ownership, audio/image decoding, duration and prompt validation. */
export function reviewedVideoInputDigest(media: PreparedMedia): string {
  if (!validHash(media.audioSha256) || !validHash(media.imageSha256) ||
      !media.prompt?.trim() || media.prompt.length > 1500 ||
      !Number.isFinite(media.durationSeconds) || media.durationSeconds <= 0 ||
      (media.outputFormat !== undefined && media.outputFormat !== "9:16" && media.outputFormat !== "16:9" && media.outputFormat !== "custom") ||
      (media.outputFormat === "custom" && (!media.customOutput ||
        !Number.isInteger(media.customOutput.width) || !Number.isInteger(media.customOutput.height) ||
        media.customOutput.width < 2 || media.customOutput.height < 2 ||
        Math.min(media.customOutput.width,media.customOutput.height) !== 720 ||
        Math.max(media.customOutput.width,media.customOutput.height) > 1280))
    throw Error("Reviewed prepared video inputs required");
  return sha256(JSON.stringify({
    version: 1,
    audioSha256: media.audioSha256,
    imageSha256: media.imageSha256,
    durationSeconds: Math.round(media.durationSeconds * 1000) / 1000,
    prompt: media.prompt,
    outputFormat: media.outputFormat ?? null,
    ...(media.outputFormat === "custom" ? {customOutput:media.customOutput} : {}),
    // Legacy orders remain digest-compatible. Tempo orders additionally bind
    // their original soundtrack and restoration instructions before payment.
    ...(media.tempo ? {tempo:{
      rate:media.tempo.rate,
      originalSha256:media.tempo.originalSha256,
      originalDuration:media.tempo.originalDuration,
      sourceSha256:media.tempo.sourceSha256,
      songId:media.tempo.songId,
      authorizationDigest:media.tempo.authorizationDigest,
    }} : {}),
  }));
}

/** Review evidence must be independently computed by trusted server code. */
export function reviewedVideoQuoteDigest(inputDigest: string, priceCents: number, quoteEvidence: string): string {
  if (!validHash(inputDigest) || !Number.isSafeInteger(priceCents) ||
      priceCents < 0 || priceCents > 10000000 ||
      typeof quoteEvidence !== "string" || quoteEvidence.trim().length < 20)
    throw Error("Server-reviewed price and input evidence required");
  return sha256(JSON.stringify({version: 1,inputDigest,priceCents,currency:"EUR",quoteEvidence}));
}
