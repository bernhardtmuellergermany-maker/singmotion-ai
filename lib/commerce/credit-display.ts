/** Presentation only. This never authorizes payment or generation. */
export type CreditTone = "unknown" | "healthy" | "low" | "critical";

/** 250 credits buys a 10-second video at the proposed standard tariff. */
export function creditTone(availableCredits: number | null): CreditTone {
  if (availableCredits === null || !Number.isSafeInteger(availableCredits)) return "unknown";
  if (availableCredits >= 1000) return "healthy";
  if (availableCredits >= 250) return "low";
  return "critical";
}

/** Estimated whole source-video seconds purchasable from spendable Credits at the
 * currently verified tariff. Never infer a rate when tariff lookup fails. */
export function estimatedRemainingVideoSeconds(availableCredits:number|null,creditsPerSecond:number|null):number|null {
 if(availableCredits===null||creditsPerSecond===null||
    !Number.isSafeInteger(availableCredits)||availableCredits<0||
    !Number.isSafeInteger(creditsPerSecond)||creditsPerSecond<1||creditsPerSecond>1000)return null;
 return Math.floor(availableCredits/creditsPerSecond);
}
