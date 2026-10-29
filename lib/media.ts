import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import { AppError, PROVIDER_AUDIO_LIMIT, validateSelection } from "./domain.ts";
const exec = promisify(execFile);
export async function probe(file: string) {
  const { stdout } = await exec(
    "ffprobe",
    ["-v", "error", "-show_format", "-show_streams", "-of", "json", file],
    { timeout: 30000, maxBuffer: 1024 * 1024 },
  );
  return JSON.parse(stdout) as {
    format: { duration?: string; format_name?: string };
    streams: {
      codec_type: string;
      codec_name: string;
      avg_frame_rate?: string;
      duration?: string;
      width?: number;
      height?: number;
    }[];
  };
}
export async function validateAudio(file: string, provider = false) {
  const p = await probe(file);
  const duration = Number(p.format.duration);
  const audio = p.streams.find((s) => s.codec_type === "audio");
  if (
    !audio ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    p.streams.some(
      (s) =>
        s.codec_type === "video" &&
        s.codec_name !== "mjpeg" &&
        s.codec_name !== "png",
    )
  )
    throw new AppError("This file does not contain valid audio.");
  const formats = new Set((p.format.format_name || "").split(","));
  const isMp3 = formats.has("mp3") && audio.codec_name === "mp3";
  const isWav = formats.has("wav") && /^(pcm_|adpcm_|alaw$|mulaw$|flac$)/.test(audio.codec_name);
  const isM4a = (formats.has("mov") || formats.has("mp4") || formats.has("m4a") || formats.has("3gp"))
    && ["aac", "alac"].includes(audio.codec_name);
  if (!isMp3 && !isWav && !isM4a)
    throw new AppError("Use an MP3, PCM WAV, or AAC/ALAC M4A audio file.");
  if (
    provider &&
    (audio.codec_name !== "mp3" ||
      duration > 300.1 ||
      (await stat(file)).size > PROVIDER_AUDIO_LIMIT)
  )
    throw new AppError("Prepared audio exceeds the MP3 provider limits.");
  return duration;
}
export async function trimAudio(
  input: string,
  output: string,
  start: number,
  end: number,
) {
  const duration = await validateAudio(input);
  validateSelection(start, end, duration);
  await exec(
    "ffmpeg",
    [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      input,
      "-ss",
      String(start),
      "-t",
      String(end - start),
      "-map",
      "0:a:0",
      "-vn",
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "192k",
      output,
    ],
    { timeout: 120000, maxBuffer: 1024 * 1024 },
  );
  const trimmed = await validateAudio(output, true);
  if (Math.abs(trimmed - (end - start)) > 0.2)
    throw new AppError("Audio trim duration verification failed.");
  return trimmed;
}

/** Build a browser-compatible playback copy without modifying uploaded source. */
export async function createAudioPreview(input: string, output: string) {
  await exec("ffmpeg", [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    "-i", input, "-map", "0:a:0", "-vn", "-codec:a", "libmp3lame",
    "-b:a", "128k", output,
  ], { timeout: 120000, maxBuffer: 1024 * 1024 });
}
