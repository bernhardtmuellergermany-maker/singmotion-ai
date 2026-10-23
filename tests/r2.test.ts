import { LiveTestRunner } from "../lib/live/runner.ts";
import {
  inputDeliveryPolicy,
  assertInputLifetime,
} from "../lib/live/input-policy.ts";
import {
  BytePlusProtocol,
  DocumentedBytePlusProvider,
} from "../lib/live/byteplus.ts";
import type { VerifiedContract } from "../lib/live/contract.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, createHash, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Readable } from "node:stream";
import { S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";
import {
  R2PrivateInputDelivery,
  loadR2Config,
  r2ClientConfig,
} from "../lib/live/r2.ts";
import {
  LiveTestStore,
  confirmationPhrase,
  type PreparedMedia,
} from "../lib/live/store.ts";
import { liveTestConfig } from "../lib/live/config.ts";
import { sha256File } from "../lib/live/media.ts";
import { validateAudio } from "../lib/media.ts";

const root = await mkdtemp(path.join(tmpdir(), "sm-r2-"));
await mkdir(path.join(root, "media"));
const audioPath = path.join(root, "media", "clip.mp3");
const imagePath = path.join(root, "media", "reference.png");
execFileSync("ffmpeg", [
  "-nostdin",
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=220:duration=4",
  "-codec:a",
  "libmp3lame",
  "-y",
  audioPath,
]);
await sharp({
  create: { width: 300, height: 300, channels: 3, background: "#aaaaaa" },
})
  .png()
  .toFile(imagePath);
const base: PreparedMedia = {
  sourceJobId: "fixture",
  owner: "private-owner",
  audioPath,
  imagePath,
  audioSha256: await sha256File(audioPath),
  imageSha256: await sha256File(imagePath),
  durationSeconds: await validateAudio(audioPath, true),
  prompt: "Sing naturally.",
  promptLanguageConfirmed: true,
};
const config = loadR2Config({
  R2_ACCOUNT_ID: "0".repeat(32),
  R2_BUCKET: "singmotion-ai-private",
  R2_ACCESS_KEY_ID: "fictional-r2-ak",
  R2_SECRET_ACCESS_KEY: "fictional-r2-sk",
});
const authorization = {
  ...liveTestConfig({}),
  demoMode: false,
  enabled: true,
  operatorSecret: "fictional-operator-secret-at-least-32-characters",
  maxDurationSeconds: 10,
  maxJobMicroUsd: 1_000_000,
  maxTotalMicroUsd: 1_000_000,
};
const stores: LiveTestStore[] = [];
after(async () => {
  for (const store of stores) store.close();
  await rm(root, { recursive: true, force: true });
});
function plan(state = "submitting", changes: Partial<PreparedMedia> = {}) {
  const file = path.join(root, randomUUID() + ".sqlite");
  const store = new LiveTestStore(file);
  stores.push(store);
  const media = { ...base, sourceJobId: randomUUID(), ...changes };
  const attempt = store.prepare(media, "fictional-reviewed-contract", 100_000);
  if (state !== "prepared") {
    const token = store.authorize(
      attempt.id,
      authorization,
      authorization.operatorSecret,
      confirmationPhrase(attempt),
    );
    if (state === "submitting")
      store.claimSubmission(attempt.id, token, authorization);
  }
  return { store, media, attempt, file };
}
interface Recorded {
  hostname: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}
function mockedClient(failAt = 0, onRequest?: () => void) {
  const requests: Recorded[] = [];
  const client = new S3Client({
    ...r2ClientConfig(config),
    requestHandler: {
      handle: async (request: Recorded) => {
        requests.push(request);
        onRequest?.();
        if (requests.length === failAt)
          throw new Error("secret signed URL and credential must be redacted");
        return {
          response: {
            statusCode: 200,
            headers: { etag: '"fixture"' },
            body: Readable.from([]),
          },
        };
      },
      destroy() {},
    },
  });
  return { client, requests };
}
const signal = () => new AbortController().signal;
function signatureFor(url: URL, method: string) {
  const hash = (s: string) => createHash("sha256").update(s).digest("hex");
  const mac = (key: string | Buffer, s: string) =>
    createHmac("sha256", key).update(s).digest();
  const encode = (s: string) =>
    encodeURIComponent(s).replace(
      /[!'()*]/g,
      (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
    );
  const query = [...url.searchParams]
    .filter(([k]) => k !== "X-Amz-Signature")
    .map(([k, v]) => [encode(k), encode(v)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const timestamp = url.searchParams.get("X-Amz-Date")!;
  const scope = `${timestamp.slice(0, 8)}/auto/s3/aws4_request`;
  const canonical = [
    method,
    url.pathname,
    query,
    `host:${url.host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const key = mac(
    mac(
      mac(mac("AWS4" + config.secretAccessKey, timestamp.slice(0, 8)), "auto"),
      "s3",
    ),
    "aws4_request",
  );
  return mac(
    key,
    ["AWS4-HMAC-SHA256", timestamp, scope, hash(canonical)].join("\n"),
  ).toString("hex");
}
test("R2 validates server-only configuration and fixes endpoint, auto region and single attempt", async () => {
  assert.throws(() => loadR2Config({}));
  assert.throws(() =>
    loadR2Config({
      R2_ACCOUNT_ID: "https://evil.test",
      R2_BUCKET: "bucket",
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret",
    }),
  );
  assert.throws(() => loadR2Config({ NEXT_PUBLIC_R2_ACCESS_KEY_ID: "key" }));
  const opts = r2ClientConfig(config);
  assert.equal(opts.region, "auto");
  assert.equal(opts.maxAttempts, 1);
  assert.equal(opts.forcePathStyle, true);
  assert.equal(
    opts.endpoint,
    `https://${config.accountId}.r2.cloudflarestorage.com`,
  );
  const { store } = plan();
  for (const ttl of [60, 3600, 43200, 46801, 604800, NaN])
    assert.throws(
      () => new R2PrivateInputDelivery(store, root, config, undefined, ttl),
    );
});
test("approved snapshots upload once, unchanged and private; presigned capabilities permit only exact-object GET", async () => {
  const { store, media, attempt, file } = plan();
  const { client, requests } = mockedClient();
  const delivery = new R2PrivateInputDelivery(store, root, config, client);
  const lease = await delivery.issue(media, signal());
  assert.equal(requests.length, 2);
  for (const [i, request] of requests.entries()) {
    assert.equal(request.method, "PUT");
    assert.equal(request.hostname, delivery.inputHosts[0]);
    assert.match(
      request.path,
      /^\/singmotion-ai-private\/byteplus-inputs\/v1\//,
    );
    assert.ok(!request.path.includes(media.owner));
    assert.equal(request.headers["if-none-match"], "*");
    assert.equal(request.headers["cache-control"], "private, no-store");
    assert.equal(request.headers["x-amz-acl"], undefined);
    assert.match(request.headers.authorization, /AWS4-HMAC-SHA256/);
    const expected = await readFile(i === 0 ? audioPath : imagePath);
    assert.deepEqual(Buffer.from(request.body as Uint8Array), expected);
    assert.equal(
      request.headers["content-md5"],
      createHash("md5").update(expected).digest("base64"),
    );
  }
  assert.equal(requests[0].headers["content-type"], "audio/mpeg");
  assert.equal(requests[1].headers["content-type"], "image/png");
  for (const raw of [lease.audioUrl, lease.imageUrl]) {
    const url = new URL(raw);
    assert.equal(url.protocol, "https:");
    assert.equal(url.hostname, delivery.inputHosts[0]);
    assert.equal(url.searchParams.get("X-Amz-Expires"), "46800");
    assert.equal(url.searchParams.get("X-Amz-SignedHeaders"), "host");
    assert.equal(
      url.searchParams.get("X-Amz-Signature"),
      signatureFor(url, "GET"),
    );
    assert.notEqual(
      url.searchParams.get("X-Amz-Signature"),
      signatureFor(url, "PUT"),
    );
    url.pathname += "-other-object";
    assert.notEqual(
      url.searchParams.get("X-Amz-Signature"),
      signatureFor(url, "GET"),
    );
    assert.ok(!raw.includes(config.secretAccessKey));
  }
  assert.equal(lease.owner, media.owner);
  assert.equal(lease.audioSha256, media.audioSha256);
  assert.ok(
    lease.expiresAt > Date.now() + 12 * 60 * 60 * 1000 &&
      lease.expiresAt <= Date.now() + 46800000,
  );
  const record = store.db
    .prepare("SELECT * FROM live_input_deliveries WHERE attempt_id=?")
    .get(attempt.id)!;
  assert.equal(record.state, "ready");
  assert.doesNotMatch(String(record.manifest), /X-Amz|https:|fictional-r2/);
  const reopened = new LiveTestStore(file);
  stores.push(reopened);
  await assert.rejects(
    new R2PrivateInputDelivery(reopened, root, config, client).issue(
      media,
      signal(),
    ),
  );
  assert.equal(requests.length, 2);
  delivery.close();
});
test("unapproved, cross-owner, altered, and outside-private-storage inputs never upload", async () => {
  const { client, requests } = mockedClient();
  for (const state of ["prepared", "authorized"]) {
    const { store, media } = plan(state);
    await assert.rejects(
      new R2PrivateInputDelivery(store, root, config, client).issue(
        media,
        signal(),
      ),
    );
  }
  const { store, media } = plan();
  const delivery = new R2PrivateInputDelivery(store, root, config, client);
  await assert.rejects(delivery.issue({ ...media, owner: "other" }, signal()));
  await assert.rejects(
    delivery.issue({ ...media, imageSha256: "changed" }, signal()),
  );
  const bad = plan("submitting", { audioSha256: "0".repeat(64) });
  await assert.rejects(
    new R2PrivateInputDelivery(bad.store, root, config, client).issue(
      bad.media,
      signal(),
    ),
  );
  const outside = path.join(root, "outside.png");
  await writeFile(outside, await readFile(imagePath));
  const escaped = plan("submitting", { imagePath: outside });
  await assert.rejects(
    new R2PrivateInputDelivery(escaped.store, root, config, client).issue(
      escaped.media,
      signal(),
    ),
  );
  const canceled = new AbortController();
  canceled.abort();
  await assert.rejects(delivery.issue(media, canceled.signal));
  assert.equal(requests.length, 0);
  delivery.close();
});
test("partial upload failures are redacted, retained for reconciliation and never automatically replayed", async () => {
  const { store, media, attempt } = plan();
  const { client, requests } = mockedClient(2);
  const delivery = new R2PrivateInputDelivery(store, root, config, client);
  await assert.rejects(
    delivery.issue(media, signal()),
    (error) =>
      error instanceof Error && !error.message.includes("secret signed"),
  );
  assert.equal(requests.length, 2);
  assert.equal(
    store.db
      .prepare("SELECT state FROM live_input_deliveries WHERE attempt_id=?")
      .get(attempt.id)!.state,
    "failed",
  );
  await assert.rejects(delivery.issue(media, signal()));
  assert.equal(requests.length, 2);
  delivery.close();
});

test("concurrent issuance shares the durable claim and uploads only one pair", async () => {
  const { store, media, file } = plan();
  const secondStore = new LiveTestStore(file);
  stores.push(secondStore);
  const { client, requests } = mockedClient();
  const a = new R2PrivateInputDelivery(store, root, config, client);
  const b = new R2PrivateInputDelivery(secondStore, root, config, client);
  const results = await Promise.allSettled([
    a.issue(media, signal()),
    b.issue(media, signal()),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(requests.length, 2);
  a.close();
});

test("existing runner consumes approval before R2 delivery and submits only the signed input leases", async () => {
  const contract: VerifiedContract = {
    revision: "fictional-reviewed-contract",
    model: "OmniHuman 2.0",
    documentationUrl: "https://example.test/fictional",
    maxDurationSeconds: 10,
    promptSupported: true,
    inputFetchWindowSeconds: 30, // Fictional test window, not provider evidence.
    billing: {
      microUsdPerSecond: 10000,
      minimumBillableMs: 1,
      billingQuantumMs: 1,
      minimumChargeMicroUsd: 100000,
      fixedFeeMicroUsd: 0,
      taxBasisPointsUpperBound: 0,
    },
    output: {
      width: 1280,
      height: 720,
      fps: 25,
      durationToleranceSeconds: 0.2,
    },
    outputHosts: [],
  };
  const { store, media, attempt } = plan("prepared");
  const { client, requests } = mockedClient();
  const delivery = new R2PrivateInputDelivery(store, root, config, client);
  let submissions = 0;
  const protocol = new BytePlusProtocol(async (request) => {
    submissions++;
    const body = JSON.parse(request.body);
    assert.equal(body.prompt, media.prompt);
    assert.equal(body.image_urls.length, 1);
    assert.equal(new URL(body.audio_url).hostname, delivery.inputHosts[0]);
    assert.match(body.image_urls[0], /X-Amz-Signature=/);
    return {
      status: 200,
      body: { code: 10000, data: { task_id: "mock-byteplus-task" } },
    };
  });
  const provider = new DocumentedBytePlusProvider(
    contract,
    delivery,
    delivery.inputHosts,
    protocol,
  );
  const runner = new LiveTestRunner(store, provider, authorization, root);
  const token = store.authorize(
    attempt.id,
    authorization,
    authorization.operatorSecret,
    confirmationPhrase(attempt),
  );
  assert.equal(
    (await runner.submitOnce(attempt.id, token)).providerJobId,
    "mock-byteplus-task",
  );
  assert.equal(requests.length, 2);
  assert.equal(submissions, 1);
  await assert.rejects(runner.submitOnce(attempt.id, token));
  assert.equal(requests.length, 2);
  delivery.close();
});

test("13-hour GET leases cover delayed fetches; cleanup waits until expiry plus grace", async (t) => {
  const issuedAt = Math.floor(Date.now() / 1000) * 1000;
  let clock = issuedAt;
  t.mock.method(Date, "now", () => clock);
  const { store, media, attempt } = plan();
  const { client, requests } = mockedClient();
  const delivery = new R2PrivateInputDelivery(store, root, config, client);
  const lease = await delivery.issue(media, signal());
  assert.equal(
    lease.expiresAt,
    issuedAt + inputDeliveryPolicy.leaseSeconds * 1000,
  );
  assertInputLifetime(lease.expiresAt);
  for (const raw of [lease.audioUrl, lease.imageUrl]) {
    const url = new URL(raw);
    assert.equal(url.searchParams.get("X-Amz-Expires"), "46800");
    assert.equal(
      url.searchParams.get("X-Amz-Signature"),
      signatureFor(url, "GET"),
    );
    // A provider fetching at the end of a 12h queue/task window still has time.
    clock = issuedAt + inputDeliveryPolicy.taskLifetimeSeconds * 1000;
    assert.ok(clock < lease.expiresAt);
    // Re-submitting these old URLs now would not cover a fresh 12h task.
    assert.throws(() => assertInputLifetime(lease.expiresAt));
  }
  await assert.rejects(delivery.cleanupExpired(attempt.id, signal()));
  clock = lease.expiresAt + inputDeliveryPolicy.cleanupGraceSeconds * 1000 - 1;
  await assert.rejects(delivery.cleanupExpired(attempt.id, signal()));
  assert.equal(requests.length, 2);
  clock++;
  const reservation = store.db
    .prepare("SELECT reserved_micro_usd FROM live_attempts WHERE id=?")
    .get(attempt.id);
  await delivery.cleanupExpired(attempt.id, signal());
  assert.deepEqual(
    requests.map((r) => r.method),
    ["PUT", "PUT", "DELETE", "DELETE"],
  );
  assert.deepEqual(
    requests.slice(2).map((r) => r.path),
    requests.slice(0, 2).map((r) => r.path),
  );
  assert.equal(store.inputDelivery(attempt.id).state, "cleaned");
  assert.deepEqual(
    store.db
      .prepare("SELECT reserved_micro_usd FROM live_attempts WHERE id=?")
      .get(attempt.id),
    reservation,
  );
  await delivery.cleanupExpired(attempt.id, signal());
  await assert.rejects(delivery.issue(media, signal()));
  assert.equal(requests.length, 4);
  delivery.close();
});

test("input lifetime requires the full support window and rejects an overlong configured window", (t) => {
  const now = Date.now();
  t.mock.method(Date, "now", () => now);
  const minimum = inputDeliveryPolicy.minimumRemainingSeconds * 1000;
  assert.doesNotThrow(() => assertInputLifetime(now + minimum));
  for (const expiry of [
    now - 1,
    now + 3600000,
    now + 43200000,
    now + minimum - 1,
    NaN,
  ])
    assert.throws(() => assertInputLifetime(expiry, 30)); // Small contract values cannot weaken policy.
  assert.throws(() => assertInputLifetime(now + 46800000, 14 * 3600));
});

test("upload delays consuming the margin fail without renewing, replaying or submitting", async (t) => {
  let clock = Math.floor(Date.now() / 1000) * 1000;
  t.mock.method(Date, "now", () => clock);
  const { store, media, attempt } = plan();
  const { client, requests } = mockedClient(0, () => {
    clock += 30 * 60 * 1000;
  });
  const delivery = new R2PrivateInputDelivery(store, root, config, client);
  await assert.rejects(
    delivery.issue(media, signal()),
    /Private R2 input delivery failed/,
  );
  assert.equal(store.inputDelivery(attempt.id).state, "failed");
  await assert.rejects(delivery.issue(media, signal()));
  assert.equal(requests.length, 2);
  delivery.close();
});

for (const failAt of [2, 3, 4]) {
  test(`cleanup reconciles only recorded expired inputs after failure at request ${failAt}`, async (t) => {
    let clock = Date.now();
    t.mock.method(Date, "now", () => clock);
    const { store, media, attempt } = plan();
    const { client, requests } = mockedClient(failAt);
    const delivery = new R2PrivateInputDelivery(store, root, config, client);
    if (failAt === 2) await assert.rejects(delivery.issue(media, signal()));
    else await delivery.issue(media, signal());
    const record = store.inputDelivery(attempt.id);
    clock =
      record.manifest.expiresAt +
      inputDeliveryPolicy.cleanupGraceSeconds * 1000;
    if (failAt !== 2) {
      await assert.rejects(
        delivery.cleanupExpired(attempt.id, signal()),
        /cleanup refused or incomplete/,
      );
      assert.notEqual(store.inputDelivery(attempt.id).state, "cleaned");
    }
    await delivery.cleanupExpired(attempt.id, signal()); // Explicit retry of idempotent deletes only.
    assert.equal(store.inputDelivery(attempt.id).state, "cleaned");
    for (const request of requests.slice(2)) {
      assert.equal(request.method, "DELETE");
      assert.ok(requests.slice(0, 2).some((put) => put.path === request.path));
    }
    assert.equal(requests.filter((r) => r.method === "PUT").length, 2);
    delivery.close();
  });
}

test("cleanup refuses wrong account, bucket, foreign keys and legacy manifests without deleting", async (t) => {
  let clock = Date.now();
  t.mock.method(Date, "now", () => clock);
  const { store, media, attempt } = plan();
  const { client, requests } = mockedClient();
  const delivery = new R2PrivateInputDelivery(store, root, config, client);
  await delivery.issue(media, signal());
  const { manifest } = store.inputDelivery(attempt.id);
  clock = manifest.expiresAt + inputDeliveryPolicy.cleanupGraceSeconds * 1000;
  for (const override of [
    { accountId: "f".repeat(32) },
    { accountId: undefined },
    { bucket: "another-bucket" },
    { audioKey: "customer-objects/keep.mp3" },
    { imageKey: manifest.audioKey },
    { expiresAt: null },
  ]) {
    store.db
      .prepare("UPDATE live_input_deliveries SET manifest=? WHERE attempt_id=?")
      .run(JSON.stringify({ ...manifest, ...override }), attempt.id);
    await assert.rejects(delivery.cleanupExpired(attempt.id, signal()));
  }
  assert.equal(requests.length, 2);
  delivery.close();
});

test("SDK signing for a changed object path cannot escape the recorded lease", async () => {
  const { store, media, attempt } = plan();
  const { client, requests } = mockedClient();
  client.middlewareStack.add(
    (next) => async (args) => {
      const request = args.request as { method: string; path: string };
      if (request.method === "GET") request.path += "/changed-object";
      return next(args);
    },
    { step: "build", name: "offlineTamperedPresign" },
  );
  const delivery = new R2PrivateInputDelivery(store, root, config, client);
  await assert.rejects(
    delivery.issue(media, signal()),
    /Private R2 input delivery failed/,
  );
  assert.equal(store.inputDelivery(attempt.id).state, "failed");
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => request.method === "PUT"));
  delivery.close();
});
