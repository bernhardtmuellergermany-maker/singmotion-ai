import type {CreditTaxDecision} from "./worldwide-credit-tax.ts";

/** A reversible, password-protected, Production-only LIVE Credit checkout test.
 * It cannot grant public access, assert a tax exemption, or enable legacy video
 * Checkout. This is an isolated owner-operated acceptance flow, not release
 * approval for unrelated buyers or geographies.
 */
const PROD="36adc41d-7e54-4396-ad1a-fd432ba0441d";
export function privateLiveCreditTestEnabled(env:Record<string,string|undefined>):boolean{
 return env.RAILWAY_ENVIRONMENT_ID===PROD &&
  env.PRODUCTION_PRIVATE_CREDIT_TEST_ENABLED==="true" &&
  env.STAGING_AUTH_ENABLED==="true" &&
  (env.STAGING_PASSWORD?.length||0)>=32 &&
  env.PRODUCTION_PUBLIC_ACCESS_ENABLED==="false" &&
  env.PUBLIC_CUSTOMER_LAUNCH_APPROVED==="false" &&
  env.PRODUCTION_SANDBOX_PILOT_ENABLED!=="true" &&
  env.HOBBY_SUBSCRIPTIONS_ENABLED!=="true" &&
  env.APP_ORIGIN==="https://www.singmotion.ai" &&
  env.PUBLIC_SITE_ORIGIN==="https://www.singmotion.ai" &&
  env.DEMO_MODE==="true" && env.GENERATIONS_ENABLED==="false" &&
  env.ADMIN_DEMO_ENABLED==="false" &&
  env.CMS_ENABLED==="true" && env.CUSTOMER_ACCOUNTS_ENABLED==="true" &&
  (env.PAYLOAD_SECRET?.length||0)>=32 &&
  /^(?:sk|rk)_live_[A-Za-z0-9_]+$/.test(env.STRIPE_SECRET_KEY||"") &&
  /^whsec_[A-Za-z0-9_]+$/.test(env.STRIPE_WEBHOOK_SECRET||"");
}

/** Owner's initial real-money payment test: German private buyer only.
 * This intentionally makes NO claim about voucher tax-point classification
 * or VAT exemption. Stripe receives the actual product tax code and computes
 * tax using its configured registrations; a missing/invalid tax setup must
 * fail the external Checkout rather than silently assume a tax rate. */
export function privateLiveCreditTestTaxDecision(country:unknown,buyer:unknown):
 {ready:boolean;reason:string;decision:CreditTaxDecision|null}{
 if(country!=="DE"||buyer!=="consumer")return {
  ready:false,reason:"PRIVATE_LIVE_TRIAL_DE_PRIVATE_CUSTOMER_ONLY",decision:null
 };
 return {ready:true,reason:"PRIVATE_LIVE_OWNER_VERIFICATION_NOT_PUBLIC_TAX_APPROVAL",
  decision:{country:"DE",buyerType:"consumer",
   voucherKind:"private-test-unclassified",
   mode:"private-live-verification",revision:"private-owner-checkout-v1",
   taxAtIssue:false,taxCode:null}};
}
