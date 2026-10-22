import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { trimAudio, validateAudio, probe } from "../lib/media.ts";
test("FFmpeg produces a real selected MP3 segment with validated codec and measured duration", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "singmotion-audio-"));
  try {
    const input = path.join(dir, "source.wav"),
      out = path.join(dir, "clip.mp3");
    execFileSync("ffmpeg", [
      "-nostdin",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=if(lt(t\\,3)\\,0\\,0.1*sin(2*PI*440*t)):s=44100:d=12",
      "-y",
      input,
    ]);
    assert.ok(Math.abs((await validateAudio(input)) - 12) < 0.05);
    const duration = await trimAudio(input, out, 3, 8.25);
    assert.ok(Math.abs(duration - 5.25) < 0.15);
    assert.equal((await probe(out)).streams[0].codec_name, "mp3");
    const decoded = execFileSync("ffmpeg", [
      "-v",
      "error",
      "-i",
      out,
      "-t",
      "0.5",
      "-f",
      "f32le",
      "-ac",
      "1",
      "pipe:1",
    ]);
    let energy = 0;
    for (let i = 0; i < decoded.length; i += 4)
      energy += decoded.readFloatLE(i) ** 2;
    assert.ok(
      Math.sqrt(energy / (decoded.length / 4)) > 0.04,
      "Selected audio starts after the silent lead-in, proving the start offset was applied.",
    );
    await assert.rejects(() => trimAudio(input, out, 0, 13));
    await writeFile(path.join(dir, "fake.mp3"), "not audio");
    await assert.rejects(() => validateAudio(path.join(dir, "fake.mp3")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
