import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchFxReference,
  parseFxReference,
  planningReview,
  planningAcknowledgment,
  ecbReferenceUrl,
} from "../lib/live/fx-reference.ts";
const now = Date.parse("2026-10-25T12:00:00Z");
const xml = "<Cube time='2026-10-23'><Cube currency='USD' rate='1.1'/></Cube>";
test("dated reference rounds reciprocal up; explicit allowance is not fee evidence", () => {
  const fx = parseFxReference(xml, now);
  assert.equal(fx.eurPerUsdPpm, 909091);
  assert.throws(() => planningReview(fx, "", now));
  const review = planningReview(fx, planningAcknowledgment, now);
  assert.equal(review.eurPerUsdUpperPpm, 1818182);
  assert.equal(review.fxFeesMaxMicroEur, 10000000);
  assert.equal(review.budgetBasis, "planning-allowance");
  assert.match(review.evidence, /NOT verified settlement bounds/);
  assert.equal(review.validUntil, "2026-10-26T12:00:00.000Z");
});
test("stale, future, zero, duplicate and hostile XML fail closed", () => {
  for (const bad of [
    xml.replace("23", "20"),
    xml.replace("23", "26"),
    xml.replace("1.1", "0"),
    xml + xml,
    "<!DOCTYPE x>" + xml,
    "invalid",
  ])
    assert.throws(() => parseFxReference(bad, now));
});
test("fixed public endpoint, no credentials, no redirects; errors sanitized", async () => {
  const mock: typeof fetch = async (url, opts) => {
    assert.equal(url, ecbReferenceUrl);
    assert.equal(opts?.redirect, "error");
    assert.equal(opts?.credentials, "omit");
    assert.equal(opts?.headers, undefined);
    return new Response(xml);
  };
  assert.equal((await fetchFxReference(mock, now)).usdPerEur, "1.1");
  await assert.rejects(
    fetchFxReference(async () => {
      throw new Error("secret");
    }, now),
    (e) => e instanceof Error && !e.message.includes("secret"),
  );
  await assert.rejects(
    fetchFxReference(async () => new Response("private", { status: 403 }), now),
    /HTTP 403/,
  );
  await assert.rejects(
    fetchFxReference(async () => new Response("a".repeat(65537)), now),
    /size limit/,
  );
});
