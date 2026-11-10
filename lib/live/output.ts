import {
  privateOutputTransport,
  type OutputTransport,
} from "./output-transport.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  open,
  unlink,
  mkdtemp,
  chmod,
  stat,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
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
/** FFprobe uses "N/A"/"0:1" when SAR is absent, not non-square. Reject
 * any EXPLICIT non-square pixel aspect ratio; decoded frames and output are
 * independently checked after normalization. No broad SAR/rotation bypass. */
export function hasNoNonSquarePixelAspect(sar:unknown):boolean {
  if(sar===undefined||sar===null||sar==="N/A"||sar==="0:1")return true;
  if(typeof sar!=="string")return false;
  const match=/^([1-9][0-9]{0,4}):([1-9][0-9]{0,4})$/.exec(sar);
  return !!match&&Number(match[1])===Number(match[2]);
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
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= 8192;
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

/** Shared for paid customers, operators and existing-task recovery. */
export function matchesOmniHumanDuration(
  actual: number,
  expected: number,
  tolerance: number,
  maxDuration?: number,
): boolean {
  if (!Number.isFinite(actual) || !Number.isFinite(expected) ||
      !Number.isFinite(tolerance) || tolerance < 0 ||
      expected <= 0 || actual <= 0) return false;
  return (maxDuration === undefined || actual <= maxDuration) &&
    actual >= expected - tolerance &&
    actual <= expected + Math.max(2, tolerance);
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
  if (!video || !audio) throw new Error("OUTPUT_STREAM_MISSING");
  if (
    (contract.output.videoCodec !== undefined &&
      video.codec_name !== contract.output.videoCodec) ||
    (contract.output.audioCodec !== undefined &&
      audio.codec_name !== contract.output.audioCodec) ||
    (contract.discover720p &&
      (!["h264", "hevc"].includes(video.codec_name) ||
        // A restored-tempo export explicitly requires original MP3 packets.
        // Provider outputs without that explicit override still require AAC.
        audio.codec_name !== (contract.output.audioCodec ?? "aac")))
  )
    throw new Error("OUTPUT_CODEC_MISMATCH");
  // Bounded numeric evidence only: no URLs, filenames or customer metadata.
  const sourceDimensionMismatch = contract.discover720p
    ? !Number.isInteger(video?.width) || !Number.isInteger(video?.height) ||
      Math.min(video.width!,video.height!)!==720 || Math.max(video.width!,video.height!)>4096
    : !matchesReviewedDimensions(video?.width,video?.height,contract.output.width,contract.output.height);
  if(sourceDimensionMismatch)console.warn("OUTPUT_DIMENSION_REJECTED",outputDimensionDiagnostic(
    video?.width,video?.height,contract.output.width,contract.output.height,contract.discover720p===true));
  if (
    contract.discover720p
      ? !Number.isInteger(video.width) ||
        !Number.isInteger(video.height) ||
        Math.min(video.width!, video.height!) !== 720 ||
        Math.max(video.width!, video.height!) > 4096
      : !matchesReviewedDimensions(
          video.width,
          video.height,
          contract.output.width,
          contract.output.height,
        )
  )
    throw new Error(
      outputDimensionDiagnostic(
        video?.width,
        video?.height,
        contract.output.width,
        contract.output.height,
        contract.discover720p === true,
      ),
    );
  // Video encoders quantize playback length to frames while MP3 audio is
  // measured independently. Permit at most one frame plus 10ms of container
  // timestamp rounding; preserve the reviewed tolerance if it is larger.
  // This also repairs recovery of already submitted tasks whose saved policy
  // specified an impractical exact-zero duration tolerance.
  const frameRoundingSeconds =
    Number.isFinite(actualFps) && actualFps > 0 && actualFps <= 120
      ? Math.min(0.1, 1 / actualFps + 0.01)
      : 0;
  // Shared OmniHuman 2.0 output duration policy for operators and paid
  // customers, including recovery of existing immutable tasks.
  // Generated MP4 may contain up to 2s of provider-added lead/tail frames.
  // Shorter or materially longer outputs are still rejected.
  const allowedDurationDelta = Math.max(
    contract.output.durationToleranceSeconds,
    frameRoundingSeconds,
  );
  const permittedPositiveDelta = Math.max(allowedDurationDelta, 2);
  if (!matchesOmniHumanDuration(length, duration, allowedDurationDelta, contract.output.maxDurationSeconds)) {
    // Safe bounded numerical diagnostics only. No provider URL, file path,
    // user content or credentials are emitted. Required to distinguish MP4
    // rounding from a genuinely mismatched generated video.
    console.warn("OUTPUT_DURATION_MISMATCH_DIAGNOSTIC", {
      expectedSeconds: Number.isFinite(duration) ? Number(duration.toFixed(3)) : null,
      actualSeconds: Number.isFinite(length) ? Number(length.toFixed(3)) : null,
      allowedDeltaSeconds: Number(permittedPositiveDelta.toFixed(3)),
      maxSeconds: contract.output.maxDurationSeconds ?? null,
    });
    throw new Error("OUTPUT_DURATION_MISMATCH");
  }
  if (
    !Number.isFinite(actualFps) ||
    (contract.discover720p
      ? actualFps <= 0 || actualFps > 120
      : Math.abs(actualFps - contract.output.fps) > 0.01)
  )
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
/** Operator-observed source rectangle, not a new provider format guarantee.
 * Only this source -> reviewed portrait export is admitted for local conversion.
 * Raw source is never published and no general resolution bypass is available. */
export async function validateDownloadedOutput(
  file: string,
  duration: number,
  contract: OutputValidationContract,
) {
  const source = await probe(file);
  const video = source.streams.find((s) => s.codec_type === "video");
  const rate = video?.avg_frame_rate?.split("/").map(Number);
  const actualFps = rate?.length === 2 && rate[1] > 0 ? rate[0] / rate[1] : NaN;
  // The reviewed deliverable remains exactly 25 FPS. A short, explicitly
  // enumerated source rate may be normalized locally without changing the
  // BytePlus task, the original soundtrack or the reviewed final policy.
  const normalizeFps = contract.output.fps === 25 &&
    [24, 24000 / 1001, 30, 30000 / 1001].some(
      fps => Math.abs(actualFps - fps) < 0.005,
    );
  // The paid contract can bind a Custom rectangle computed from an owned
  // source image. Restrict dimensions to 720p short side and 1280 long side.
  const reviewedOutputRectangle =
    Number.isInteger(contract.output.width) &&
    Number.isInteger(contract.output.height) &&
    Math.min(contract.output.width,contract.output.height) === 720 &&
    Math.max(contract.output.width,contract.output.height) <= 1280 &&
    contract.output.width % 2 === 0 &&
    contract.output.height % 2 === 0;
  // Only observed BytePlus source rectangles may be resized to the
  // server-bound 720p target rectangle. The square
  // 960x960 source was confirmed by the paid Staging recovery on 2026-11-10.
  // All codec, duration, fps, pixel aspect and full-decode checks still apply.
  const reviewedSourceRectangle =
    !contract.discover720p && reviewedOutputRectangle &&
    ((video?.width === 786 && video.height === 1178) ||
     (video?.width === 960 && video.height === 960));
  // Width and height are not interchangeable for a customer order. The
  // shared provider validator accepts reviewed 720p rotations, but delivery
  // MUST match the exact orientation chosen at checkout.
  const needsOrientationFit = reviewedOutputRectangle &&
    video?.width === contract.output.height &&
    video?.height === contract.output.width;
  if (!reviewedSourceRectangle && !normalizeFps && !needsOrientationFit) {
    await validateOutput(file, duration, contract);
    if (reviewedOutputRectangle && (
      video?.width !== contract.output.width ||
      video?.height !== contract.output.height
    )) throw new Error("OUTPUT_DIMENSIONS_MISMATCH");
    return;
  }
  const metadata = video as typeof video & {
    sample_aspect_ratio?: string;
    side_data_list?: { rotation?: number }[];
  };
  if (
    contract.discover720p ||
    contract.output.videoCodec !== "h264" ||
    contract.output.audioCodec !== "aac" ||
    source.streams.length !== 2 ||
    !hasNoNonSquarePixelAspect(metadata?.sample_aspect_ratio) ||
    metadata.side_data_list?.some(
      (s) => s.rotation !== undefined && s.rotation !== 0,
    )
  ) {
    // Fixed, non-customer diagnostic only: no paths, media names, provider
    // URLs, frame pixels, audio samples or FFmpeg stderr.
    const policyReason = contract.discover720p ? "discover-mode" :
      contract.output.videoCodec !== "h264" ? "video-contract" :
      contract.output.audioCodec !== "aac" ? "audio-contract" :
      source.streams.length !== 2 ? "stream-count" :
      !hasNoNonSquarePixelAspect(metadata?.sample_aspect_ratio) ? "sample-aspect-ratio" :
      "rotation";
    console.warn("OUTPUT_NORMALIZATION_REJECTED", "source-policy-" + policyReason);
    throw new Error("OUTPUT_NORMALIZATION_POLICY_REJECTED");
  }
  // Decode and validate the entire untrusted source before local
  // conversion. Only observed provider source rectangles and bounded 720p
  // targets are accepted; paid Custom size is validated before checkout.
  await validateOutput(file, duration, {
    ...contract,
    output: {
      ...contract.output,
      ...(reviewedSourceRectangle ? { width: video!.width!, height: video!.height! } : {}),
      ...(normalizeFps ? { fps: actualFps } : {}),
    },
  });
  await fitValidatedRectangle(file, duration, contract, normalizeFps);
  const exported = (await probe(file)).streams.find(s => s.codec_type === "video");
  if (reviewedOutputRectangle && (
    exported?.width !== contract.output.width ||
    exported?.height !== contract.output.height
  )) throw new Error("OUTPUT_DIMENSIONS_MISMATCH");
}
/** Local export only; does not send an aspect-ratio parameter to BytePlus. */
export function exportContract<T extends OutputValidationContract>(
  contract: T,
  format?: "9:16" | "16:9" | "custom",
  customOutput?: {width:number;height:number},
): T {
  if (!format) return contract;
  if(format==="custom" && (
    !customOutput ||
    !Number.isInteger(customOutput.width) ||
    !Number.isInteger(customOutput.height) ||
    Math.min(customOutput.width,customOutput.height)!==720 ||
    Math.max(customOutput.width,customOutput.height)>1280 ||
    customOutput.width%2!==0 || customOutput.height%2!==0
  )) throw Error("Invalid server-reviewed Custom output rectangle");
  return {
    ...contract,
    output: {
      ...contract.output,
      width: format==="custom" ? customOutput!.width : format === "9:16" ? 720 : 1280,
      height: format==="custom" ? customOutput!.height : format === "9:16" ? 1280 : 720,
    },
  };
}
export async function fitOutputFormat(
  file: string,
  duration: number,
  contract: OutputValidationContract,
  format: "9:16" | "16:9" | "custom",
  customOutput?: {width:number;height:number},
) {
  await validateOutput(file, duration, contract);
  const video = (await probe(file)).streams.find(
    (s) => s.codec_type === "video",
  );
  const target = exportContract(contract, format, customOutput);
  if (
    video?.width === target.output.width &&
    video.height === target.output.height
  )
    return;
  await fitValidatedRectangle(file, duration, target);
}
async function fitValidatedRectangle(
  file: string,
  duration: number,
  contract: OutputValidationContract,
  normalizeFps = false,
) {
  // Center crop matches CSS object-fit:cover/object-position:center in the
  // pre-checkout customer preview. Preserve aspect ratio; never stretch, pad
  // with black bars, or alter the original provider audio packets.
  const source = await probe(file);
  const limits = outputTransferLimits(contract);
  if ((await stat(file)).size > limits.maxBytes)
    throw new Error("Provider output is too large.");
  const scratch = await mkdtemp(path.join(path.dirname(file), ".normalize-"));
  const normalized = path.join(scratch, "normalized.mp4");
  const exec = promisify(execFile);
  const audioHash = async (input: string) =>
    (
      await exec(
        "ffmpeg",
        [
          "-nostdin",
          "-v",
          "error",
          "-i",
          input,
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
      )
    ).stdout.trim();
  try {
    await exec(
      "ffmpeg",
      [
        "-nostdin",
        "-v",
        "error",
        "-xerror",
        "-noautorotate",
        "-i",
        file,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0",
        "-vf",
        `scale=${contract.output.width}:${contract.output.height}:force_original_aspect_ratio=increase:force_divisible_by=2,setsar=1,crop=${contract.output.width}:${contract.output.height}:(iw-ow)/2:(ih-oh)/2${normalizeFps ? `,fps=${contract.output.fps}` : ""}`,
        "-c:v",
        "libx264",
        "-threads",
        "2",
        "-preset",
        "fast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-fps_mode",
        "passthrough",
        "-c:a",
        "copy",
        "-map_metadata",
        "-1",
        "-movflags",
        "+faststart",
        // Do not use -fs: FFmpeg may truncate MP4 before the final size check.
        normalized,
      ],
      { timeout: 60000, maxBuffer: 1024 * 1024 },
    );
    await chmod(normalized, 0o600);
    if ((await stat(normalized)).size >= limits.maxBytes)
      throw new Error("Provider output is too large.");
    await validateOutput(normalized, duration, contract);
    const result = await probe(normalized);
    // Resizing may not shorten or retime either stream, nor replace its soundtrack.
    for (const kind of ["video", "audio"]) {
      const before = source.streams.find((s) => s.codec_type === kind) as {
        duration?: string;
        start_time?: string;
        nb_frames?: string;
      };
      const after = result.streams.find(
        (s) => s.codec_type === kind,
      ) as typeof before;
      const reason =
        ![before, after].every(
          (s) =>
            Number.isFinite(Number(s?.duration)) &&
            Number.isFinite(Number(s?.start_time)),
        ) ? "missing-stream-timeline" :
        Math.abs(Number(before.duration) - Number(after.duration)) >
          1 / contract.output.fps + (normalizeFps ? 0.01 : 0) ? "stream-duration-drift" :
        Math.abs(Number(before.start_time) - Number(after.start_time)) >
          1 / contract.output.fps + 0.01 ? "stream-start-drift" :
        (kind === "video" && !normalizeFps &&
          before.nb_frames !== undefined &&
          after.nb_frames !== undefined &&
          before.nb_frames !== after.nb_frames) ? "video-frame-count-drift" : null;
      if (reason) {
        console.warn("OUTPUT_NORMALIZATION_REJECTED", kind + "-" + reason);
        throw new Error("OUTPUT_NORMALIZATION_TIMING_FAILED");
      }
    }
    if ((await audioHash(file)) !== (await audioHash(normalized))) {
      console.warn("OUTPUT_NORMALIZATION_REJECTED", "audio-packet-mismatch");
      throw new Error("OUTPUT_NORMALIZATION_AUDIO_CHANGED");
    }
    // Only the newly downloaded private temporary file is replaced, never a
    // retained customer upload, ledger record or previously published MP4.
    await rename(normalized, file);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
/** No credentials are forwarded to output hosts and redirects are never followed. */
export async function downloadValidatedOutput(
  raw: string,
  file: string,
  duration: number,
  contract: OutputValidationContract,
  transport: OutputTransport = privateOutputTransport,
) {
  // Only the authenticated BytePlus task-status response may supply the URL
  // for the private Super Admin bootstrap. The downloader still rejects
  // non-HTTPS, URL credentials, IP literals, redirects, non-public DNS, and
  // invalid TLS before transferring a byte.
  let hosts = contract.outputHosts;
  if ("trustSignedProviderOutputHost" in contract && contract.trustSignedProviderOutputHost === true) {
    try {
      hosts = [new URL(raw).hostname];
    } catch {
      throw new Error("Provider output URL is invalid.");
    }
  }
  const url = validateOutputUrl(raw, hosts);
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
    await validateDownloadedOutput(file, duration, contract);
    success = true;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    await handle.close().catch(() => {});
    if (!success) await unlink(file).catch(() => {});
  }
}
