/** UI quote only. NOT a payment authorization or Stripe line item. */
export const MIN_CREDIT_TOPUP = 500;
export const MAX_CREDIT_TOPUP = 100000;
export const TOPUP_CENTS_PER_CREDIT = 1;

/** Accept only a whole decimal credit count in the current proposed range. */
export function parseCreditTopup(value: string): number | null {
  const clean = value.trim();
  if (!/^[0-9]+$/.test(clean)) return null;
  const credits = Number(clean);
  return Number.isSafeInteger(credits) && credits >= MIN_CREDIT_TOPUP &&
    credits <= MAX_CREDIT_TOPUP ? credits : null;
}

export function proposedTopupCents(credits: number): number | null {
  if (!Number.isSafeInteger(credits) || credits < MIN_CREDIT_TOPUP ||
      credits > MAX_CREDIT_TOPUP) return null;
  return credits * TOPUP_CENTS_PER_CREDIT;
}
