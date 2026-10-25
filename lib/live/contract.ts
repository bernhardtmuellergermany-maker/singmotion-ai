import { createHash } from "node:crypto";
/** Internal integration contract, NOT BytePlus HTTP field names or a wire schema. */
export interface BillingRules {
  microUsdPerSecond: number;
  minimumBillableMs: number | null;
  billingQuantumMs: number | null;
  minimumChargeMicroUsd: number | null;
  fixedFeeMicroUsd: number | null;
  taxBasisPointsUpperBound: number | null;
}
export interface VerifiedContract {
  revision: string;
  model: "OmniHuman 2.0";
  documentationUrl: string;
  maxDurationSeconds: number;
  promptSupported: boolean;
  // Reviewed task/input availability window including safety margin.
  // Null means unknown: block before uploading inputs or submitting.
  inputFetchWindowSeconds: number | null;
  // Independently reviewed envelope over this explicit input range. No default
  // padding: the Product Team five-second example does not establish a rule.
  generatedDurationBound: {
    evidence: string;
    minInputSeconds: number;
    maxInputSeconds: number;
    maxAdditionalSeconds: number;
  } | null;
  billing: BillingRules;
  /** Pilot-only aggregate admission bound; planning uplift is NOT a tax rule. */
  pilotAdmission?: {
    experimental?: {
      kind: "operator-planning-v1";
      unknownDurationAccepted: true;
      unknownFeesAccepted: true;
      unknownMediaAccepted: true;
      hostEvidence: string;
    };
    durationEvidence?: string;
    inclusiveMaxMicroUsd: number;
    evidence: string;
    planningUpliftBasisPoints: 1900;
    maxGeneratedSeconds: number;
  };
  output: {
    width: number;
    height: number;
    fps: number;
    durationToleranceSeconds: number;
    maxDurationSeconds?: number;
    transfer?: { maxBytes: number; timeoutMs: number; evidence: string };
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
    "Current Common Parameters page review and live account/signature verification (SDK signing is mock-verified)",
    "Generated-video duration envelope, minimum charges, fees and inclusive taxes (five-second input base bound USD 0.42 only)",
    "Operational validation of 13-hour private input delivery and retention (Support requires full 12-hour availability; no automatic fetch retry)",
    "Output host allowlist, exact dimensions/aspect behavior, codecs and frame rate (Support confirms 720p, up to 5 minutes)",
  ],
});

/** Operator-relayed Technical Support billing rule. Base only; never an inclusive quote. */
export function reportedBaseChargeMicroUsd(
  generatedVideoSeconds: number,
): number {
  if (
    !Number.isFinite(generatedVideoSeconds) ||
    generatedVideoSeconds <= 0 ||
    generatedVideoSeconds > 300
  )
    throw new Error("Invalid generated-video duration.");
  return Math.max(1, Math.floor(generatedVideoSeconds)) * 70000;
}

export function assertBytePlusVerified(): never {
  throw new Error(
    "BytePlus OmniHuman 2.0 contract is not verified. No provider request was made.",
  );
}

/** Pricing must use a reviewed GENERATED video envelope, never raw audio duration. */
export function planUpperBoundMicroUsd(
  inputSeconds: number,
  contract: VerifiedContract,
): number {
  const bound = contract.generatedDurationBound;
  if (
    !bound ||
    !bound.evidence?.trim() ||
    ![
      inputSeconds,
      bound.minInputSeconds,
      bound.maxInputSeconds,
      bound.maxAdditionalSeconds,
    ].every(Number.isFinite) ||
    bound.minInputSeconds < 0 ||
    bound.maxInputSeconds < bound.minInputSeconds ||
    bound.maxAdditionalSeconds < 0 ||
    inputSeconds <= 0 ||
    inputSeconds < bound.minInputSeconds ||
    inputSeconds > bound.maxInputSeconds ||
    inputSeconds > contract.maxDurationSeconds
  )
    throw new Error(
      "Reviewed generated-video duration bound is missing or does not cover this input.",
    );
  if (contract.pilotAdmission) {
    const p = contract.pilotAdmission;
    if (
      p.experimental &&
      (p.experimental.kind !== "operator-planning-v1" ||
        p.experimental.unknownDurationAccepted !== true ||
        p.experimental.unknownFeesAccepted !== true ||
        p.experimental.unknownMediaAccepted !== true ||
        typeof p.experimental.hostEvidence !== "string" ||
        p.experimental.hostEvidence.trim().length < 20 ||
        bound.maxInputSeconds > 15)
    )
      throw new Error(
        "Experimental planning requires separate duration, fees and media acknowledgments and approved-host evidence.",
      );
    // Legacy inclusiveMaxMicroUsd is the finite ledger reservation in experimental
    // mode, NOT a provider-enforced charge bound or a guarantee about unknown fees.
    if (
      !Number.isSafeInteger(p.inclusiveMaxMicroUsd) ||
      p.inclusiveMaxMicroUsd <
        Math.ceil(p.maxGeneratedSeconds * 70000 * 1.19) ||
      p.planningUpliftBasisPoints !== 1900 ||
      !p.evidence?.trim() ||
      (!p.durationEvidence &&
        (p.maxGeneratedSeconds !== 6 || bound.maxInputSeconds > 5)) ||
      (p.durationEvidence !== undefined &&
        (!p.durationEvidence.trim() ||
          !Number.isFinite(p.maxGeneratedSeconds) ||
          p.maxGeneratedSeconds < bound.maxInputSeconds ||
          p.maxGeneratedSeconds > 300 ||
          bound.maxInputSeconds > 60)) ||
      bound.minInputSeconds < 4 ||
      contract.billing.microUsdPerSecond !== 70000 ||
      [
        contract.billing.minimumBillableMs,
        contract.billing.billingQuantumMs,
        contract.billing.minimumChargeMicroUsd,
        contract.billing.fixedFeeMicroUsd,
        contract.billing.taxBasisPointsUpperBound,
      ].some((v) => v !== null)
    )
      throw new Error(
        "Pilot needs a separately reviewed inclusive ceiling; planning uplift is not verified tax.",
      );
    return p.inclusiveMaxMicroUsd;
  }
  return upperBoundMicroUsd(
    inputSeconds + bound.maxAdditionalSeconds,
    contract.billing,
  );
}

/** Arithmetic for an already reviewed video bound and conservative billing rules.
 * Upward rounding here is an admission bound, not a claim about provider invoices.
 */
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
  for (const value of [
    rules.microUsdPerSecond,
    rules.minimumBillableMs,
    rules.billingQuantumMs,
    rules.minimumChargeMicroUsd,
    rules.fixedFeeMicroUsd,
    rules.taxBasisPointsUpperBound,
  ]) {
    if (value === null || !Number.isSafeInteger(value) || value < 0)
      throw new Error(
        "All billing rules must be verified nonnegative integers.",
      );
  }
  const verified = rules as { [K in keyof BillingRules]: number };
  if (verified.billingQuantumMs < 1 || rules.microUsdPerSecond < 1)
    throw new Error("Billing quantum and rate must be positive.");
  const requestedMs = Math.ceil(durationSeconds * 1000);
  const quantum = BigInt(verified.billingQuantumMs);
  const durationMs = BigInt(Math.max(requestedMs, verified.minimumBillableMs));
  const billedMs = ((durationMs + quantum - 1n) / quantum) * quantum;
  const usage = (billedMs * BigInt(verified.microUsdPerSecond) + 999n) / 1000n;
  const subtotal =
    (usage > BigInt(verified.minimumChargeMicroUsd)
      ? usage
      : BigInt(verified.minimumChargeMicroUsd)) +
    BigInt(verified.fixedFeeMicroUsd);
  const total =
    (subtotal * (10000n + BigInt(verified.taxBasisPointsUpperBound)) + 9999n) /
    10000n;
  if (total > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Cost exceeds safe arithmetic limits.");
  return Number(total);
}

/** Stable full-contract binding; a reused revision cannot silently change terms. */
export function contractDigest(contract: VerifiedContract): string {
  const canonical = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
    if (v && typeof v === "object")
      return `{${Object.entries(v)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, value]) => `${JSON.stringify(k)}:${canonical(value)}`)
        .join(",")}}`;
    return JSON.stringify(v);
  };
  return createHash("sha256").update(canonical(contract)).digest("hex");
}
