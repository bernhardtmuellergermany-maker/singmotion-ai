import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { probe } from "../lib/media.ts";
import {
  downloadValidatedOutput,
  validateOutput,
  type OutputValidationContract,
} from "../lib/live/output.ts";

test("786x1178 source becomes padded 720x1280 with unchanged timeline and audio; no broad acceptance", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sm-normalize-"));
  const policy: OutputValidationContract = {
    outputHosts: ["approved.example.test"],
    output: {
      width: 720,
      height: 1280,
      fps: 25,
      videoCodec: "h264",
      audioCodec: "aac",
      durationToleranceSeconds: 0.15,
      maxDurationSeconds: 2,
    },
  };
  const ff = (args: string[]) =>
    execFileSync("ffmpeg", ["-nostdin", "-v", "error", ...args], {
      maxBuffer: 4 * 1024 * 1024,
    });
  try {
    const raw = path.join(root, "source.mp4");
    ff([
      "-f",
      "lavfi",
      "-i",
      "color=red:s=786x1178:r=25",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440",
      "-t",
      "1",
      "-c:v",
      "libx264",
      "-threads",
      "2",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      raw,
    ]);
    const bytes = await readFile(raw);
    await assert.rejects(validateOutput(raw, 1, policy), /DIMENSIONS/); // raw never eligible for publication
    const file = path.join(root, "private.mp4");
    await downloadValidatedOutput(
      "https://approved.example.test/video",
      file,
      1,
      policy,
      async () => new Response(bytes),
    );
    await validateOutput(file, 1, policy);
    const p = await probe(file),
      video = p.streams.find((s) => s.codec_type === "video")!;
    assert.equal(video.width, 720);
    assert.equal(video.height, 1280);
    const pixels = ff([
      "-i",
      file,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ]);
    const pixel = (x: number, y: number) => [
      ...pixels.subarray((y * 720 + x) * 3, (y * 720 + x) * 3 + 3),
    ];
    assert.ok(pixel(360, 50).every((c) => c < 10)); // top padding
    assert.ok(pixel(360, 1230).every((c) => c < 10)); // bottom padding
    assert.ok(pixel(360, 110)[0] > 200); // content: about 1078px tall, not stretched or cropped
    assert.deepEqual(await readFile(raw), bytes);
    let counter = 0;
    const rejected = async (
      data: Buffer,
      contract: OutputValidationContract,
      pattern: RegExp = /./,
    ) => {
      const dest = path.join(root, `rejected-${counter++}.mp4`);
      await assert.rejects(
        downloadValidatedOutput(
          "https://approved.example.test/video",
          dest,
          1,
          contract,
          async () => new Response(Uint8Array.from(data)),
        ),
        pattern,
      );
      assert.equal((await readdir(root)).includes(path.basename(dest)), false);
      assert.equal(
        (await readdir(root)).some((n) => n.startsWith(".normalize-")),
        false,
      );
    };
    await rejected(
      bytes,
      { ...policy, output: { ...policy.output, fps: 30 } },
      /FRAMERATE/,
    );
    await rejected(
      bytes,
      { ...policy, output: { ...policy.output, maxDurationSeconds: 0.5 } },
      /DURATION/,
    );
    await rejected(
      bytes,
      { ...policy, output: { ...policy.output, audioCodec: "mp3" } },
      /POLICY/,
    );
    await rejected(
      bytes,
      { ...policy, output: { ...policy.output, width: 720, height: 960 } },
      /DIMENSIONS/,
    );
    await rejected(bytes.subarray(0, 32), policy);
    for (const filter of ["scale=788:1178,setsar=1", "setsar=2"]) {
      const bad = path.join(root, `bad-${counter}.mp4`);
      ff([
        "-i",
        raw,
        "-vf",
        filter,
        "-c:v",
        "libx264",
        "-threads",
        "2",
        "-preset",
        "ultrafast",
        "-c:a",
        "copy",
        bad,
      ]);
      await rejected(await readFile(bad), policy, /DIMENSIONS|POLICY/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
