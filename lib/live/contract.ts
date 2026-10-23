/** Internal integration contract, NOT BytePlus HTTP field names or a wire schema. */
export interface BillingRules {
  microUsdPerSecond: number;
  minimumBillableMs: number;
  billingQuantumMs: number;
  minimumChargeMicroUsd: number;
  fixedFeeMicroUsd: number;
  taxBasisPointsUpperBound: number;
}
export interface VerifiedContract {
  revision: string;
  model: "OmniHuman 2.0";
  documentationUrl: string;
  maxDurationSeconds: number;
  promptSupported: boolean;
  billing: BillingRules;
  output: {
    width: number;
    height: number;
    fps: number;
    durationToleranceSeconds: number;
  };
  outputHosts: readonly string[];
}

// Not configurable through environment variables: credentials or a checkbox cannot
// turn an unverified vendor protocol into a verified integration.
export const bytePlusVerification = Object.freeze({
  verified: false as const,
  checkedOn: "2026-10-23",
  contract: null,
  blockers: [
    "Official OmniHuman 2.0 endpoint, model/service identifier and region",
    "OmniHuman 2.0 authentication, credential scope and signing requirements",
    "Image/audio transport and exact request fields; English prompt field",
    "Submission response, polling schema, terminal statuses and output hosts",
    "Input minimums, billing quantum, minimum charge, taxes and failed-job charges",
    "Commercial access, usage restrictions and account entitlement",
  ],
});

export function assertBytePlusVerified(): never {
  throw new Error(
    "BytePlus OmniHuman 2.0 contract is not verified. No provider request was made.",
  );
}

export function upperBoundMicroUsd(
  durationSeconds: number,
  rules: BillingRules,
): number {
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    durationSeconds > 300
  )
    throw new Error("Invalid billable duration.");
  for (const value of Object.values(rules)) {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error(
        "All billing rules must be verified nonnegative integers.",
      );
  }
  if (rules.billingQuantumMs < 1 || rules.microUsdPerSecond < 1)
    throw new Error("Billing quantum and rate must be positive.");
  const requestedMs = Math.ceil(durationSeconds * 1000);
  const quantum = BigInt(rules.billingQuantumMs);
  const durationMs = BigInt(Math.max(requestedMs, rules.minimumBillableMs));
  const billedMs = ((durationMs + quantum - 1n) / quantum) * quantum;
  const usage = (billedMs * BigInt(rules.microUsdPerSecond) + 999n) / 1000n;
  const subtotal =
    (usage > BigInt(rules.minimumChargeMicroUsd)
      ? usage
      : BigInt(rules.minimumChargeMicroUsd)) + BigInt(rules.fixedFeeMicroUsd);
  const total =
    (subtotal * (10000n + BigInt(rules.taxBasisPointsUpperBound)) + 9999n) /
    10000n;
  if (total > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Cost exceeds safe arithmetic limits.");
  return Number(total);
}
