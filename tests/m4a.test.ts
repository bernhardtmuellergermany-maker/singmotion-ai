import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { validateAudio, trimAudio, probe } from "../lib/media.ts";
import { validateFile } from "../lib/domain.ts";
test("AAC/M4A audio is decoded and trimmed to MP3; MP4 video masquerading as audio stays rejected", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sm-m4a-"));
  try {
    const input = path.join(dir, "song.m4a"),
      output = path.join(dir, "trim.mp3");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=6",
      "-c:a",
      "aac",
      input,
    ]);
    validateFile("song.m4a", 1000, "audio");
    assert.ok((await validateAudio(input)) > 5.9);
    await trimAudio(input, output, 1, 5);
    assert.equal((await probe(output)).streams[0].codec_name, "mp3");
    const video = path.join(dir, "wrong.m4a");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=s=32x32:d=1",
      "-f",
      "lavfi",
      "-i",
      "sine=d=1",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      "-f",
      "mp4",
      video,
    ]);
    await assert.rejects(validateAudio(video), /valid audio/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
