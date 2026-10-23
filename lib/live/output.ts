import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { open, unlink } from "node:fs/promises";
import { isIP } from "node:net";
import { probe } from "../media.ts";
import type { VerifiedContract } from "./contract.ts";

export function validateOutputUrl(raw: string, hosts: readonly string[]): URL {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443") ||
    isIP(url.hostname) ||
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
export async function validateOutput(
  file: string,
  duration: number,
  contract: VerifiedContract,
) {
  const p = await probe(file);
  const video = p.streams.find((s) => s.codec_type === "video");
  const audio = p.streams.find((s) => s.codec_type === "audio");
  const length = Number(p.format.duration);
  const fps = video?.avg_frame_rate?.split("/").map(Number);
  const actualFps = fps?.length === 2 ? fps[0] / fps[1] : NaN;
  if (
    !p.format.format_name?.split(",").includes("mp4") ||
    !video ||
    !audio ||
    video.width !== contract.output.width ||
    video.height !== contract.output.height ||
    !Number.isFinite(length) ||
    Math.abs(length - duration) > contract.output.durationToleranceSeconds ||
    !Number.isFinite(actualFps) ||
    Math.abs(actualFps - contract.output.fps) > 0.01
  )
    throw new Error(
      "Provider MP4 failed duration, dimensions, audio or frame-rate validation.",
    );
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
/** No credentials are forwarded to output hosts and redirects are never followed. */
export async function downloadValidatedOutput(
  raw: string,
  file: string,
  duration: number,
  contract: VerifiedContract,
) {
  const url = validateOutputUrl(raw, contract.outputHosts);
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(120_000),
  });
  if (response.status !== 200 || !response.body) {
    await response.body?.cancel();
    throw new Error("Provider download did not return a complete file.");
  }
  const maxBytes = 100 * 1024 * 1024;
  const advertised = Number(response.headers.get("content-length"));
  if (Number.isFinite(advertised) && advertised > maxBytes) {
    await response.body.cancel();
    throw new Error("Provider output is too large.");
  }
  const handle = await open(file, "wx", 0o600);
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
