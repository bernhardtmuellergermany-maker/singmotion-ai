import assert from "node:assert/strict";
import { test } from "node:test";
import { superAdminRuntimeBootstrapPolicy } from "../lib/live/super-admin-runtime-bootstrap.ts";
import { superAdminStudioPolicy } from "../lib/live/super-admin-policy.ts";
import { planUpperBoundMicroUsd } from "../lib/live/contract.ts";
import { validateStudioPolicy, StudioLiveError } from "../lib/live/studio-policy.ts";
import { validateOutputUrl } from "../lib/live/output.ts";

test("private Super Admin bootstrap needs no policy file or guessed host", () => {
  const root = superAdminRuntimeBootstrapPolicy();
  assert.equal(root.contract.billing.microUsdPerSecond, 70000);
  assert.deepEqual(root.contract.outputHosts, []);
  assert.equal(root.contract.trustSignedProviderOutputHost, true);
  assert.equal(root.contract.discover720p, true);
  assert.equal(planUpperBoundMicroUsd(5, root.contract), 583100);
  assert.equal(planUpperBoundMicroUsd(5 / 0.9, root.contract), 583100);
  assert.equal(root.contract.generatedDurationBound?.maxInputSeconds, 6);
  assert.equal(root.contract.output.maxDurationSeconds, 7);
  assert.equal(validateStudioPolicy(root), root);
});

test("unreviewed host discovery never enables arbitrary contract revisions", () => {
  const root = superAdminRuntimeBootstrapPolicy();
  const forged = structuredClone(root);
  forged.contract.revision = "public-customer-contract";
  assert.throws(() => validateStudioPolicy(forged), (error: unknown) =>
    error instanceof StudioLiveError && error.code === "POLICY_REVIEW_REQUIRED",
  );
});

test("private Super Admin extends app duration without user credits", () => {
  const expanded = superAdminStudioPolicy(superAdminRuntimeBootstrapPolicy());
  assert.equal(expanded.contract.maxDurationSeconds, 300);
  assert.equal(expanded.contract.trustSignedProviderOutputHost, true);
  assert.equal(planUpperBoundMicroUsd(300, expanded.contract), 24990000);
});

test("signed response discovery still rejects unsafe output URLs", () => {
  for (const url of [
    "http://public.example/video.mp4",
    "https://127.0.0.1/video.mp4",
    "https://localhost/video.mp4",
    "https://user:pass@public.example/video.mp4",
    "https://public.example:444/video.mp4",
  ]) {
    assert.throws(() => validateOutputUrl(url, [new URL(url).hostname]));
  }
  assert.equal(
    validateOutputUrl("https://media.example.com/video.mp4", ["media.example.com"]).hostname,
    "media.example.com",
  );
});

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadRuntimeStudioPolicy } from "../lib/live/studio-runtime.ts";

test("runtime has no-file Super Admin fallback, never customer or malformed file", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sm-admin-runtime-"));
  const env = { ...process.env };
  delete env.STUDIO_LIVE_POLICY_JSON;
  const previous = process.env.STUDIO_LIVE_POLICY_JSON;
  delete process.env.STUDIO_LIVE_POLICY_JSON;
  try {
    const p = await loadRuntimeStudioPolicy(dir, env, true);
    assert.equal(p.contract.revision, "super-admin-runtime-bootstrap-tempo-v2");
    await assert.rejects(loadRuntimeStudioPolicy(dir, env, false), (error: unknown) =>
      error instanceof StudioLiveError && error.code === "POLICY_MISSING",
    );
    await writeFile(path.join(dir, "studio-live-policy.json"), "{malformed");
    await assert.rejects(loadRuntimeStudioPolicy(dir, env, true), (error: unknown) =>
      error instanceof StudioLiveError && error.code === "POLICY_MISSING",
    );
  } finally {
    if (previous === undefined) delete process.env.STUDIO_LIVE_POLICY_JSON;
    else process.env.STUDIO_LIVE_POLICY_JSON = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
