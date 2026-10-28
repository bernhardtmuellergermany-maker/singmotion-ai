import { test } from "node:test";
import assert from "node:assert/strict";
import {
  quote,
  validateSelection,
  validateFile,
  composePrompt,
  canTransition,
  AUDIO_LIMIT,
  IMAGE_LIMIT,
} from "../lib/domain.ts";
import {
  DisabledBytePlusAdapter,
  DisabledFalAdapter,
  liveProvider,
} from "../lib/providers.ts";
import { DisabledPayments, requireAdmin } from "../lib/integrations.ts";
test("server pricing uses exact selected duration, rounds up cents, and assumes no billing minimum", () => {
  assert.equal(quote(10, 299).cents, 299);
  assert.equal(quote(5, 299).cents, 150);
  assert.equal(quote(0.1, 299).cents, 3);
  assert.equal(quote(300, 299).cents, 8970);
  assert.equal(quote(10, 450).cents, 450);
  assert.equal(quote(10).minimum, null);
  for (const d of [0, -1, 301, NaN, Infinity]) assert.throws(() => quote(d));
  assert.throws(() => quote(10, -20));
});
test("selection rejects reversed, out-of-range, non-finite and overlong segments", () => {
  assert.equal(validateSelection(2.25, 7.5, 30), 5.25);
  for (const values of [
    [-1, 5, 20],
    [4, 4, 20],
    [5, 3, 20],
    [0, 21, 20],
    [0, 301, 400],
    [NaN, 5, 20],
  ])
    assert.throws(() =>
      validateSelection(...(values as [number, number, number])),
    );
});
test("file extension and size limits are enforced before expensive decoding", () => {
  validateFile("track.MP3", 100, "audio");
  validateFile("track.wav", AUDIO_LIMIT, "audio");
  validateFile("artist.png", IMAGE_LIMIT, "image");
  for (const [name, size, kind] of [
    ["track.mp3", AUDIO_LIMIT + 1, "audio"],
    ["track.aac", 40, "audio"],
    ["face.svg", 100, "image"],
    ["face.jpg", IMAGE_LIMIT + 1, "image"],
    ["face.jpg", 0, "image"],
  ] as const)
    assert.throws(() => validateFile(name, size, kind));
});
test("camera presets are composed with optional custom directions", () => {
  const baseline = composePrompt("Natural", "Static camera", "");
  assert.match(baseline, /camera fixed/);
  const custom = composePrompt("Energetic", "Orbit left", "Sing passionately");
  assert.match(custom, /Energetic singing performance/);
  assert.match(custom, /arc to the left/);
  assert.match(custom, /Sing passionately/);
  assert.match(composePrompt("Natural", "Static Close-Up", ""), /Camera direction/);
  assert.throws(() => composePrompt("Custom", "Static camera", ""));
  assert.throws(() => composePrompt("Natural", "Orbit", ""));
  assert.throws(() => composePrompt("Natural", "Static camera", "x".repeat(1501)));
});

test("state machine prohibits repeated completion and automatic retries", () => {
  assert.ok(canTransition("queued", "processing"));
  assert.ok(canTransition("processing", "failed"));
  assert.ok(canTransition("queued", "cancelled"));
  assert.equal(canTransition("completed", "processing"), false);
  assert.equal(canTransition("processing", "cancelled"), false);
  assert.equal(canTransition("failed", "queued"), false);
});
test("paid providers and payments fail closed, regardless of credentials", async () => {
  await assert.rejects(
    () => new DisabledBytePlusAdapter().create(),
    /not verified/,
  );
  await assert.rejects(() => new DisabledFalAdapter().create(), /not verified/);
  await assert.rejects(
    () => new DisabledPayments().createCheckout(),
    /disabled/,
  );
  assert.throws(() => liveProvider(), /cannot be activated/);
});
test("production admin authorization requires server-owned role and MFA", () => {
  assert.throws(() => requireAdmin(null));
  assert.throws(() =>
    requireAdmin({ userId: "u", role: "customer", assurance: "aal2" }),
  );
  assert.throws(() =>
    requireAdmin({ userId: "u", role: "admin", assurance: "aal1" }),
  );
  assert.equal(
    requireAdmin({ userId: "u", role: "admin", assurance: "aal2" }).userId,
    "u",
  );
});
