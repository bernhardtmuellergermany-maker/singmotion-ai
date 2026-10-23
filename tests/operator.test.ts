import { test, after, beforeEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  copyFile,
  readFile,
  rm,
  stat,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import net from "node:net";
import tls from "node:tls";
import sharp from "sharp";
import { S3Client } from "@aws-sdk/client-s3";
import { R2PrivateInputDelivery, r2ClientConfig } from "../lib/live/r2.ts";
import { inputDeliveryPolicy } from "../lib/live/input-policy.ts";
import { OperatorWorkflow } from "../lib/live/operator.ts";
import { LiveTestStore, confirmationPhrase } from "../lib/live/store.ts";
import { prepareStudioDraft } from "../lib/live/media.ts";
import {
  BytePlusProtocol,
  DocumentedBytePlusProvider,
} from "../lib/live/byteplus.ts";
import { createSignedTransport } from "../lib/live/signed-transport.ts";
import type { VerifiedContract } from "../lib/live/contract.ts";
import { liveTestConfig } from "../lib/live/config.ts";

const root = await mkdtemp(path.join(tmpdir(), "singmotion backend mock "));
process.env.DATA_DIR = root;
process.env.DEMO_MODE = "true";
process.env.GENERATIONS_ENABLED = "false";
const db = await import("../lib/db.ts");
const stores: LiveTestStore[] = [],
  clients: S3Client[] = [];
after(async () => {
  for (const client of clients) client.destroy();
  for (const store of stores) {
    try {
      store.close();
    } catch {}
  }
  db.db.close();
  await rm(root, { recursive: true, force: true });
});
beforeEach((context) => {
  const t = context as TestContext;
  const denied = () => {
    throw Error("Network forbidden in backend rehearsal");
  };
  t.mock.method(net.Socket.prototype, "connect", denied);
  t.mock.method(tls, "connect", denied);
  t.mock.method(globalThis, "fetch", denied);
});
const r2 = {
  accountId: "0".repeat(32),
  bucket: "singmotion-ai-private",
  accessKeyId: "fake-r2-ak",
  secretAccessKey: "fake-r2-sk",
};
const contract: VerifiedContract = {
  revision: "fictional-backend-v1",
  model: "OmniHuman 2.0",
  documentationUrl: "https://example.test/fictional",
  maxDurationSeconds: 300,
  promptSupported: true,
  inputFetchWindowSeconds: inputDeliveryPolicy.minimumRemainingSeconds,
  billing: {
    microUsdPerSecond: 10000,
    minimumBillableMs: 1000,
    billingQuantumMs: 1000,
    minimumChargeMicroUsd: 0,
    fixedFeeMicroUsd: 0,
    taxBasisPointsUpperBound: 0,
  },
  output: { width: 1280, height: 720, fps: 25, durationToleranceSeconds: 0.2 },
  outputHosts: ["output.example.test"],
};
const secret = "fictional-backend-operator-secret-at-least-32";
const config = {
  ...liveTestConfig({}),
  demoMode: false,
  enabled: true,
  operatorSecret: secret,
  maxDurationSeconds: 11,
  maxJobMicroUsd: 1000000,
  maxTotalMicroUsd: 1000000,
};
const owner = db.createSession().owner;
const audio = path.join(root, "media", "song.mp3"),
  image = path.join(root, "media", "singer.png");
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
  audio,
]);
await sharp({
  create: { width: 300, height: 300, channels: 3, background: "#8899aa" },
})
  .png()
  .toFile(image);
for (const [id, kind, file, mime] of [
  ["song", "audio", audio, "audio/mpeg"],
  ["singer", "image", image, "image/png"],
] as const)
  db.putAsset({
    id,
    owner,
    kind,
    path: file,
    mime,
    name: id,
    bytes: (await stat(file)).size,
    duration: kind === "audio" ? 12 : null,
    width: null,
    height: null,
    created: Date.now(),
  });
const video = await readFile("public/media/demo.mp4");
async function fixture() {
  const file = path.join(root, `${randomUUID()}.sqlite`),
    store = new LiveTestStore(file);
  stores.push(store);
  const media = await prepareStudioDraft(
    {
      version: 1,
      owner,
      songId: "song",
      imageId: "singer",
      start: 0,
      end: 10,
      performance: "Natural",
      camera: "Static Close-Up",
      customPrompt: `Sing softly. ${randomUUID()}`,
    },
    owner,
    11,
  );
  media.promptLanguageConfirmed = true;
  const attempt = store.prepare(media, null, null);
  const calls: string[] = [],
    storageCalls: { method: string; path: string }[] = [];
  let mode = "complete";
  const transport = createSignedTransport(
    async (raw, init) => {
      assert.match(
        new Headers(init?.headers).get("authorization")!,
        /HMAC-SHA256/,
      );
      const action = new URL(String(raw)).searchParams.get("Action")!;
      calls.push(action);
      const body = JSON.parse(String(init?.body));
      let data: unknown;
      if (action === "CVSync2AsyncSubmitTask") {
        assert.equal(body.prompt, media.prompt);
        assert.equal(body.image_urls.length, 1);
        assert.equal(
          new URL(body.audio_url).searchParams.get("X-Amz-Expires"),
          "46800",
        );
        if (mode === "submit-timeout") throw Error("secret uncertain timeout");
        data = { task_id: "mock-task" };
      } else {
        assert.equal(body.task_id, "mock-task");
        if (action === "CVCancelTask") {
          if (mode === "cancel-timeout") throw Error("secret cancel timeout");
          data = {};
        } else if (mode === "poll-error")
          return new Response(JSON.stringify({ code: 50500 }), { status: 503 });
        else
          data =
            mode === "failure"
              ? { status: "not_found" }
              : ["queued", "cancel-timeout"].includes(mode)
                ? { status: "in_queue" }
                : {
                    status: "done",
                    video_url: "https://output.example.test/video.mp4",
                  };
      }
      return new Response(JSON.stringify({ code: 10000, data }), {
        status: 200,
      });
    },
    () => ({ accessKeyId: "fake-ak", secretAccessKey: "fake-sk" }),
  );
  function connect(s = store, reviewed = contract) {
    const client = new S3Client({
      ...r2ClientConfig(r2),
      requestHandler: {
        async handle(request: { method: string; path: string }) {
          storageCalls.push({ method: request.method, path: request.path });
          return {
            response: { statusCode: 200, headers: {}, body: Readable.from([]) },
          };
        },
      },
    });
    clients.push(client);
    const delivery = new R2PrivateInputDelivery(s, root, r2, client);
    const provider = new DocumentedBytePlusProvider(
      reviewed,
      delivery,
      delivery.inputHosts,
      new BytePlusProtocol(transport),
    );
    return new OperatorWorkflow(s, config, root, {
      verifiedContract: () => reviewed,
      provider,
      cleanupInputs: (id, signal) => delivery.cleanupExpired(id, signal),
    });
  }
  const operator = connect();
  async function approved() {
    const plan = await operator.price(attempt.id, owner);
    return operator.approve(plan.id, owner, secret, confirmationPhrase(plan));
  }
  return {
    file,
    store,
    attempt,
    media,
    calls,
    storageCalls,
    connect,
    operator,
    approved,
    mode: (v: string) => {
      mode = v;
    },
  };
}

test("draft review -> atomic pricing -> approval -> signed submission -> restart/poll -> validated MP4 -> scoped cleanup", async (t) => {
  const f = await fixture();
  const other = new LiveTestStore(f.file);
  stores.push(other);
  const plans = await Promise.all([
    f.operator.price(f.attempt.id, owner),
    f.connect(other).price(f.attempt.id, owner),
  ]);
  assert.equal(plans[0].id, plans[1].id);
  assert.ok(plans[0].contractDigest);
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS n FROM live_contract_reviews").get()!
      .n,
    1,
  );
  const token = await f.operator.approve(
    plans[0].id,
    owner,
    secret,
    confirmationPhrase(plans[0]),
  );
  const submissions = await Promise.allSettled([
    f.operator.submit(plans[0].id, owner, token, secret),
    f.connect(other).submit(plans[0].id, owner, token, secret),
  ]);
  assert.equal(
    submissions.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(other.get(plans[0].id).providerJobId, "mock-task");
  await assert.rejects(f.operator.submit(plans[0].id, owner, token, secret));
  f.store.close();
  const restarted = f.connect(other);
  f.mode("poll-error");
  await assert.rejects(restarted.poll(plans[0].id, owner, secret));
  assert.equal(other.get(plans[0].id).providerJobId, "mock-task");
  f.mode("queued");
  assert.equal(
    (await restarted.poll(plans[0].id, owner, secret)).state,
    "processing",
  );
  f.mode("complete");
  t.mock.method(globalThis, "fetch", async (url: URL, init: RequestInit) => {
    assert.equal(url.hostname, "output.example.test");
    assert.equal(init.redirect, "manual");
    return new Response(video);
  });
  const result = await restarted.poll(plans[0].id, owner, secret);
  assert.equal(result.state, "completed");
  assert.ok(
    result.outputPath!.startsWith(path.join(root, "live-output") + path.sep),
  );
  assert.deepEqual(await readFile(result.outputPath!), video);
  const reservation = other.db
    .prepare("SELECT reserved_micro_usd FROM live_attempts WHERE id=?")
    .get(result.id);
  const expiry = other.inputDelivery(result.id).manifest.expiresAt;
  t.mock.method(Date, "now", () => expiry + 3600000);
  await restarted.cleanup(
    result.id,
    owner,
    secret,
    new AbortController().signal,
  );
  assert.equal(other.inputDelivery(result.id).state, "cleaned");
  assert.deepEqual(
    f.storageCalls.map((r) => r.method),
    ["PUT", "PUT", "DELETE", "DELETE"],
  );
  assert.deepEqual(
    other.db
      .prepare("SELECT reserved_micro_usd FROM live_attempts WHERE id=?")
      .get(result.id),
    reservation,
  );
  assert.equal(f.calls.filter((c) => c === "CVSync2AsyncSubmitTask").length, 1);
  assert.doesNotMatch(
    JSON.stringify(other.get(result.id)),
    /fake-ak|fake-sk|X-Amz|video_url/,
  );
});

test("default verification, owner, changed same-revision contract and unknown cost cannot advance a plan", async () => {
  const f = await fixture();
  await assert.rejects(
    new OperatorWorkflow(f.store, config, root).price(f.attempt.id, owner),
    /not verified/,
  );
  await assert.rejects(f.operator.price(f.attempt.id, "other-owner"), /Owned/);
  const priced = await f.operator.price(f.attempt.id, owner);
  const changed = f.connect(f.store, {
    ...contract,
    output: { ...contract.output, fps: 30 },
  });
  await assert.rejects(changed.price(priced.id, owner), /immutable/);
  await assert.rejects(
    changed.approve(priced.id, owner, secret, confirmationPhrase(priced)),
    /full reviewed/,
  );
  await assert.rejects(
    f.operator.approve(
      priced.id,
      owner,
      "incorrect",
      confirmationPhrase(priced),
    ),
    /denied/,
  );
  assert.equal(f.calls.length, 0);
  assert.equal(f.storageCalls.length, 0);
});

for (const mode of ["submit-timeout", "failure", "cancel-timeout", "queued"]) {
  test(`durable failure/cancellation lifecycle: ${mode}`, async () => {
    const f = await fixture(),
      token = await f.approved();
    f.mode(mode);
    const submitted = await f.operator.submit(
      f.attempt.id,
      owner,
      token,
      secret,
    );
    if (mode === "submit-timeout") {
      assert.equal(submitted.state, "uncertain");
      await assert.rejects(f.operator.poll(f.attempt.id, owner, secret));
    } else if (mode === "failure")
      assert.equal(
        (await f.operator.poll(f.attempt.id, owner, secret)).state,
        "failed",
      );
    else if (mode === "queued") {
      assert.equal(
        (await f.operator.cancel(f.attempt.id, owner, secret)).failureCode,
        "PROVIDER_TASK_CANCELED",
      );
      await assert.rejects(f.operator.cancel(f.attempt.id, owner, secret));
    } else {
      await assert.rejects(
        f.operator.cancel(f.attempt.id, owner, secret),
        /unknown/,
      );
      await assert.rejects(f.operator.cancel(f.attempt.id, owner, secret));
      assert.equal(
        (await f.operator.poll(f.attempt.id, owner, secret)).state,
        "processing",
      );
    }
    await assert.rejects(f.operator.submit(f.attempt.id, owner, token, secret));
    assert.equal(
      f.calls.filter((c) => c === "CVSync2AsyncSubmitTask").length,
      1,
    );
    assert.ok(f.calls.filter((c) => c === "CVCancelTask").length <= 1);
    assert.ok(
      Number(
        f.store.db
          .prepare("SELECT reserved_micro_usd FROM live_attempts WHERE id=?")
          .get(f.attempt.id)!.reserved_micro_usd,
      ) > 0,
    );
  });
}

test("crash recovery validates a committed final file before contacting an expired provider", async () => {
  const f = await fixture(),
    token = await f.approved();
  await f.operator.submit(f.attempt.id, owner, token, secret);
  const out = path.join(root, "live-output", `${f.attempt.id}.mp4`);
  await mkdir(path.dirname(out), { recursive: true });
  await copyFile("public/media/demo.mp4", out);
  f.mode("poll-error");
  const reopened = new LiveTestStore(f.file);
  stores.push(reopened);
  const result = await f.connect(reopened).poll(f.attempt.id, owner, secret);
  assert.equal(result.state, "completed");
  assert.equal(f.calls.length, 1);
});

test("crashed submission claims and stale poll leases cannot be replayed or commit output", async (t) => {
  const f = await fixture(),
    token = await f.approved();
  f.store.claimSubmission(f.attempt.id, token, config);
  await assert.rejects(f.operator.submit(f.attempt.id, owner, token, secret));
  assert.equal(f.calls.length, 0); // Even a crash before HTTP is not proof that replay is safe.
  f.store.transition(f.attempt.id, "submitted", { providerJobId: "mock-task" });
  const old = f.store.claimPoll(f.attempt.id);
  const clock = Date.now();
  t.mock.method(Date, "now", () => clock + 601000);
  const reopened = new LiveTestStore(f.file);
  stores.push(reopened);
  const current = reopened.claimPoll(f.attempt.id);
  let renamed = false;
  assert.throws(
    () =>
      f.store.transition(
        f.attempt.id,
        "completed",
        { outputPath: "unused" },
        old,
        () => {
          renamed = true;
        },
      ),
    /stale worker/,
  );
  assert.equal(renamed, false);
  f.store.releasePoll(f.attempt.id, old);
  reopened.assertPollLease(f.attempt.id, current);
  reopened.releasePoll(f.attempt.id, current);
});

test("invalid MP4 is removed and all production CLI mutations remain hard-blocked", async (t) => {
  const f = await fixture(),
    token = await f.approved();
  await f.operator.submit(f.attempt.id, owner, token, secret);
  t.mock.method(globalThis, "fetch", async () => new Response("invalid MP4"));
  assert.equal(
    (await f.operator.poll(f.attempt.id, owner, secret)).state,
    "failed",
  );
  assert.equal(
    (await readdir(path.join(root, "live-output"))).some((name) =>
      name.startsWith(f.attempt.id),
    ),
    false,
  );
  const reviewStore = new LiveTestStore(path.join(root, "live-test.sqlite"));
  stores.push(reviewStore);
  const localPlan = reviewStore.prepare(f.media, null, null);
  const reviewArgs = [
    "--import",
    "./tests/fixtures/offline-network-guard.mjs",
    "--experimental-strip-types",
    "scripts/byteplus-operator.ts",
    "review",
    "--plan",
    localPlan.id,
    "--owner",
  ];
  const reviewEnv = {
    NODE_ENV: "test" as const,
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    DATA_DIR: root,
    DEMO_MODE: "true",
  };
  const reviewed = spawnSync(process.execPath, [...reviewArgs, owner], {
    env: reviewEnv,
    encoding: "utf8",
  });
  assert.equal(reviewed.status, 0);
  const summary = JSON.parse(reviewed.stdout);
  assert.equal(summary.planId, localPlan.id);
  assert.equal(summary.upperBoundMicroUsd, null);
  assert.equal(summary.liveSubmissionEnabled, false);
  assert.doesNotMatch(
    reviewed.stdout,
    /audioPath|imagePath|secretAccessKey|token_hash/,
  );
  const wrongOwner = spawnSync(
    process.execPath,
    [...reviewArgs, "other-owner"],
    { env: reviewEnv, encoding: "utf8" },
  );
  assert.equal(wrongOwner.status, 1);
  assert.match(wrongOwner.stderr, /Owned plan not found/);
  for (const action of [
    "price",
    "approve",
    "submit",
    "poll",
    "cancel",
    "cleanup",
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "./tests/fixtures/offline-network-guard.mjs",
        "--experimental-strip-types",
        "scripts/byteplus-operator.ts",
        action,
      ],
      {
        env: {
          NODE_ENV: "test",
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          DATA_DIR: root,
          DEMO_MODE: "true",
        },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /No provider request was made/);
  }
});
