/** EUR 50 is a fixed authorization, never a replenishing balance. All reservations count. */
export interface EuroBudget {
  eurPerUsdUpperPpm: number;
  fxFeesMaxMicroEur: number;
  evidence: string;
  reviewedBy: string;
  reviewedAt: string;
  validUntil: string;
  budgetBasis?: "planning-allowance";
}
export function euroBudget(
  review: EuroBudget | undefined,
  reserved: number,
  configuredUsdCap: number,
) {
  if (
    !review ||
    !Number.isSafeInteger(review.eurPerUsdUpperPpm) ||
    review.eurPerUsdUpperPpm <= 0 ||
    !Number.isSafeInteger(review.fxFeesMaxMicroEur) ||
    review.fxFeesMaxMicroEur < 0 ||
    review.fxFeesMaxMicroEur >= 50000000 ||
    !review.evidence?.trim() ||
    !review.reviewedBy?.trim() ||
    !Number.isFinite(Date.parse(review.reviewedAt)) ||
    Date.parse(review.reviewedAt) > Date.now() ||
    !Number.isFinite(Date.parse(review.validUntil)) ||
    Date.parse(review.validUntil) <= Date.now() ||
    Date.parse(review.validUntil) > Date.parse(review.reviewedAt) + 7 * 86400000
  )
    throw new Error("EUR50_REVIEW_REQUIRED");
  if (
    !Number.isSafeInteger(reserved) ||
    reserved < 0 ||
    !Number.isSafeInteger(configuredUsdCap) ||
    configuredUsdCap <= 0
  )
    throw new Error("EUR50_REVIEW_REQUIRED");
  const rate = BigInt(review.eurPerUsdUpperPpm),
    fees = BigInt(review.fxFeesMaxMicroEur);
  const cap = ((50000000n - fees) * 1000000n) / rate;
  const effective = Number(
    cap < BigInt(configuredUsdCap) ? cap : BigInt(configuredUsdCap),
  );
  return {
    totalMicroEur: 50000000,
    reservedMicroUsd: reserved,
    usdCapMicro: effective,
    remainingMicroUsd: Math.max(0, effective - reserved),
    remainingMicroEur: Math.max(
      0,
      Number(50000000n - fees - (BigInt(reserved) * rate + 999999n) / 1000000n),
    ),
    basis: review.budgetBasis || "reviewed-bound",
  };
}
