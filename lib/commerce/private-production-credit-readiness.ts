import {privateLiveCreditTestEnabled} from "./private-live-credit-test.ts";
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
  {id:"PRIVATE_LIVE_STRIPE_ORIGIN_AND_IDENTITY",ready:privateLiveCreditTestEnabled(env)},
  {id:"CREDIT_CHECKOUT_AND_SIGNED_SETTLEMENT",ready:stripeCreditTopupsLiveEnabled(env)},
  {id:"ACCOUNT_WALLET_VIDEO_ADMISSION",ready:customerCreditStudioBetaEnabled(env)},
  {id:"BYTEPLUS_CREDENTIALS_PRESENT",ready:
   (env.BYTEPLUS_ACCESS_KEY_ID?.length||0)>=8 &&
   (env.BYTEPLUS_SECRET_ACCESS_KEY?.length||0)>=16},
  {id:"PRIVATE_R2_CREDENTIALS_PRESENT",ready:
   !!env.R2_ACCOUNT_ID && !!env.R2_BUCKET &&
   !!env.R2_ACCESS_KEY_ID && !!env.R2_SECRET_ACCESS_KEY},
  {id:"PUBLIC_REMAINS_CLOSED",ready:
   env.PRODUCTION_PUBLIC_ACCESS_ENABLED==="false" &&
   env.PUBLIC_CUSTOMER_LAUNCH_APPROVED==="false"},
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
