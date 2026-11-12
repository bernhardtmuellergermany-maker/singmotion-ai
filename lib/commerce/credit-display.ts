/** Presentation only. This never authorizes payment or generation. */
export type CreditTone = "unknown" | "healthy" | "low" | "critical";

/** 250 credits buys a 10-second video at the proposed standard tariff. */
export function creditTone(availableCredits: number | null): CreditTone {
  if (availableCredits === null || !Number.isSafeInteger(availableCredits)) return "unknown";
  if (availableCredits >= 1000) return "healthy";
  if (availableCredits >= 250) return "low";
  return "critical";
}
