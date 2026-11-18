/** Private international LIVE Credit cohort behind the existing shared site password.
 *
 * This gate is intentionally independent of public launch. No public opening,
 * unreviewed tax/product assumptions or bypass of owner-scoped Wallet checks.
 * All signed Stripe receipts, R2 ownership and BytePlus policy still apply.
 */
import {managedCreditMoRApproved} from "./managed-credit-payments.ts";

const PROD="36adc41d-7e54-4396-ad1a-fd432ba0441d";
const LIVE_SECRET=/^(?:sk|rk)_live_[A-Za-z0-9_]+$/;
const WEBHOOK_SECRET=/^whsec_[A-Za-z0-9_]+$/;

/** This is a runtime gate, not evidence that Stripe has approved the account. */
export function assessPrivateInternationalCreditBeta(env:Record<string,string|undefined>){
 const checks=[
  {id:"PRIVATE_PRODUCTION_ONLY",ready:env.RAILWAY_ENVIRONMENT_ID===PROD},
  {id:"BETA_OPERATOR_APPROVED",ready:env.PRODUCTION_PRIVATE_INTERNATIONAL_CREDIT_BETA_ENABLED==="true"},
  {id:"PASSWORD_GATE_REMAINS_ENABLED",ready:env.STAGING_AUTH_ENABLED==="true"&&
    (env.STAGING_PASSWORD?.length||0)>=32},
  {id:"PUBLIC_LAUNCH_STAYS_DISABLED",ready:env.PRODUCTION_PUBLIC_ACCESS_ENABLED==="false"&&
    env.PUBLIC_CUSTOMER_LAUNCH_APPROVED==="false"},
  {id:"REVIEWED_MANAGED_PAYMENTS_ACCOUNT_AND_CREDITS",ready:managedCreditMoRApproved(env)&&
    env.STRIPE_ACCOUNT_LIVE_REVIEW_APPROVED==="true"},
  {id:"LIVE_CREDIT_CHECKOUT_AND_WEBHOOK",ready:env.STRIPE_CREDIT_TOPUPS_LIVE_ENABLED==="true"&&
    env.STRIPE_LIVE_CHECKOUT_ENABLED==="true"&&
    LIVE_SECRET.test(env.STRIPE_SECRET_KEY||"")&&
    WEBHOOK_SECRET.test(env.STRIPE_WEBHOOK_SECRET||"")},
  {id:"ACCOUNT_OWNED_CUSTOMER_STUDIO",ready:
    env.CUSTOMER_PRIVATE_LIVE_CREDIT_VIDEO_ENABLED==="true"&&
    env.CUSTOMER_ACCOUNTS_ENABLED==="true"&&
    env.CMS_ENABLED==="true"&&
    (env.PAYLOAD_SECRET?.length||0)>=32},
  {id:"REVIEWED_BYTEPLUS_STUDIO_AND_RECOVERY",ready:
    env.CUSTOMER_BYTEPLUS_OWNER_CONFIRMED_PRICING==="true"&&
    env.BYTEPLUS_STUDIO_RECOVERY_ENABLED==="true"&&
    (env.BYTEPLUS_STUDIO_OPERATOR_SECRET?.length||0)>=32&&
    (env.BYTEPLUS_ACCESS_KEY_ID?.length||0)>=8&&
    (env.BYTEPLUS_SECRET_ACCESS_KEY?.length||0)>=16},
  {id:"PRIVATE_R2_DELIVERY",ready:
    env.CUSTOMER_R2_STORAGE_ENABLED==="true"&&
    !!env.R2_ACCOUNT_ID&&!!env.R2_BUCKET&&
    !!env.R2_ACCESS_KEY_ID&&!!env.R2_SECRET_ACCESS_KEY},
  {id:"PRIVATE_CREDITS_RUNTIME_ISOLATION",ready:
    env.DEMO_MODE==="true"&&env.GENERATIONS_ENABLED==="false"&&
    env.ADMIN_DEMO_ENABLED==="false"&&env.HOBBY_SUBSCRIPTIONS_ENABLED!=="true"&&
    env.CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED!=="true"},
  {id:"CANONICAL_LIVE_DOMAIN",ready:env.APP_ORIGIN==="https://www.singmotion.ai"&&
    env.PUBLIC_SITE_ORIGIN==="https://www.singmotion.ai"},
 ];
 return {ready:checks.every(c=>c.ready),checks};
}
export function privateInternationalCreditBetaEnabled(env:Record<string,string|undefined>):boolean{
 return assessPrivateInternationalCreditBeta(env).ready;
}
