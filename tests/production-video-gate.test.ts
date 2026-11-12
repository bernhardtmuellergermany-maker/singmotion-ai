import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { probe } from "../lib/media.ts";
import { fitOutputFormat, validateOutput, type OutputValidationContract } from "../lib/live/output.ts";

function ffmpeg(args: string[]) {
  execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-y", ...args], {
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  });
}
function shaPackets(file: string) {
  return execFileSync("ffmpeg", [
    "-nostdin", "-v", "error", "-i", file, "-map", "0:a:0",
    "-c:a", "copy", "-f", "hash", "-hash", "sha256", "-",
  ], { timeout: 30000, encoding: "utf8" }).trim();
}
const contract = (audioCodec: string, discover720p: boolean): OutputValidationContract => ({
  outputHosts: ["approved.example.test"],
  discover720p,
  output: {
    width: 720, height: 1280, fps: 25, videoCodec: "h264",
    audioCodec, durationToleranceSeconds: 0.15, maxDurationSeconds: 2,
    transfer: { maxBytes: 20 * 1024 * 1024, timeoutMs: 30000, evidence: "synthetic offline regression test" },
  },
});

test("production export gate: MP3 original audio survives portrait conversion byte-for-byte at packet level", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "singmotion-release-mp3-"));
  try {
    const input = path.join(dir, "provider.mp4");
    ffmpeg([
      "-f", "lavfi", "-i", "color=c=black:s=1280x720:r=25:d=1",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
      "-t", "1", "-c:v", "libx264", "-threads", "2",
      "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-c:a", "libmp3lame", "-q:a", "4", input,
    ]);
    const before = await readFile(input);
    const audioBefore = shaPackets(input);
    const mp3 = contract("mp3", true);
    await validateOutput(input, 1, mp3);
    // This exact discovery-mode check previously hard-coded AAC and caused
    // production OUTPUT_CODEC_MISMATCH on a restored original-MP3 export.
    await fitOutputFormat(input, 1, mp3, "9:16");
    await validateOutput(input, 1, mp3);
    const inspected = await probe(input);
    assert.equal(inspected.streams.find(s => s.codec_type === "video")?.width, 1280);
    assert.equal(inspected.streams.find(s => s.codec_type === "video")?.height, 720);
    assert.equal(inspected.streams.find(s => s.codec_type === "audio")?.codec_name, "mp3");
    assert.equal(shaPackets(input), audioBefore);
    assert.deepEqual(await readFile(input), before);
    await assert.rejects(validateOutput(input, 1, contract("aac", true)), /OUTPUT_CODEC_MISMATCH/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("production export gate: conventional AAC is accepted but MP3 cannot pass an AAC policy", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "singmotion-release-aac-"));
  try {
    const file = path.join(dir, "aac.mp4");
    ffmpeg([
      "-f", "lavfi", "-i", "color=c=black:s=720x1280:r=25:d=1",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
      "-t", "1", "-c:v", "libx264", "-threads", "2",
      "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", file,
    ]);
    await validateOutput(file, 1, contract("aac", true));
    await assert.rejects(validateOutput(file, 1, contract("mp3", true)), /OUTPUT_CODEC_MISMATCH/);
    await assert.rejects(
      validateOutput(file, 1, { ...contract("aac", false), output: { ...contract("aac", false).output, fps: 30 } }),
      /OUTPUT_FRAMERATE_MISMATCH/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("selected 16:9 does not reframe a portrait BytePlus video", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "singmotion-release-wide-"));
  try {
    const file = path.join(dir, "portrait-provider.mp4");
    ffmpeg([
      "-f", "lavfi", "-i", "color=c=red:s=720x1280:r=25:d=1",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
      "-t", "1", "-c:v", "libx264", "-threads", "2",
      "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", file,
    ]);
    const original = await readFile(file);
    const originalAudio = shaPackets(file);
    await fitOutputFormat(file, 1, contract("aac", true), "16:9");
    const streams = (await probe(file)).streams;
    assert.equal(streams.find(s => s.codec_type === "video")?.width, 720);
    assert.equal(streams.find(s => s.codec_type === "video")?.height, 1280);
    assert.equal(shaPackets(file), originalAudio);
    assert.deepEqual(await readFile(file), original);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
