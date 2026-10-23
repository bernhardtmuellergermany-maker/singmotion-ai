import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  stat,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import net from "node:net";
import tls from "node:tls";
import sharp from "sharp";
import {
  composePrompt,
  validateSelection,
  quote,
  type Job,
} from "../lib/domain.ts";
import { validateAudio, probe } from "../lib/media.ts";
import { prepareExistingJob, revalidateMedia } from "../lib/live/media.ts";
import { LiveTestStore, confirmationPhrase } from "../lib/live/store.ts";
import { liveTestConfig } from "../lib/live/config.ts";
import { upperBoundMicroUsd } from "../lib/live/contract.ts";

test("offline studio selection to real preflight CLI, immutable snapshots and mock approval", async (t) => {
  let networkAttempts = 0;
  const deny = () => {
    networkAttempts++;
    throw Error("No network permitted");
  };
  t.mock.method(globalThis, "fetch", deny);
  t.mock.method(net.Socket.prototype, "connect", deny);
  t.mock.method(tls, "connect", deny);
  const root = await mkdtemp(path.join(tmpdir(), "singmotion-offline-"));
  process.env.DATA_DIR = root;
  process.env.DEMO_MODE = "true";
  const storage = await import("../lib/db.ts");
  let ledger: LiveTestStore | undefined;
  try {
    await mkdir(path.join(root, "media"), { recursive: true });
    const songPath = path.join(root, "media", "original.mp3");
    const imagePath = path.join(root, "media", "reference.png");
    execFileSync("ffmpeg", [
      "-nostdin",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=12",
      "-codec:a",
      "libmp3lame",
      songPath,
    ]);
    // Synthetic reference tests media plumbing; it does not assert face suitability.
    await sharp({
      create: { width: 512, height: 512, channels: 3, background: "#8899aa" },
    })
      .png()
      .toFile(imagePath);
    const duration = await validateAudio(songPath);
    const { owner } = storage.createSession();
    const songId = randomUUID(),
      imageId = randomUUID();
    for (const [id, kind, file, mime] of [
      [songId, "audio", songPath, "audio/mpeg"],
      [imageId, "image", imagePath, "image/png"],
    ] as const)
      storage.putAsset({
        id,
        owner,
        kind,
        path: file,
        mime,
        name: path.basename(file),
        bytes: (await stat(file)).size,
        duration: kind === "audio" ? duration : null,
        width: kind === "image" ? 512 : null,
        height: kind === "image" ? 512 : null,
        created: Date.now(),
      });
    storage.saveArtist({
      id: randomUUID(),
      owner,
      name: "Offline synthetic artist",
      images: [{ assetId: imageId, label: "Front" }],
      created: Date.now(),
    });
    const selection = validateSelection(2, 7, duration);
    const prompt = composePrompt("Natural", "Slow Push-In", "");
    assert.match(prompt, /Natural singing performance\. Slow Push-In/);
    assert.equal(
      composePrompt(
        "Natural",
        "Slow Push-In",
        "  Sing gently with a static camera.  ",
      ),
      "Sing gently with a static camera.",
    );
    const job: Job = {
      id: randomUUID(),
      owner,
      requestKey: randomUUID(),
      songId,
      imageId,
      artistName: "Offline synthetic artist",
      start: 2,
      end: 7,
      performance: "Natural",
      camera: "Slow Push-In",
      prompt,
      price: quote(selection).cents,
      status: "queued",
      stage: "Queued",
      outputId: null,
      error: null,
      created: Date.now(),
      updated: Date.now(),
      saved: false,
      demo: true,
    };
    storage.enqueue(job);
    const prepared = await prepareExistingJob(job.id, owner, 6);
    assert.equal(prepared.prompt, prompt);
    assert.equal(prepared.promptLanguageConfirmed, false);
    const encoded = await probe(prepared.audioPath);
    assert.equal(
      encoded.streams.find((s) => s.codec_type === "audio")?.codec_name,
      "mp3",
    );
    assert.equal(prepared.durationSeconds, Number(encoded.format.duration));
    assert.ok(prepared.durationSeconds >= 5 && prepared.durationSeconds < 5.2);
    for (const [file, hash] of [
      [prepared.audioPath, prepared.audioSha256],
      [prepared.imagePath, prepared.imageSha256],
    ]) {
      assert.equal(
        createHash("sha256")
          .update(await readFile(file))
          .digest("hex"),
        hash,
      );
      assert.ok(file.includes(hash));
    }
    assert.deepEqual(
      await readFile(prepared.imagePath),
      await readFile(imagePath),
    );
    assert.deepEqual(await prepareExistingJob(job.id, owner, 6), prepared);
    await assert.rejects(revalidateMedia(prepared), /English/);
    await revalidateMedia({ ...prepared, promptLanguageConfirmed: true });
    await assert.rejects(
      prepareExistingJob(job.id, "another-owner", 6),
      /not found/,
    );
    // Requested 5 s fits, encoded MP3 padding does not. No temp clip may remain.
    await assert.rejects(prepareExistingJob(job.id, owner, 5), /Encoded MP3/);
    assert.equal(
      (await readdir(path.join(root, "media"))).some((name) =>
        name.startsWith("clip-"),
      ),
      false,
    );

    const childEnv = {
      ...process.env,
      DATA_DIR: root,
      DEMO_MODE: "true",
      BYTEPLUS_LIVE_TEST_ENABLED: "false",
      BYTEPLUS_LIVE_TEST_MAX_DURATION_SECONDS: "6",
    };
    // Never pass developer credentials into the offline subprocess.
    for (const name of Object.keys(childEnv))
      if (
        /^(BYTEPLUS_|R2_)/.test(name) &&
        ![
          "BYTEPLUS_LIVE_TEST_ENABLED",
          "BYTEPLUS_LIVE_TEST_MAX_DURATION_SECONDS",
        ].includes(name)
      )
        delete (childEnv as Record<string, string | undefined>)[name];
    const baseArgs = [
      "--import",
      "./tests/fixtures/offline-network-guard.mjs",
      "--experimental-strip-types",
    ];
    const args = [
      ...baseArgs,
      "scripts/byteplus-preflight.ts",
      "--job",
      job.id,
      "--owner",
      owner,
      "--confirm-english",
    ];
    const run = () =>
      JSON.parse(
        execFileSync(process.execPath, args, {
          env: childEnv,
          encoding: "utf8",
        }),
      );
    const plan = run();
    assert.deepEqual(run(), plan);
    assert.equal(plan.status, "prepared");
    assert.equal(plan.paidSubmissionEnabled, false);
    assert.equal(plan.estimatedProviderCharge, null);
    assert.equal(plan.preparedMp3Seconds, prepared.durationSeconds);
    assert.deepEqual(plan.review, {
      audioSha256: prepared.audioSha256,
      imageSha256: prepared.imageSha256,
      composedPrompt: prompt,
    });
    ledger = new LiveTestStore(path.join(root, "live-test.sqlite"));
    const persisted = ledger.get(plan.planId);
    assert.deepEqual(persisted.media, {
      ...prepared,
      promptLanguageConfirmed: true,
    });
    const defaults = liveTestConfig({});
    assert.throws(
      () =>
        ledger!.authorize(
          plan.planId,
          defaults,
          "unused",
          confirmationPhrase(persisted),
        ),
      /disabled/,
    );
    const mockConfig = {
      ...defaults,
      demoMode: false,
      enabled: true,
      operatorSecret: "fictional-offline-operator-secret-123456",
      maxJobMicroUsd: 1_000_000,
      maxTotalMicroUsd: 1_000_000,
    };
    assert.throws(
      () =>
        ledger!.authorize(
          plan.planId,
          mockConfig,
          mockConfig.operatorSecret,
          confirmationPhrase(persisted),
        ),
      /unknown billing/,
    );
    // Fictional billing and a separate mock source ID; never promote the real plan.
    const cost = upperBoundMicroUsd(prepared.durationSeconds, {
      microUsdPerSecond: 100_000,
      minimumBillableMs: 1000,
      billingQuantumMs: 1000,
      minimumChargeMicroUsd: 0,
      fixedFeeMicroUsd: 0,
      taxBasisPointsUpperBound: 0,
    });
    const mock = ledger.prepare(
      { ...persisted.media, sourceJobId: randomUUID() },
      "offline-fictional-only",
      cost,
    );
    assert.throws(
      () =>
        ledger!.authorize(
          mock.id,
          { ...mockConfig, maxJobMicroUsd: cost - 1 },
          mockConfig.operatorSecret,
          confirmationPhrase(mock),
        ),
      /cap/,
    );
    assert.throws(
      () =>
        ledger!.authorize(
          mock.id,
          mockConfig,
          mockConfig.operatorSecret,
          "incorrect confirmation",
        ),
      /confirmation/,
    );
    const token = ledger.authorize(
      mock.id,
      mockConfig,
      mockConfig.operatorSecret,
      confirmationPhrase(mock),
    );
    const second = ledger.prepare(
      { ...persisted.media, sourceJobId: randomUUID() },
      "offline-fictional-only",
      cost,
    );
    assert.throws(
      () =>
        ledger!.authorize(
          second.id,
          mockConfig,
          mockConfig.operatorSecret,
          confirmationPhrase(second),
        ),
      /Total/,
    );
    ledger.claimSubmission(mock.id, token, mockConfig);
    assert.throws(
      () => ledger!.claimSubmission(mock.id, token, mockConfig),
      /consumed/,
    );
    assert.equal(ledger.get(plan.planId).state, "prepared");
    const blocked = spawnSync(
      process.execPath,
      [...baseArgs, "scripts/byteplus-live-test.ts"],
      { env: childEnv, encoding: "utf8" },
    );
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /No provider request was made/);
    // Editing the original does not alter the approved snapshot; tampering does.
    await writeFile(imagePath, "changed original");
    await revalidateMedia(persisted.media);
    await writeFile(prepared.imagePath, "tampered snapshot");
    await assert.rejects(revalidateMedia(persisted.media));
    assert.equal(networkAttempts, 0);
  } finally {
    ledger?.close();
    storage.db.close();
    await rm(root, { recursive: true, force: true });
  }
});
