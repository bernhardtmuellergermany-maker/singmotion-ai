import { pollStudioProjects } from "../lib/live/studio-worker.ts";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { copyFile, unlink, writeFile } from "node:fs/promises";
import {
  db,
  job,
  asset,
  putAsset,
  transition,
  dataDir,
  demoOnly,
  transaction,
} from "../lib/db.ts";
import { trimAudio, probe } from "../lib/media.ts";

demoOnly();
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
console.log(
  "SingMotion worker ready. Demo rendering and Studio recovery are separately gated; this worker never submits paid tasks.",
);
while (!stopping) {
  await writeFile(path.join(dataDir, "worker-heartbeat"), String(Date.now()));
  await pollStudioProjects(dataDir); // Read-only recovery, independently gated; never submits.
  if (process.env.GENERATIONS_ENABLED === "false") {
    await new Promise((resolve) => setTimeout(resolve, 750));
    continue;
  }
  // Only reclaim a lease after the maximum FFmpeg execution time has elapsed.
  const abandoned = db
    .prepare("SELECT id FROM jobs WHERE status='processing'")
    .all() as { id: string }[];
  for (const { id } of abandoned)
    if (Date.now() - job(id).updated > 10 * 60000) {
      try {
        transition(id, "failed", {
          error:
            "Worker interrupted. Demo credits restored. Submit a new request to retry.",
          stage: "Interrupted",
        });
      } catch {}
    }
  const claimed = transaction(() => {
    const row = db
      .prepare(
        "SELECT id FROM jobs WHERE status='queued' ORDER BY rowid LIMIT 1",
      )
      .get() as { id: string } | undefined;
    if (!row) return null;
    const j = job(row.id);
    const updated = {
      ...j,
      status: "processing" as const,
      stage: "Preparing your audio",
      updated: Date.now(),
    };
    db.prepare("UPDATE jobs SET status=?,data=? WHERE id=?").run(
      updated.status,
      JSON.stringify(updated),
      j.id,
    );
    return updated;
  });
  if (!claimed) {
    await new Promise((r) => setTimeout(r, 750));
    continue;
  }
  const trimmed = path.join(dataDir, "media", `${claimed.id}-clip.mp3`);
  const outputId = randomUUID(),
    output = path.join(dataDir, "media", `${outputId}.mp4`);
  try {
    const source = asset(claimed.songId, claimed.owner);
    asset(claimed.imageId, claimed.owner);
    await trimAudio(source.path, trimmed, claimed.start, claimed.end);
    // An included fixed sample, never represented as generated from customer assets.
    await copyFile(path.resolve("public/media/demo.mp4"), output);
    const p = await probe(output);
    if (
      !p.streams.some(
        (s) => s.codec_type === "video" && s.width === 1280 && s.height === 720,
      )
    )
      throw new Error("Invalid demo output");
    const { size } = await (await import("node:fs/promises")).stat(output);
    putAsset({
      id: outputId,
      owner: claimed.owner,
      kind: "video",
      name: "singmotion-demo-sample.mp4",
      path: output,
      mime: "video/mp4",
      bytes: size,
      duration: Number(p.format.duration),
      width: 1280,
      height: 720,
      created: Date.now(),
    });
    transition(claimed.id, "completed", {
      outputId,
      stage: "Demo sample ready",
    });
  } catch (error) {
    console.error(
      "Job failed:",
      claimed.id,
      error instanceof Error ? error.message : "Unknown error",
    );
    transition(claimed.id, "failed", {
      error:
        "Media preparation failed. Check your files and try a new generation. Demo credits were restored.",
      stage: "Failed",
    });
    await unlink(output).catch(() => {});
  } finally {
    await unlink(trimmed).catch(() => {});
  }
}
db.close();
