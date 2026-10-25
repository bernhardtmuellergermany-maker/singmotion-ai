import { test, after, beforeEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import net from "node:net";
import tls from "node:tls";
import { StudioWorkflow } from "../lib/live/studio.ts";
import {
  studioConfig,
  studioGate,
  validateStudioPolicy,
  StudioLiveError,
  type StudioPolicy,
} from "../lib/live/studio-policy.ts";
import { LiveTestStore } from "../lib/live/store.ts";
import { downloadValidatedOutput } from "../lib/live/output.ts";
import { BytePlusError } from "../lib/live/byteplus.ts";
import type { StudioDraftExport } from "../lib/studio-draft.ts";
const root = await mkdtemp(path.join(tmpdir(), "studio live mock "));
process.env.DATA_DIR = root;
process.env.DEMO_MODE = "true";
const db = await import("../lib/db.ts");
const owner = db.createSession().owner;
const song = path.join(root, "media", "song.wav"),
  image = path.join(root, "media", "singer.png");
execFileSync("ffmpeg", [
  "-nostdin",
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:duration=12",
  song,
]);
await sharp({
  create: { width: 300, height: 300, channels: 3, background: "#aabbcc" },
})
  .png()
  .toFile(image);
for (const [id, kind, file, mime] of [
  ["song", "audio", song, "audio/wav"],
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
const stores: LiveTestStore[] = [];
after(async () => {
  for (const s of stores) s.close();
  db.db.close();
  await rm(root, { recursive: true, force: true });
});
beforeEach((context) => {
  const t = context as TestContext;
  const deny = () => {
    throw Error("Real network forbidden");
  };
  t.mock.method(globalThis, "fetch", deny);
  t.mock.method(net.Socket.prototype, "connect", deny);
  t.mock.method(tls, "connect", deny);
});
const policy: StudioPolicy = {
  reviewedBy: "Mock reviewer",
  reviewedAt: "2026-01-01T00:00:00Z",
  expiresAt: "2099-01-01T00:00:00Z",
  billingEvidence: "Mock inclusive terms only, not real vendor evidence",
  outputEvidence: "Mock output policy only",
  contract: {
    revision: "mock-studio-v1",
    model: "OmniHuman 2.0",
    documentationUrl: "https://example.test/mock",
    maxDurationSeconds: 300,
    promptSupported: true,
    inputFetchWindowSeconds: 44100,
    generatedDurationBound: {
      evidence: "Mock generated duration bound",
      minInputSeconds: 4,
      maxInputSeconds: 299,
      maxAdditionalSeconds: 1,
    },
    billing: {
      microUsdPerSecond: 70000,
      minimumBillableMs: 0,
      billingQuantumMs: 1000,
      minimumChargeMicroUsd: 0,
      fixedFeeMicroUsd: 0,
      taxBasisPointsUpperBound: 0,
    },
    output: {
      videoCodec: "h264",
      audioCodec: "aac",
      width: 1280,
      height: 720,
      fps: 25,
      durationToleranceSeconds: 0.2,
    },
    outputHosts: ["output.example.test"],
  },
};
const config = {
  demoMode: false,
  enabled: true,
  operatorSecret: "mock-operator-secret-at-least-32-characters",
  maxJobMicroUsd: 1000000,
  maxTotalMicroUsd: 2000000,
  maxDurationSeconds: 300,
};
async function fixture() {
  const store = new LiveTestStore(path.join(root, randomUUID() + ".sqlite"));
  stores.push(store);
  let submits = 0,
    polls = 0,
    mode = "pending",
    downloadFail = false;
  const factory = () =>
    new StudioWorkflow(store, root, config, {
      policy: async () => policy,
      provider: (p) => ({
        contract: p.contract,
        submit: async () => {
          submits++;
          if (mode === "uncertain") throw Error("private upstream secret");
          return { jobId: "mock-task" };
        },
        poll: async () => {
          polls++;
          if (mode === "error")
            throw new BytePlusError(false, {
              code: "PROVIDER_REJECTED",
              httpStatus: 500,
              providerCode: 50510,
            });
          return mode === "pending"
            ? { state: "pending" }
            : mode === "failed"
              ? { state: "failed" }
              : {
                  state: "completed",
                  outputUrl: "https://output.example.test/file?signed=private",
                };
        },
      }),
      download: async (url, file, duration, c) => {
        if (downloadFail) throw Error("private download error");
        await downloadValidatedOutput(
          url,
          file,
          duration,
          c,
          async () => new Response(await readFile("public/media/demo.mp4")),
        );
      },
    });
  const service = factory();
  const selection: StudioDraftExport = {
    version: 1,
    owner,
    songId: "song",
    imageId: "singer",
    start: 0,
    end: 10,
    performance: "Natural",
    camera: "Static Close-Up",
    customPrompt: `Sing softly. ${randomUUID()}`,
  };
  const plan = await service.prepare(selection, owner, "Singer", true, true);
  const submit = () =>
    service.submit(
      plan.id,
      owner,
      plan.digest,
      plan.ceilingMicroUsd,
      `CONFIRM PAID STUDIO ${plan.id} ${plan.digest} ${plan.ceilingMicroUsd}`,
    );
  return {
    store,
    service,
    factory,
    selection,
    plan,
    submit,
    setMode: (v: string) => {
      mode = v;
    },
    failDownload: (v: boolean) => {
      downloadFail = v;
    },
    counts: () => ({ submits, polls }),
  };
}
test("pilot disabled by default and incomplete/replayed policy cannot price", () => {
  assert.throws(() => studioGate(studioConfig({})), /explicit server/);
  assert.equal(validateStudioPolicy(policy).contract.model, "OmniHuman 2.0");
  for (const p of [
    { ...policy, billingEvidence: "" },
    { ...policy, expiresAt: "2000-01-01" },
    {
      ...policy,
      contract: { ...policy.contract, outputHosts: ["*.example.test"] },
    },
    {
      ...policy,
      contract: { ...policy.contract, generatedDurationBound: null },
    },
    {
      ...policy,
      contract: {
        ...policy.contract,
        billing: { ...policy.contract.billing, taxBasisPointsUpperBound: null },
      },
    },
  ])
    assert.throws(() => validateStudioPolicy(p), StudioLiveError);
});
test("real WAV trim, immutable owned image/MP3, prompts, review and duplicate prevention", async () => {
  const f = await fixture();
  assert.ok(f.plan.durationSeconds >= 10 && f.plan.durationSeconds < 10.2);
  assert.match(f.plan.prompt, /Sing softly/);
  assert.ok(f.plan.ceilingMicroUsd! >= 770000);
  assert.equal(
    (await f.service.prepare(f.selection, owner, "Singer", true, true)).id,
    f.plan.id,
  );
  assert.throws(() => f.service.view(f.plan.id, "other"), /not found/);
  assert.throws(() => f.service.view("unknown", owner), /not found/);
  await assert.rejects(
    f.service.prepare(
      { ...f.selection, start: 0, end: 3 },
      owner,
      "Singer",
      true,
      true,
    ),
    /at least 4/,
  );
  await assert.rejects(
    f.service.prepare(f.selection, owner, "Singer", false, true),
    /rights/,
  );
  await assert.rejects(
    f.service.submit(f.plan.id, owner, f.plan.digest, 1, "wrong"),
    /Confirm/,
  );
  await Promise.allSettled([f.submit(), f.submit()]);
  assert.equal(f.counts().submits, 1);
  await f.submit();
  assert.equal(f.counts().submits, 1);
  assert.equal(f.store.firstTest(), undefined);
  assert.equal(f.store.secondTest(), undefined);
  const persisted = f.factory().view(f.plan.id, owner);
  assert.equal(persisted.state, "submitted");
  assert.ok(!JSON.stringify(persisted).includes(root));
  assert.ok(!JSON.stringify(persisted).includes("signed="));
});
test("shared cumulative reservation includes prior tasks and never uses demo credits", async () => {
  const f = await fixture();
  const before = db.balance(owner);
  const previous = f.store.prepare(
    { ...f.store.get(f.plan.id).media, sourceJobId: "original-operator-task" },
    "original-review",
    1500000,
  );
  f.store.claimFirstTest(previous.id, "original-digest");
  f.store.recordFirstTestResult(previous.id, {
    taskId: "existing-successful-task",
    outputPath: "private-preserved.mp4",
  });
  const oldSlot = f.store.firstTest(),
    oldResult = f.store.firstTestResult(previous.id);
  f.store.db
    .prepare("UPDATE live_attempts SET reserved_micro_usd=? WHERE id=?")
    .run(1500000, previous.id);
  await assert.rejects(f.submit(), /Total live-test spending cap/);
  assert.equal(f.counts().submits, 0);
  assert.equal(db.balance(owner), before);
  assert.deepEqual(f.store.firstTest(), oldSlot);
  assert.deepEqual(f.store.firstTestResult(previous.id), oldResult);
});
test("provider errors retain task and reservation; completed output retries securely without resubmission", async () => {
  const f = await fixture();
  await f.submit();
  f.setMode("error");
  const error = await f.service.poll(f.plan.id, owner);
  assert.match(error.stage, /50510/);
  assert.equal(error.state, "submitted");
  f.setMode("complete");
  f.failDownload(true);
  const retry = await f.service.poll(f.plan.id, owner);
  assert.equal(retry.state, "processing");
  assert.match(retry.stage, /OUTPUT_DOWNLOAD/);
  const count = f.counts().polls;
  f.failDownload(false);
  const completed = await f.factory().poll(f.plan.id, owner);
  assert.equal(completed.state, "completed");
  assert.equal(f.counts().polls, count);
  assert.equal(f.counts().submits, 1);
  assert.ok((await stat(await f.service.output(f.plan.id, owner))).size > 0);
  await assert.rejects(f.service.output(f.plan.id, "other"), /not found/);
  assert.ok(!JSON.stringify(completed).includes("signed="));
});
test("uncertain submission never retries, failed task never restores a reservation", async () => {
  for (const mode of ["uncertain", "failed"]) {
    const f = await fixture();
    f.setMode(mode);
    await f.submit();
    await f.service.poll(f.plan.id, owner);
    await f.submit();
    assert.equal(f.counts().submits, 1);
    assert.equal(f.service.view(f.plan.id, owner).state, mode);
    assert.equal(
      (
        f.store.db
          .prepare(
            "SELECT reserved_micro_usd AS n FROM live_attempts WHERE id=?",
          )
          .get(f.plan.id) as { n: number }
      ).n,
      f.plan.ceilingMicroUsd,
    );
  }
});

test("pilot authorization rejects anonymous, non-super-admin, unlisted staff and forged Origin", async () => {
  const { studioStaff } = await import("../cms/studio-access.ts");
  const env = {
    CMS_ENABLED: "true",
    CMS_ORIGIN: "https://staging.example.test",
    BYTEPLUS_STUDIO_ALLOWED_STAFF_IDS: "17",
  };
  const headers = new Headers({ origin: env.CMS_ORIGIN });
  const admin = { id: 17, collection: "staff", role: "super-admin" };
  assert.equal(studioStaff(admin, "POST", headers, env), "cms-staff-17");
  for (const user of [
    null,
    { ...admin, role: "editor" },
    { ...admin, role: "support" },
    { ...admin, role: "customer" },
    { ...admin, id: 18 },
  ])
    assert.throws(() => studioStaff(user, "POST", headers, env));
  assert.throws(() =>
    studioStaff(
      admin,
      "POST",
      new Headers({
        origin: "https://evil.test",
        "x-forwarded-host": "staging.example.test",
      }),
      env,
    ),
  );
  assert.throws(() => studioStaff(admin, "POST", new Headers(), env));
});

test("policy changes and tampered immutable media block submission before any provider call", async () => {
  const f = await fixture();
  const changed = structuredClone(policy);
  changed.contract.revision = "changed";
  const service = new StudioWorkflow(f.store, root, config, {
    ...f.service.dependencies,
    policy: async () => changed,
  });
  await assert.rejects(
    service.submit(
      f.plan.id,
      owner,
      f.plan.digest,
      f.plan.ceilingMicroUsd,
      `CONFIRM PAID STUDIO ${f.plan.id} ${f.plan.digest} ${f.plan.ceilingMicroUsd}`,
    ),
    /Changed terms/,
  );
  const { appendFile } = await import("node:fs/promises");
  await appendFile(
    f.store.get(f.plan.id).media.imagePath,
    Buffer.from("tampered"),
  );
  await assert.rejects(f.submit(), /changed after review/);
  assert.equal(f.counts().submits, 0);
});
test("stored project policy permits read-only recovery after new submissions are disabled", async () => {
  const f = await fixture();
  await f.submit();
  f.setMode("complete");
  const service = new StudioWorkflow(
    f.store,
    root,
    { ...config, enabled: false, maxJobMicroUsd: 1, maxTotalMicroUsd: 1 },
    f.service.dependencies,
  );
  await assert.rejects(
    service.submit(
      f.plan.id,
      owner,
      f.plan.digest,
      f.plan.ceilingMicroUsd,
      "anything",
    ),
    /explicit server/,
  );
  assert.equal((await service.poll(f.plan.id, owner)).state, "completed");
  assert.equal(f.counts().submits, 1);
});

test("public diagnostics classify budget and media constraints without private error data", async () => {
  const { studioDiagnostic } = await import("../lib/live/studio-policy.ts");
  assert.equal(
    studioDiagnostic(new Error("Total live-test spending cap exceeded.")).code,
    "TOTAL_BUDGET_EXCEEDED",
  );
  assert.equal(
    studioDiagnostic(
      new Error("Audio exceeds documented OmniHuman 2.0 audio limits."),
    ).code,
    "AUDIO_LIMIT",
  );
  assert.ok(
    !studioDiagnostic(
      new Error("secret AK https://private.test/?signed=secret /private/path"),
    ).message.includes("secret"),
  );
});
