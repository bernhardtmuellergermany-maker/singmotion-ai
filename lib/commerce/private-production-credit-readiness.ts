import {assessPrivateInternationalCreditBeta} from "./private-international-credit-beta.ts";
import {stripeCreditTopupsLiveEnabled} from "./credit-wallet.ts";
import {customerCreditStudioBetaEnabled} from "./customer-credit-studio-beta.ts";

/**
 * Read-only configuration preflight for the existing PRIVATE Production
 * Credit -> Studio -> MP4 path. This does not authorize a charge, provider
 * submission, a public release or an operator's external acceptance evidence.
 *
 * No video-count limit is imposed here. Each job must still have a verified
 * wallet reservation, model-supported duration, and idempotent dispatch.
 */
export function assessPrivateProductionCreditVideo(env:Record<string,string|undefined>) {
 const checks=[
  // Every private production check is now worldwide; the old DE-only switch
  // does not grant new-money Checkout or prepaid video admission.
  ...assessPrivateInternationalCreditBeta(env).checks,
  {id:"CREDIT_CHECKOUT_AND_SIGNED_SETTLEMENT",ready:stripeCreditTopupsLiveEnabled(env)},
  {id:"ACCOUNT_WALLET_VIDEO_ADMISSION",ready:customerCreditStudioBetaEnabled(env)},
 ];
 return {configurationReady:checks.every(c=>c.ready),checks};
}

/** Explicit human/runtime evidence cannot be manufactured by a green gate. */
export const PRODUCTION_CREDIT_VIDEO_ACCEPTANCE=[
 "Verified authenticated LIVE Credit purchase and signed webhook settlement",
 "Verified LIVE refund/dispute and wallet restoration for an owned purchase",
 "Actual private Production R2 PUT/GET/Range and customer ownership denial",
 "BytePlus duration, cost, tax and output-host contract independently reviewed",
 "Exactly-once task submission and crash/unknown-result recovery rehearsal",
 "Completed owner-only MP4 and exactly-once Credit capture/release",
 "Verified backup restore, customer support and applicable legal approvals",
] as const;
