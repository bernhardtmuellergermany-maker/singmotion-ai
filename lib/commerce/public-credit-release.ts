import {managedCreditMoRApproved} from "./managed-credit-payments.ts";

/**
 * Public, prepaid CREDITS-ONLY production release. Legacy per-video Checkout
 * and the retired Hobby worker MUST NOT be prerequisites for this independent
 * account -> LIVE Stripe MoR -> Credit wallet -> BytePlus -> private MP4 path.
 *
 * This function is a pure admission check, NOT an attestation that an outside
 * payment processor or tax authority has approved an arrangement. Checks are
 * intentionally unforgeable by the user's browser; the independent human
 * evidence still has to be recorded by the operator before release.
 *
 * No daily/monthly/lifetime video-count quota is introduced. Each project
 * retains its own verified balance, Credit reservation, provider contract,
 * idempotent submission and verified private output.
 */
const PROD="36adc41d-7e54-4396-ad1a-fd432ba0441d";
const LIVE_SECRET=/^(?:sk|rk)_live_[A-Za-z0-9_]+$/;
const WEBHOOK_SECRET=/^whsec_[A-Za-z0-9_]+$/;

/** These describe independent real-world milestones, not inferred readiness.
 * An operator must NOT set a flag to true merely because this gate asks for it.
 */
export const PUBLIC_CREDIT_RELEASE_EVIDENCE=[
 "STRIPE_ACCOUNT_LIVE_REVIEW_APPROVED",
 "STRIPE_REFUND_DISPUTE_E2E_VERIFIED",
 "CUSTOMER_CLOUD_E2E_VERIFIED",
 "CUSTOMER_R2_PRODUCTION_RELEASE_APPROVED",
 "PRODUCTION_MEDIA_MIGRATION_VERIFIED",
 "BYTEPLUS_BILLING_AND_TAX_APPROVED",
 "BYTEPLUS_OUTPUT_HOSTS_APPROVED",
 "CREDIT_PRODUCTION_PAID_E2E_VERIFIED",
 "BACKUP_RESTORE_EXERCISE_VERIFIED",
 "PRODUCTION_CMS_BACKUP_RESTORE_VERIFIED",
 "PRODUCTION_CMS_RBAC_AND_PUBLISH_E2E_VERIFIED",
 "CMS_PUBLISHED_CONTENT_RECONCILED",
 "MEDIA_RETENTION_NOTICE_FLOW_VERIFIED",
 "COST_ALERTS_AND_KILL_SWITCH_VERIFIED",
 "LEGAL_REVIEW_APPROVED",
] as const;

export function assessPublicCreditRelease(env:Record<string,string|undefined>){
 const checks=[
  {id:"PRODUCTION_ONLY",ready:env.RAILWAY_ENVIRONMENT_ID===PROD},
  {id:"EXPLICIT_PUBLIC_RELEASE",ready:env.PUBLIC_CUSTOMER_LAUNCH_APPROVED==="true"&&env.PRODUCTION_PUBLIC_ACCESS_ENABLED==="true"&&env.STAGING_AUTH_ENABLED==="false"},
  {id:"CREDITS_ONLY_NO_LEGACY_PURCHASES",ready:env.HOBBY_SUBSCRIPTIONS_ENABLED!=="true"&&env.CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED!=="true"},
  {id:"MANAGED_CREDIT_MERCHANT_OF_RECORD_REVIEWED",ready:managedCreditMoRApproved(env)},
  {id:"LIVE_STRIPE_CREDIT_CHECKOUT_AND_WEBHOOK",ready:
   env.STRIPE_CREDIT_TOPUPS_LIVE_ENABLED==="true"&&
   env.STRIPE_LIVE_CHECKOUT_ENABLED==="true"&&
   LIVE_SECRET.test(env.STRIPE_SECRET_KEY||"")&&
   WEBHOOK_SECRET.test(env.STRIPE_WEBHOOK_SECRET||"")},
  {id:"PUBLIC_ACCOUNT_OWNED_CREDIT_STUDIO",ready:
   env.CUSTOMER_PUBLIC_LIVE_CREDIT_VIDEO_ENABLED==="true"&&
   env.CUSTOMER_ACCOUNTS_ENABLED==="true"&&
   env.CUSTOMER_BYTEPLUS_OWNER_CONFIRMED_PRICING==="true"&&
   env.BYTEPLUS_STUDIO_RECOVERY_ENABLED==="true"&&
   (env.BYTEPLUS_STUDIO_OPERATOR_SECRET?.length||0)>=32&&
   env.CUSTOMER_R2_STORAGE_ENABLED==="true"&&
   env.CMS_ENABLED==="true"&&
   (env.PAYLOAD_SECRET?.length||0)>=32},
  {id:"CREDIT_VIDEO_ISOLATION",ready:
   env.DEMO_MODE==="true"&&env.GENERATIONS_ENABLED==="false"&&env.ADMIN_DEMO_ENABLED==="false"},
  {id:"SUPPORT_AND_DATABASE_CONNECTED",ready:
   /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.SUPPORT_CONTACT_VERIFIED||"")&&
   /^postgres(?:ql)?:\/\/[^\s]+$/.test(env.CMS_DATABASE_URL||"")},
  {id:"CANONICAL_PRODUCTION_ORIGIN",ready:
   env.APP_ORIGIN==="https://www.singmotion.ai"&&
   env.PUBLIC_SITE_ORIGIN==="https://www.singmotion.ai"},
  ...PUBLIC_CREDIT_RELEASE_EVIDENCE.map(id=>({id,ready:env[id]==="true"})),
 ];
 return {ready:checks.every(c=>c.ready),checks};
}
export function publicCreditReleaseApproved(env:Record<string,string|undefined>):boolean{
 return assessPublicCreditRelease(env).ready;
}
