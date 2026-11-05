/** Production-only paid customer approval. Deliberately independent of the
 * advisory launch audit to avoid circular readiness checks. A connected Stripe
 * account is NOT a server-side live secret, webhook verification or launch.
 */
import {configuredStripePaymentMode} from "./stripe-payment-mode.ts";

export const PRODUCTION_RAILWAY_ENVIRONMENT_ID="36adc41d-7e54-4396-ad1a-fd432ba0441d";

export const PRODUCTION_CUSTOMER_PROOFS=Object.freeze([
 "PUBLIC_CUSTOMER_LAUNCH_APPROVED",
 "STRIPE_ACCOUNT_LIVE_REVIEW_APPROVED",
 "STRIPE_REFUND_DISPUTE_E2E_VERIFIED",
 "BYTEPLUS_BILLING_AND_TAX_APPROVED",
 "BYTEPLUS_OUTPUT_HOSTS_APPROVED",
 "CUSTOMER_PAID_PROVIDER_E2E_VERIFIED",
 "CUSTOMER_CLOUD_E2E_VERIFIED",
 "CUSTOMER_R2_PRODUCTION_RELEASE_APPROVED",
 "PRODUCTION_MEDIA_MIGRATION_VERIFIED",
 "BACKUP_RESTORE_EXERCISE_VERIFIED",
 "MEDIA_RETENTION_NOTICE_FLOW_VERIFIED",
 "COST_ALERTS_AND_KILL_SWITCH_VERIFIED",
 "LEGAL_REVIEW_APPROVED",
] as const);

export function productionCustomerReleaseApproved(env:Record<string,string|undefined>):boolean{
 return env.RAILWAY_ENVIRONMENT_ID===PRODUCTION_RAILWAY_ENVIRONMENT_ID &&
  configuredStripePaymentMode(env)==="live" &&
  PRODUCTION_CUSTOMER_PROOFS.every(key=>env[key]==="true") &&
  env.CUSTOMER_PRODUCTION_PROVIDER_BUDGET_APPROVED==="true" &&
  env.CUSTOMER_BYTEPLUS_OWNER_CONFIRMED_PRICING==="true" &&
  Number.isSafeInteger(Number(env.CUSTOMER_PAID_WORKER_ACTIVATED_AT)) &&
  Number(env.CUSTOMER_PAID_WORKER_ACTIVATED_AT)>0 &&
  Number(env.CUSTOMER_PAID_WORKER_ACTIVATED_AT)<=Date.now();
}
