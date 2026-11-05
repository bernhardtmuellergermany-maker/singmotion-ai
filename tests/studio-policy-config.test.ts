import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadStudioPolicy, StudioLiveError } from "../lib/live/studio-policy.ts";

// Fail-closed tests: no provider calls, no files in a production volume.
test("missing policy rejects even when the Studio feature is enabled", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sm-policy-"));
  const prior = process.env.STUDIO_LIVE_POLICY_JSON;
  delete process.env.STUDIO_LIVE_POLICY_JSON;
  try {
    await assert.rejects(loadStudioPolicy(dir), (error: unknown) =>
      error instanceof StudioLiveError && error.code === "POLICY_MISSING");
  } finally {
    if (prior === undefined) delete process.env.STUDIO_LIVE_POLICY_JSON;
    else process.env.STUDIO_LIVE_POLICY_JSON = prior;
    await rm(dir, { recursive: true, force: true });
  }
});

test("an invalid Railway policy cannot enable video submissions", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sm-policy-"));
  const prior = process.env.STUDIO_LIVE_POLICY_JSON;
  process.env.STUDIO_LIVE_POLICY_JSON = JSON.stringify({ reviewedBy: "operator" });
  try {
    await assert.rejects(loadStudioPolicy(dir), (error: unknown) =>
      error instanceof StudioLiveError && error.code === "POLICY_REVIEW_REQUIRED");
    // An invalid existing file must take precedence over the environment,
    // preventing a silent override of persisted review state.
    await writeFile(path.join(dir, "studio-live-policy.json"), "{invalid");
    await assert.rejects(loadStudioPolicy(dir), (error: unknown) =>
      error instanceof StudioLiveError && error.code === "POLICY_MISSING");
  } finally {
    if (prior === undefined) delete process.env.STUDIO_LIVE_POLICY_JSON;
    else process.env.STUDIO_LIVE_POLICY_JSON = prior;
    await rm(dir, { recursive: true, force: true });
  }
});

test("oversized Railway policy fails closed", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sm-policy-"));
  const prior = process.env.STUDIO_LIVE_POLICY_JSON;
  process.env.STUDIO_LIVE_POLICY_JSON = "x".repeat(65537);
  try {
    await assert.rejects(loadStudioPolicy(dir), (error: unknown) =>
      error instanceof StudioLiveError && error.code === "POLICY_MISSING");
  } finally {
    if (prior === undefined) delete process.env.STUDIO_LIVE_POLICY_JSON;
    else process.env.STUDIO_LIVE_POLICY_JSON = prior;
    await rm(dir, { recursive: true, force: true });
  }
});
