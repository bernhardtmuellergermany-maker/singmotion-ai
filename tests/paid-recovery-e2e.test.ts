import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// No remote HTTP, Stripe charge or BytePlus generation is performed here.
test("offline sandbox payment -> acknowledged status -> validated private MP4 -> owned delivery", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "singmotion-paid-e2e-"));
  const before = process.env.DATA_DIR;
  process.env.DATA_DIR = root;
  let store: import("../lib/commerce/store.ts").CommerceStore | undefined;
  try {
    const [{ CommerceStore }, { runPaidRecoveryBatch }, { asset, db }] = await Promise.all([
      import("../lib/commerce/store.ts"),
      import("../lib/commerce/paid-recovery-batch.ts"),
      import("../lib/db.ts"),
    ]);
    const { runPaidRecoveryCommand } = await import("../scripts/paid-recovery-worker.ts");
    await assert.rejects(runPaidRecoveryCommand(["--once","--review-file","/never-read",
      "--confirm-sha256","a".repeat(64)], {}), /staging environment/);
    assert.deepEqual(await runPaidRecoveryCommand(["--dry-run"]), {
      mode:"dry-run", acknowledged:0, networkRequests:0, generatedTasks:0,
    });
    store = new CommerceStore(path.join(root, "commerce.sqlite"));
    const owner = "11111111-1111-4111-8111-111111111111";
    const media = {
      sourceJobId: "offline-prepared-source", promptLanguageConfirmed: true,
      owner: "customer-" + owner,
      audioPath: "/private/input-audio.wav",
      imagePath: "/private/input-image.png",
      audioSha256: "a".repeat(64), imageSha256: "b".repeat(64),
      durationSeconds: 5, prompt: "Sing naturally", outputFormat: "9:16" as const,
    };
    const id = store.preparedVideoOrder({
      account: owner, email: "customer@example.test", project: "offline-sandbox-e2e",
      cents: 125, quoteEvidence: "verified-offline-sandbox-quote-2026",
      key: "offline-sandbox-e2e", media,
    }).id;
    store.bindStripeCheckout(id, "cs_test_offline_e2e");
    const receipt = { provider: "stripe", eventId: "evt_offline_e2e", orderId: id,
      cents: 125, currency: "EUR" as const, evidence: "cs_test_offline_e2e" };
    await store.webhook(new Uint8Array(), "signed", { async verify() { return receipt; } });
    await store.webhook(new Uint8Array(), "signed", { async verify() { return receipt; } });
    assert.equal(store.db.prepare("SELECT status FROM customer_orders WHERE id=?").get(id)?.status, "paid");
    assert.equal(store.pendingPaidFulfillment().length, 1);
    assert.equal(store.claimPaidFulfillment(id), true);
    assert.equal(store.beginPaidProviderSubmission(id), true);
    store.recordPaidProviderJob(id, "byteplus", "task_offline_e2e");
    assert.deepEqual(store.acknowledgedPaidRecovery(), [id]);

    const fixture = path.join(root, "sample.mp4");
    await promisify(execFile)("ffmpeg", [
      "-nostdin", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=160x284:r=25:d=5",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=5",
      "-c:v", "libx264", "-threads", "2", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-shortest", "-movflags", "+faststart", fixture,
    ], { timeout: 60000 });
    const bytes = await readFile(fixture);
    const contract = { outputHosts: ["outputs.example.test"],
      output: { width: 160, height: 284, fps: 25,
        durationToleranceSeconds: 0.1, maxDurationSeconds: 300 } };
    let statusReads = 0, downloads = 0, submits = 0;
    const statusTransport = async (request: {url:string}) => {
      assert.match(request.url, /CVSync2AsyncGetResult/);
      if (request.url.includes("CVSync2AsyncSubmitTask")) submits++;
      statusReads++;
      return { status: 200, body: {code: 10000, data: {
        status: "done", video_url: "https://outputs.example.test/result.mp4",
      }}};
    };
    const outputTransport = async (url: URL) => {
      assert.equal(url.hostname, "outputs.example.test");
      downloads++;
      return new Response(bytes, { status: 200,
        headers: { "content-length": String(bytes.length) } });
    };
    const result = await runPaidRecoveryBatch(store, root, contract, statusTransport,
      outputTransport, new AbortController().signal, 10);
    assert.deepEqual(result, [{orderId:id,state:"delivered"}]);
    assert.equal(statusReads, 1);
    assert.equal(downloads, 1);
    assert.equal(submits, 0);
    const privateAssetId = store.ownedDeliveredVideoAsset(id, owner);
    assert.equal(privateAssetId, "customer-video-" + id);
    assert.throws(() => store!.ownedDeliveredVideoAsset(id, "22222222-2222-4222-8222-222222222222"));
    const video = asset(privateAssetId!, "customer-" + owner);
    assert.equal(video.mime, "video/mp4");
    assert.equal(video.bytes, bytes.length);
    assert.deepEqual(await runPaidRecoveryBatch(store, root, contract, statusTransport,
      outputTransport, new AbortController().signal, 10), []);
    assert.equal(statusReads, 1);
    assert.equal(downloads, 1);
    db.close();
  } finally {
    store?.close();
    if (before === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = before;
    await rm(root, { recursive: true, force: true });
  }
});
