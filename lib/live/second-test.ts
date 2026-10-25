/** Separate, append-only second slot. The unresolved first reservation is never released. */
import { createHash } from "node:crypto";
import type { LiveTestStore, Attempt } from "./store.ts";
export const isSecondTest = (attempt: Attempt) =>
  attempt.media.sourceJobId.startsWith("admin-second-");
export class SecondTestError extends Error {}
export type SecondReview = {
  planId: string;
  owner: string;
  costDigest: string;
  inclusiveMicroUsd: number;
  firstPlanId: string;
  firstTaskId: string;
  firstReservedMicroUsd: number;
  eurPerUsdUpperPpm: number;
  fxFeesMaxMicroEur: number;
  evidence: string;
  reviewedBy: string;
  reviewedAt: string;
  validUntil: string;
  acknowledgment: string;
};
export function secondReview(
  store: LiveTestStore,
  id: string,
): SecondReview | undefined {
  const row = store.db
    .prepare(
      "SELECT review_json FROM live_second_authorizations WHERE attempt_id=?",
    )
    .get(id) as { review_json: string } | undefined;
  return row ? JSON.parse(row.review_json) : undefined;
}
export function reservedUsd(store: LiveTestStore) {
  const value = (
    store.db
      .prepare(
        "SELECT COALESCE(SUM(reserved_micro_usd),0) AS n FROM live_attempts",
      )
      .get() as { n: number }
  ).n;
  if (!Number.isSafeInteger(value) || value < 0)
    throw new SecondTestError(
      "Invalid cumulative reservation; reconcile the ledger without resetting it.",
    );
  return value;
}
export function secondBudget(
  store: LiveTestStore,
  id: string,
  costDigest: string,
  cost: number,
  review = secondReview(store, id),
) {
  const first = store.firstTest(),
    attempt = store.get(id);
  if (!first || !isSecondTest(attempt) || first.attempt_id === id)
    throw new SecondTestError(
      "A distinct second plan and the original first slot are required.",
    );
  const original = store.get(first.attempt_id);
  const reserved = (
    store.db
      .prepare("SELECT reserved_micro_usd FROM live_attempts WHERE id=?")
      .get(first.attempt_id) as { reserved_micro_usd: number }
  ).reserved_micro_usd;
  if (
    !original.providerJobId ||
    original.media.owner !== attempt.media.owner ||
    !Number.isSafeInteger(reserved) ||
    reserved <= 0 ||
    reserved !== original.upperBoundMicroUsd
  )
    throw new SecondTestError(
      "The original owned task and its full positive reservation must remain intact.",
    );
  if (
    !review ||
    review.planId !== id ||
    review.owner !== attempt.media.owner ||
    review.costDigest !== costDigest ||
    review.inclusiveMicroUsd !== cost ||
    review.firstPlanId !== first.attempt_id ||
    review.firstTaskId !== original.providerJobId ||
    review.firstReservedMicroUsd !== reserved
  )
    throw new SecondTestError(
      "Save a separate EUR-50 total-budget review bound to this cost approval and the unchanged first reservation.",
    );
  if (
    !Number.isSafeInteger(cost) ||
    cost <= 0 ||
    !Number.isSafeInteger(review.eurPerUsdUpperPpm) ||
    review.eurPerUsdUpperPpm <= 0 ||
    !Number.isSafeInteger(review.fxFeesMaxMicroEur) ||
    review.fxFeesMaxMicroEur < 0 ||
    review.fxFeesMaxMicroEur >= 50000000
  )
    throw new SecondTestError(
      "Provide a reviewed positive EUR-per-USD upper bound (millionths) and explicit nonnegative FX fees (microEUR); no defaults or spot-rate assumptions.",
    );
  for (const key of [
    "evidence",
    "reviewedBy",
    "reviewedAt",
    "validUntil",
  ] as const)
    if (
      typeof review[key] !== "string" ||
      !review[key].trim() ||
      review[key].length > 4000
    )
      throw new SecondTestError(
        "Dated currency/fee evidence and reviewer provenance are required.",
      );
  if (
    !Number.isFinite(Date.parse(review.reviewedAt)) ||
    Date.parse(review.reviewedAt) > Date.now() ||
    !Number.isFinite(Date.parse(review.validUntil)) ||
    Date.parse(review.validUntil) <= Date.now() ||
    Date.parse(review.validUntil) > Date.now() + 7 * 86400000 ||
    review.acknowledgment !== "AUTHORIZE_SECOND_WITH_FULL_FIRST_RESERVATION"
  )
    throw new SecondTestError(
      "Currency/fee authorization must be explicit and unexpired (at most seven days); evidence must cover final settlement, not just today's spot rate.",
    );
  const all = reservedUsd(store);
  const prospective =
    BigInt(all) + (store.secondTest()?.attempt_id === id ? 0n : BigInt(cost));
  const ceiling =
    ((50000000n - BigInt(review.fxFeesMaxMicroEur)) * 1000000n) /
    BigInt(review.eurPerUsdUpperPpm);
  if (prospective > ceiling)
    throw new SecondTestError(
      "Insufficient proven EUR-50 total budget after retaining all existing reservations and FX fees. Do not reduce the first reservation or increase the EUR ceiling.",
    );
  const cap =
    ceiling > BigInt(Number.MAX_SAFE_INTEGER)
      ? Number.MAX_SAFE_INTEGER
      : Number(ceiling);
  return {
    usdCapMicro: cap,
    remainingMicroUsd: cap - all,
    remainingMicroEur: Number(
      50000000n -
        BigInt(review.fxFeesMaxMicroEur) -
        (BigInt(all) * BigInt(review.eurPerUsdUpperPpm) + 999999n) / 1000000n,
    ),
    reservedMicroUsd: all,
    firstReservedMicroUsd: reserved,
  };
}
export function saveSecondReview(
  store: LiveTestStore,
  id: string,
  review: SecondReview,
) {
  store.db.exec("BEGIN IMMEDIATE");
  try {
    if (store.secondTest() || store.get(id).state !== "prepared")
      throw new SecondTestError(
        "Second-slot authorization is immutable once claimed.",
      );
    secondBudget(
      store,
      id,
      review.costDigest,
      review.inclusiveMicroUsd,
      review,
    );
    store.db
      .prepare(
        "INSERT INTO live_second_authorizations VALUES (?,?) ON CONFLICT(attempt_id) DO UPDATE SET review_json=excluded.review_json",
      )
      .run(id, JSON.stringify(review));
    store.db.exec("COMMIT");
  } catch (error) {
    store.db.exec("ROLLBACK");
    throw error;
  }
}
export function claimSecondTest(
  store: LiveTestStore,
  id: string,
  digest: string,
  cost: number,
) {
  store.db.exec("BEGIN IMMEDIATE");
  try {
    if (store.secondTest())
      throw new SecondTestError(
        "The separate second slot is already claimed. Resume it; no third task is authorized.",
      );
    const budget = secondBudget(store, id, digest, cost);
    const review = secondReview(store, id)!;
    const proof = createHash("sha256")
      .update(JSON.stringify(review))
      .digest("hex");
    store.db
      .prepare("INSERT INTO live_second_test VALUES (2,?,?,?,?)")
      .run(id, digest, Date.now(), proof);
    store.db.exec("COMMIT");
    return budget;
  } catch (error) {
    store.db.exec("ROLLBACK");
    throw error;
  }
}
