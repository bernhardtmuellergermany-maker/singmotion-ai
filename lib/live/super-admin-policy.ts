import { validateStudioPolicy, type StudioPolicy } from "./studio-policy.ts";
/**
 * Super Admin private-generation profile.
 * Uses only the existing server-owned approved output hosts/transport and media
 * envelope; does not claim that billing fees or generated duration are verified.
 * It is a planning reservation, not a BytePlus invoice limit.
 */
export function superAdminStudioPolicy(root: StudioPolicy): StudioPolicy {
  const base = validateStudioPolicy(root, false);
  const contract = structuredClone(base.contract);
  if (!contract.outputHosts.length || !contract.output.transfer) {
    throw new Error("Private output transport and exact hosts must be configured.");
  }
  contract.generatedDurationBound = {
    minInputSeconds: 4,
    maxInputSeconds: 300,
    maxAdditionalSeconds: 0,
    evidence: "Super Admin operational planning: generated duration assumed equal to encoded input; actual duration and bill may differ.",
  };
  contract.maxDurationSeconds = 300;
  contract.output.maxDurationSeconds = 300;
  contract.output.durationToleranceSeconds = 0;
  contract.pilotAdmission = {
    maxGeneratedSeconds: 300,
    inclusiveMaxMicroUsd: 24990000,
    planningUpliftBasisPoints: 1900,
    durationEvidence: "Super Admin planning assumption only: 4 to 300 seconds; not provider-reviewed generated duration.",
    evidence: "Internal planning reservation USD 24.99 at 300 seconds, not a verified provider cost or spending cap.",
  };
  const policy: StudioPolicy = {
    ...base,
    durationBands: undefined,
    contract,
    reviewedBy: "authenticated-super-admin-server-policy",
    reviewedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    expiresAt: "2099-01-01T00:00:00.000Z",
    billingEvidence: "Operator planning reservation only; taxes, fees and actual billing remain uncertain.",
    outputEvidence: base.outputEvidence,
  };
  return validateStudioPolicy(policy, false);
}
