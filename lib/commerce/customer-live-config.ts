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
 "FREE_PROMO_FULFILLMENT_E2E_VERIFIED",
 "PRODUCTION_CMS_MIGRATION_VERIFIED",
 "PRODUCTION_CMS_BACKUP_RESTORE_VERIFIED",
 "PRODUCTION_CMS_RBAC_AND_PUBLISH_E2E_VERIFIED",
 "CMS_PUBLISHED_CONTENT_RECONCILED",
] as const);

export function productionCustomerReleaseApproved(env:Record<string,string|undefined>):boolean{
 return env.RAILWAY_ENVIRONMENT_ID===PRODUCTION_RAILWAY_ENVIRONMENT_ID &&
  configuredStripePaymentMode(env)==="live" &&
  PRODUCTION_CUSTOMER_PROOFS.every(key=>env[key]==="true") &&
  // The public gate must include the runtime switches, not just dated human
  // release attestations, or the site could open while fulfillment was off.
  ["CUSTOMER_ACCOUNTS_ENABLED","CUSTOMER_GENERATION_ENABLED",
   "CUSTOMER_FULFILLMENT_ENABLED","CUSTOMER_DELIVERY_ENABLED",
   "CUSTOMER_PAID_WORKER_ENABLED","CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED",
   "CUSTOMER_R2_STORAGE_ENABLED"].every(key=>env[key]==="true") &&
  env.CMS_ENABLED==="true" &&
  Boolean(env.CMS_DATABASE_URL?.trim()) &&
  Boolean(env.PAYLOAD_SECRET?.trim()) &&
  Boolean(env.SUPPORT_CONTACT_VERIFIED?.trim()) &&
  env.CUSTOMER_PRODUCTION_PROVIDER_BUDGET_APPROVED==="true" &&
  env.CUSTOMER_BYTEPLUS_OWNER_CONFIRMED_PRICING==="true" &&
  Number.isSafeInteger(Number(env.CUSTOMER_PAID_WORKER_ACTIVATED_AT)) &&
  Number(env.CUSTOMER_PAID_WORKER_ACTIVATED_AT)>0 &&
  Number(env.CUSTOMER_PAID_WORKER_ACTIVATED_AT)<=Date.now();
}
