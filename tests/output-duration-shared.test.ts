import test from "node:test";
import assert from "node:assert/strict";
import { matchesOmniHumanDuration } from "../lib/live/output.ts";

test("shared duration rule accepts normal frame rounding for all callers", () => {
  assert.equal(matchesOmniHumanDuration(23.24, 23.208, 0.05, 300), true);
});
test("shared duration rule accepts bounded provider intro/outro on customer and super-admin jobs", () => {
  assert.equal(matchesOmniHumanDuration(24.9, 23.208, 0.05, 300), true);
  assert.equal(matchesOmniHumanDuration(25.208, 23.208, 0.05, 300), true);
});
test("shared duration rule rejects truncated, materially extended and out-of-range video", () => {
  assert.equal(matchesOmniHumanDuration(22.8, 23.208, 0.05, 300), false);
  assert.equal(matchesOmniHumanDuration(25.5, 23.208, 0.05, 300), false);
  assert.equal(matchesOmniHumanDuration(300.5, 299, 0.05, 300), false);
  assert.equal(matchesOmniHumanDuration(NaN, 23.208, 0.05, 300), false);
});
