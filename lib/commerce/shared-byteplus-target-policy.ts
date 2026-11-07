/** Owner-approved target settings for BOTH Railway environments, 2026-11-07.
 * This is a product authorization, NOT BytePlus vendor verification,
 * a verified inclusive billing contract, or authorization to auto-dispatch.
 * Runtime policy validation, authenticated per-job review, and privacy gates
 * remain mandatory. Never infer vendor fees or duration padding from this.
 */
export const SHARED_BYTEPLUS_TARGET_POLICY=Object.freeze({
 revision:"owner-approved-2026-11-07-shared-v1",
 model:"OmniHuman 2.0",
 microUsdPerGeneratedSecond:70_000,
 minInputSeconds:5,
 maxInputSeconds:300,
 dailyBudgetMicroUsd:null,
 lifetimeBudgetMicroUsd:null,
 delivery:"private-validated-mp4",
 outputHostReviewRequired:true,
 manualPerJobAuthorizationRequired:true,
 productionAndStagingIdentical:true,
} as const);

/** Price EXAMPLE only. The actual output duration and vendor surcharges
 * remain unknown until independently verified; do not use for checkout.
 */
export function baseEstimatedBytePlusMicroUsd(generatedSeconds:number){
 if(!Number.isFinite(generatedSeconds)||generatedSeconds<=0||generatedSeconds>300)
  throw Error("Generated seconds must be within documented 300s model limit");
 return Math.ceil(generatedSeconds*SHARED_BYTEPLUS_TARGET_POLICY.microUsdPerGeneratedSecond);
}

/** Shared product input admission for new Studio reviews in both environments.
 * Does not establish vendor pricing or authorize a provider request.
 */
export function assertSharedBytePlusInputSeconds(seconds:number){
 if(!Number.isFinite(seconds)||
    seconds<SHARED_BYTEPLUS_TARGET_POLICY.minInputSeconds||
    seconds>SHARED_BYTEPLUS_TARGET_POLICY.maxInputSeconds)
  throw Error("Studio input must be between 5 and 300 seconds");
 return seconds;
}
