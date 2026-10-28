import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  matchesReviewedDimensions,
  validateOutput,
  downloadValidatedOutput,
  type OutputValidationContract,
} from "../lib/live/output.ts";

test("720p orientation acceptance is limited to the exact reviewed side lengths", () => {
  for (const [w, h] of [
    [1280, 720],
    [720, 1280],
  ]) {
    assert.equal(matchesReviewedDimensions(w, h, 1280, 720), true);
    assert.equal(matchesReviewedDimensions(w, h, 720, 1280), true);
  }
  for (const [w, h] of [
    [720, 720],
    [960, 720],
    [1920, 1080],
    [720, 4096],
    [1280, 719],
    [NaN, 720],
  ])
    assert.equal(matchesReviewedDimensions(w, h, 1280, 720), false);
  assert.equal(matchesReviewedDimensions(1080, 1920, 1920, 1080), false);
  assert.equal(matchesReviewedDimensions(5000, 720, 720, 5000), false);
});

test("real local portrait/landscape MP4s pass the production downloader; duration FPS codec size and corrupt output stay blocked", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sm-orientation-"));
  const contract: OutputValidationContract = {
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
  try {
    for (const size of ["1280x720", "720x1280"]) {
      const file = path.join(root, `${size}.mp4`);
      execFileSync("ffmpeg", [
        "-nostdin",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `color=black:s=${size}:r=25`,
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
        file,
      ]);
      const bytes = await readFile(file);
      await downloadValidatedOutput(
        "https://approved.example.test/video",
        path.join(root, `private-${size}.mp4`),
        1,
        contract,
        async () => new Response(bytes),
      );
      for (const [patch, code] of [
        [{ fps: 30 }, "FRAMERATE"],
        [{ width: 720, height: 960 }, "DIMENSIONS"],
        [{ videoCodec: "hevc" }, "CODEC"],
        [{ audioCodec: "mp3" }, "CODEC"],
        [{ maxDurationSeconds: 0.5 }, "DURATION"],
      ] as const)
        await assert.rejects(
          validateOutput(file, 1, {
            ...contract,
            output: { ...contract.output, ...patch },
          }),
          new RegExp(`OUTPUT_${code}`),
        );
      await assert.rejects(
        validateOutput(file, 3, contract),
        /OUTPUT_DURATION/,
      );
      await assert.rejects(
        downloadValidatedOutput(
          "https://approved.example.test/video",
          path.join(root, "too-large.mp4"),
          1,
          {
            ...contract,
            output: {
              ...contract.output,
              transfer: {
                maxBytes: 1,
                timeoutMs: 1000,
                evidence: "local test",
              },
            },
          },
          async () => new Response(bytes),
        ),
        /too large/,
      );
      await assert.rejects(
        downloadValidatedOutput(
          "https://approved.example.test/video",
          path.join(root, "corrupt.mp4"),
          1,
          contract,
          async () => new Response(bytes.subarray(0, 32)),
        ),
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
