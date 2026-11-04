/** Release audit that deliberately cannot launch payments or provider jobs.
 * This checklist is advisory and fail-closed; it never promotes a build,
 * flips a feature flag, reads secret values into output or calls providers.
 */
import {customerLaunchReadiness} from "./commerce/readiness.ts";

export type ReleaseEnvironment="staging"|"production";
export type GateState={id:string;ready:boolean;reason:string};
export type LaunchAudit={environment:ReleaseEnvironment;ready:boolean;gates:GateState[]};
const staging="dfaeabed-03df-43ed-aa71-50f343a75041";
const production="36adc41d-7e54-4396-ad1a-fd432ba0441d";
const yes=(env:Record<string,string|undefined>,name:string)=>env[name]==="true";
const has=(env:Record<string,string|undefined>,name:string)=>Boolean(env[name]?.trim());
/** Explicit required proof flags represent independently audited human
 * milestones, NOT success fabricated from the mere presence of credentials.
 */
export function auditSingMotionLaunch(
 env:Record<string,string|undefined>,
 target:ReleaseEnvironment,
):LaunchAudit{
 const envId=target==="staging"?staging:production;
 const actual=env.RAILWAY_ENVIRONMENT_ID;
 const correct=actual===envId;
 const isProd=target==="production";
 const gates:GateState[]=[];
 const add=(id:string,ready:boolean,reason:string)=>gates.push({id,ready,reason});
 add("environment",correct,"Run this audit in the intended Railway environment.");
 add("private-r2",correct&&yes(env,"CUSTOMER_R2_STORAGE_ENABLED")&&
  (!isProd||yes(env,"CUSTOMER_R2_PRODUCTION_RELEASE_APPROVED"))&&
  ["R2_ACCOUNT_ID","R2_BUCKET","R2_ACCESS_KEY_ID","R2_SECRET_ACCESS_KEY"].every(k=>has(env,k)),
  "Production needs its own private R2 credentials, a connectivity test and explicit two-switch approval.");
 add("production-media-migration",!isProd||yes(env,"PRODUCTION_MEDIA_MIGRATION_VERIFIED"),
  "Reconcile every Production asset against a private R2 SHA-256 readback report.");
 add("customer-e2e",yes(env,"CUSTOMER_CLOUD_E2E_VERIFIED"),
  "Authenticated upload, cloud-only Studio recovery, verified private download, denied cross-owner access.");
 add("provider-contract",yes(env,"BYTEPLUS_BILLING_AND_TAX_APPROVED")&&
  yes(env,"BYTEPLUS_OUTPUT_HOSTS_APPROVED")&&yes(env,"CUSTOMER_PAID_PROVIDER_E2E_VERIFIED"),
  "Verify exact BytePlus charges including tax, output hosts, task recovery and actual paid/provider sandbox flow.");
 add("stripe",yes(env,"STRIPE_ACCOUNT_LIVE_REVIEW_APPROVED")&&
  has(env,"STRIPE_LIVE_CUSTOMER_CHECKOUT_AUDIT_ID")&&
  yes(env,"STRIPE_REFUND_DISPUTE_E2E_VERIFIED"),
  "Separate Stripe live onboarding, full checkout/refund/dispute validation and audited webhook reconciliation.");
 add("code-runtime-readiness",customerLaunchReadiness(env).readyForPaidOrders,
  "Verified checkout, provider submission and private delivery must actually be connected in code; operator flags alone never authorize launch.");
 add("zero-euro-promo",yes(env,"FREE_PROMO_FULFILLMENT_E2E_VERIFIED"),
  "Three-video free entitlement must use audited zero-EUR authorization and capped provider spending.");
 add("legal-and-support",yes(env,"LEGAL_REVIEW_APPROVED")&&has(env,"SUPPORT_CONTACT_VERIFIED"),
  "Human-reviewed Impressum, privacy, terms, consent, invoices/taxes and actual support/abuse contacts.");
 add("operational-recovery",yes(env,"BACKUP_RESTORE_EXERCISE_VERIFIED")&&
  yes(env,"MEDIA_RETENTION_NOTICE_FLOW_VERIFIED")&&yes(env,"COST_ALERTS_AND_KILL_SWITCH_VERIFIED"),
  "Backups, recovery, retention notice, daily cost alerts and emergency stop must be tested.");
 // A green staging CMS build does not prove the Production CMS exists.
 // Require separate reviewed migration/restore and CMS login + roles +
 // modern homepage editing checks before approving a public cutover.
 add("production-cms",!isProd||(
  yes(env,"CMS_ENABLED")&&has(env,"CMS_DATABASE_URL")&&has(env,"PAYLOAD_SECRET")&&
  yes(env,"PRODUCTION_CMS_MIGRATION_VERIFIED")&&
  yes(env,"PRODUCTION_CMS_BACKUP_RESTORE_VERIFIED")&&
  yes(env,"PRODUCTION_CMS_RBAC_AND_PUBLISH_E2E_VERIFIED")),
  "Modern Payload CMS must be deployed with independently reviewed schema migration, backup/restore, role and publishing E2E in Production.");
 add("cms-page-retention",!isProd||yes(env,"CMS_PUBLISHED_CONTENT_RECONCILED"),
  "Compare published CMS records and public routes, review legacy drafts and preserve legal/previously published content.");
 add("customer-release",!isProd||yes(env,"PUBLIC_CUSTOMER_LAUNCH_APPROVED"),
  "Explicit operator production go-live signoff is required after every gate passes.");
 return {environment:target,ready:gates.every(g=>g.ready),gates};
}
