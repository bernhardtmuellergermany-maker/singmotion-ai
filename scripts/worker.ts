import { pollStudioProjects } from "../lib/live/studio-worker.ts";
import {productionCustomerReleaseApproved} from "../lib/commerce/customer-live-config.ts";
import {retryPendingWithdrawalReceipts} from "../lib/commerce/consumer-rights.ts";
import {retryVideoReadyNotifications} from "../lib/commerce/video-ready-notifications.ts";
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
import { ensureLocalAsset } from "../lib/cloud-hydration.ts";
import { customerR2Enabled, mirrorPrivateSource, readMirroredPrivateSource } from "../lib/cloud-media.ts";

// In approved Live production, demo sample generation is forbidden, but
// the dedicated customer worker must still be able to serve paid orders.
const approvedLiveCustomer=process.env.DEMO_MODE==="false" &&
  productionCustomerReleaseApproved(process.env) &&
  process.env.PRODUCTION_PUBLIC_ACCESS_ENABLED==="true";
if(!approvedLiveCustomer)demoOnly();
let nextCustomerPaidPoll=0;
let nextWithdrawalReceiptRetry=0;
let nextVideoReadyEmailRetry=0;
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
console.log(
  "SingMotion worker ready. Demo and Studio recovery are separate; paid customer dispatch requires independently reviewed policy, bounded spend and explicit staging enablement.",
);
while (!stopping) {
  await writeFile(path.join(dataDir, "worker-heartbeat"), String(Date.now()));
  await pollStudioProjects(dataDir); // Read-only recovery, independently gated; never submits.
  if(Date.now()>=nextWithdrawalReceiptRetry){
    nextWithdrawalReceiptRetry=Date.now()+60_000;
    try{await retryPendingWithdrawalReceipts(path.join(dataDir,"commerce.sqlite"));}
    catch{console.warn("Withdrawal confirmation outbox retry unavailable");}
  }
  if(Date.now()>=nextVideoReadyEmailRetry){
    nextVideoReadyEmailRetry=Date.now()+60_000;
    try{await retryVideoReadyNotifications(path.join(dataDir,"commerce.sqlite"));}
    catch{console.warn("Video-ready mail outbox retry unavailable");}
  }
  // A separately reviewed contract, TEST Stripe key, private R2 and two explicit
  // customer worker flags are all required before automatic paid processing.
  // With the safe defaults this is inert and the demo worker is unchanged.
  if(Date.now()>=nextCustomerPaidPoll){
    nextCustomerPaidPoll=Date.now()+30_000;
    if(process.env.CUSTOMER_PAID_WORKER_ENABLED==="true"){
      try{
        const {runCustomerPaidWorkerBatch}=await import("../lib/commerce/customer-paid-worker.ts");
        const outcome=await runCustomerPaidWorkerBatch(dataDir);
        if(outcome.status==="ready" &&
           (outcome.submitted||outcome.uncertain||outcome.requiresReview||outcome.recovered))
          console.log("Customer video worker batch",{
            submitted:outcome.submitted,
            uncertain:outcome.uncertain,
            requiresReview:outcome.requiresReview,
            recovered:outcome.recovered,
          });
      }catch{
        // Never emit credentials, signed R2 URLs, provider output URLs or raw media
        // details into logs. A failed batch must never resubmit uncertain jobs.
        console.warn("Customer paid worker unavailable; reviewed policy or dependencies required");
      }
    }
  }
  if (approvedLiveCustomer || process.env.GENERATIONS_ENABLED === "false") {
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
    const reference = asset(claimed.imageId, claimed.owner);
    await ensureLocalAsset(source);
    await ensureLocalAsset(reference);
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
    const video = {
      id: outputId,
      owner: claimed.owner,
      kind: "video" as const,
      name: "singmotion-demo-sample.mp4",
      path: output,
      mime: "video/mp4",
      bytes: size,
      duration: Number(p.format.duration),
      width: 1280,
      height: 720,
      created: Date.now(),
    };
    // Uploaded originals may have been evicted from Railway after a verified
    // private R2 write. A generated sample is likewise durable only after
    // byte-for-byte R2 readback and an owner-bound manifest commit.
    const cloud = customerR2Enabled() ? await mirrorPrivateSource(video) : null;
    if (customerR2Enabled() && !cloud)
      throw new Error("Private sample archive was not created");
    if (cloud) {
      const verified = await readMirroredPrivateSource(video.owner, video.id, cloud, 256 * 1024 * 1024);
      if (verified.length !== video.bytes)
        throw new Error("Private sample archive is incomplete");
    }
    transaction(() => {
      putAsset(video);
      if (cloud) {
        db.exec("CREATE TABLE IF NOT EXISTS cloud_source_media(asset_id TEXT PRIMARY KEY,owner TEXT NOT NULL,key TEXT UNIQUE NOT NULL,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,created INTEGER NOT NULL)");
        db.prepare("INSERT INTO cloud_source_media(asset_id,owner,key,sha256,bytes,created) VALUES(?,?,?,?,?,?)").run(video.id,video.owner,cloud.key,cloud.sha256,cloud.bytes,Date.now());
      }
    });
    if (cloud) await unlink(output).catch(() => {});
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
