import test from "node:test";
import assert from "node:assert/strict";
import { parseResidualEvidence } from "../lib/ops/hidrive-residual-evidence.mjs";
const complete = "HIDRIVE_RESIDUAL_CHECK_COMPLETED";
const result = (ordinal, state = "absent", extra = {}) =>
  "HIDRIVE_RESIDUAL_RESULT " + JSON.stringify({ ordinal, state, ...extra });

test("Railway 3-1-2 delivery is accepted and normalized to 1-2-3", () => {
  const evidence = parseResidualEvidence([
    complete,
    result(3),
    result(1),
    result(2),
  ]);
  assert.deepEqual(evidence.map(({ ordinal }) => ordinal), [1, 2, 3]);
  assert.ok(evidence.every(({ state }) => state === "absent"));
});

test("valid bounded present-file metadata is accepted", () => {
  const evidence = parseResidualEvidence([
    result(2, "present", { bytes: 1024, sha256: "a".repeat(64) }),
    result(1),
    result(3, "present", { bytes: 16384, sha256: "b".repeat(64) }),
    complete,
  ]);
  assert.equal(evidence[1].bytes, 1024);
  assert.equal(evidence[2].bytes, 16384);
});

test("missing, duplicate, unexpected, invalid and malformed evidence is rejected", () => {
  const invalid = [
    [result(3), result(1), result(2)],
    [complete, result(1), result(2)],
    [complete, result(1), result(1), result(3)],
    [complete, result(1), result(2), result(4)],
    [complete, result(1), result(2), result(3, "unknown")],
    [complete, result("1"), result(2), result(3)],
    [complete, result(1), result(2), result(3, "present", { bytes: 16385, sha256: "b".repeat(64) })],
    [complete, result(1, "present", { bytes: 15, sha256: "invalid" }), result(2), result(3)],
    [complete, result(1, "absent", { bytes: 100 }), result(2), result(3)],
    [complete, result(1), result(2), "HIDRIVE_RESIDUAL_RESULT {malformed"],
    [complete, result(1), result(2), "HIDRIVE_RESIDUAL_RESULT null"],
  ];
  for (const logs of invalid) {
    assert.throws(() => parseResidualEvidence(logs), /RESIDUAL_/);
  }
});
