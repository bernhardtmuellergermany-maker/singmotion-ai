import {
  privateOutputTransport,
  type OutputTransport,
} from "./output-transport.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { open, unlink } from "node:fs/promises";
import { isIP } from "node:net";
import { probe } from "../media.ts";
import type { VerifiedContract } from "./contract.ts";

export interface OutputValidationContract {
  outputHosts: readonly string[];
  /** Explicit operator-approved acceptance bounds; never inferred provider metadata. */
  discover720p?: boolean;
  output: VerifiedContract["output"] & {
    videoCodec?: string;
    audioCodec?: string;
  };
}

export function validateOutputUrl(raw: string, hosts: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Provider output URL is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443") ||
    isIP(url.hostname) ||
    url.hostname.includes(":") ||
    url.hostname.endsWith(".") ||
    !hosts.includes(url.hostname) ||
    !url.hostname.includes(".") ||
    url.hostname.endsWith(".localhost") ||
    url.hostname.endsWith(".local")
  )
    throw new Error(
      "Provider output URL is not an approved HTTPS download destination.",
    );
  return url;
}
/** Only bounded numeric dimensions, never paths, URLs or probe metadata, enter diagnostics. */
export function outputDimensionDiagnostic(
  width: unknown,
  height: unknown,
  expectedWidth: unknown,
  expectedHeight: unknown,
  discover720p: boolean,
): string {
  const safe = (value: unknown): value is number =>
    typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 8192;
  if (!safe(width) || !safe(height)) return "OUTPUT_DIMENSIONS_MISMATCH";
  if (discover720p)
    return `OUTPUT_DIMENSIONS_MISMATCH_ACTUAL_${width}x${height}_EXPECTED_720P`;
  if (!safe(expectedWidth) || !safe(expectedHeight))
    return "OUTPUT_DIMENSIONS_MISMATCH";
  return `OUTPUT_DIMENSIONS_MISMATCH_ACTUAL_${width}x${height}_EXPECTED_${expectedWidth}x${expectedHeight}`;
}

/** The reviewed 720p rectangle may be portrait or landscape, with exactly the
 * same side lengths and pixel budget. This does not approve other aspect ratios,
 * arbitrary short-side-720 sizes, FPS or codecs, or assert provider guarantees. */
export function matchesReviewedDimensions(
  width: unknown,
  height: unknown,
  expectedWidth: number,
  expectedHeight: number,
): boolean {
  if (width === expectedWidth && height === expectedHeight) return true;
  return (
    Number.isInteger(expectedWidth) &&
    Number.isInteger(expectedHeight) &&
    Math.min(expectedWidth, expectedHeight) === 720 &&
    Math.max(expectedWidth, expectedHeight) <= 4096 &&
    width === expectedHeight &&
    height === expectedWidth
  );
}

export async function validateOutput(
  file: string,
  duration: number,
  contract: OutputValidationContract,
) {
  const p = await probe(file);
  const video = p.streams.find((s) => s.codec_type === "video");
  const audio = p.streams.find((s) => s.codec_type === "audio");
  const length = Number(p.format.duration);
  const fps = video?.avg_frame_rate?.split("/").map(Number);
  const actualFps = fps?.length === 2 ? fps[0] / fps[1] : NaN;
  // Keep the same validation rules but report only stable, non-sensitive categories.
  if (!p.format.format_name?.split(",").includes("mp4"))
    throw new Error("OUTPUT_FORMAT_INVALID");
  if (!video || !audio)
    throw new Error("OUTPUT_STREAM_MISSING");
  if ((contract.output.videoCodec !== undefined &&
       video.codec_name !== contract.output.videoCodec) ||
      (contract.output.audioCodec !== undefined &&
       audio.codec_name !== contract.output.audioCodec) ||
      (contract.discover720p &&
       (!["h264", "hevc"].includes(video.codec_name) || audio.codec_name !== "aac")))
    throw new Error("OUTPUT_CODEC_MISMATCH");
  if (contract.discover720p
    ? !Number.isInteger(video.width) ||
      !Number.isInteger(video.height) ||
      Math.min(video.width!, video.height!) !== 720 ||
      Math.max(video.width!, video.height!) > 4096
    : !matchesReviewedDimensions(
        video.width, video.height, contract.output.width, contract.output.height,
      ))
    throw new Error(
      outputDimensionDiagnostic(
        video?.width,
        video?.height,
        contract.output.width,
        contract.output.height,
        contract.discover720p === true,
      ),
    );
  if (!Number.isFinite(length) ||
      (contract.output.maxDurationSeconds !== undefined &&
       length > contract.output.maxDurationSeconds) ||
      Math.abs(length - duration) > contract.output.durationToleranceSeconds)
    throw new Error("OUTPUT_DURATION_MISMATCH");
  if (!Number.isFinite(actualFps) ||
      (contract.discover720p
       ? actualFps <= 0 || actualFps > 120
       : Math.abs(actualFps - contract.output.fps) > 0.01))
    throw new Error("OUTPUT_FRAMERATE_MISMATCH");
  const fileHandle = await open(file, "r");
  try {
    const header = Buffer.alloc(12);
    await fileHandle.read(header, 0, 12, 0);
    if (
      header.toString("ascii", 4, 8) !== "ftyp" ||
      header.toString("ascii", 8, 12) === "qt  "
    )
      throw new Error("Output is not a supported MP4 container.");
  } finally {
    await fileHandle.close();
  }
  await promisify(execFile)(
    "ffmpeg",
    [
      "-nostdin",
      "-v",
      "error",
      "-xerror",
      "-err_detect",
      "explode",
      "-threads",
      "2",
      "-i",
      file,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0",
      "-f",
      "null",
      "-",
    ],
    { timeout: 120_000, maxBuffer: 1024 * 1024 },
  );
}
/** Explicit reviewed transfer bounds; keep total work below the durable ten-minute lease. */
export function outputTransferLimits(contract: OutputValidationContract) {
  const limits = contract.output.transfer;
  if (!limits) return { maxBytes: 100 * 1024 * 1024, timeoutMs: 120000 };
  if (
    !limits.evidence?.trim() ||
    !Number.isSafeInteger(limits.maxBytes) ||
    limits.maxBytes < 1 ||
    limits.maxBytes > 256 * 1024 * 1024 ||
    !Number.isSafeInteger(limits.timeoutMs) ||
    limits.timeoutMs < 1000 ||
    limits.timeoutMs > 180000
  )
    throw new Error("Invalid reviewed output transfer limits.");
  return limits;
}
/** No credentials are forwarded to output hosts and redirects are never followed. */
export async function downloadValidatedOutput(
  raw: string,
  file: string,
  duration: number,
  contract: OutputValidationContract,
  transport: OutputTransport = privateOutputTransport,
) {
  const url = validateOutputUrl(raw, contract.outputHosts);
  const limits = outputTransferLimits(contract);
  const response = await transport(url, AbortSignal.timeout(limits.timeoutMs));
  if (response.status !== 200 || !response.body) {
    await response.body?.cancel();
    throw new Error("Provider download did not return a complete file.");
  }
  const maxBytes = limits.maxBytes;
  const lengthHeader = response.headers.get("content-length");
  const advertised = lengthHeader === null ? null : Number(lengthHeader);
  const encoding = response.headers.get("content-encoding");
  if (
    (encoding !== null && encoding !== "identity") ||
    (advertised !== null &&
      (!/^\d+$/.test(lengthHeader!) ||
        !Number.isSafeInteger(advertised) ||
        advertised <= 0 ||
        advertised > maxBytes))
  ) {
    await response.body.cancel();
    throw new Error("Provider output length/encoding is invalid or too large.");
  }
  let handle;
  try {
    handle = await open(file, "wx", 0o600);
  } catch {
    await response.body.cancel().catch(() => {});
    throw new Error("Cannot create private provider output file.");
  }
  const reader = response.body.getReader();
  let success = false;
  try {
    let bytes = 0;
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      bytes += chunk.byteLength;
      if (bytes > maxBytes) throw new Error("Provider output is too large.");
      await handle.writeFile(chunk);
    }
    if (advertised !== null && bytes !== advertised)
      throw new Error("Provider output length did not match.");
    await handle.close();
    await validateOutput(file, duration, contract);
    success = true;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    await handle.close().catch(() => {});
    if (!success) await unlink(file).catch(() => {});
  }
}
