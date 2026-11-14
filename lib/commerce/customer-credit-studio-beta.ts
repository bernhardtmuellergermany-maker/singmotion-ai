/** A deliberately bounded, authenticated customer credit video beta.
 * Staging only, Stripe TEST only, with the reviewed BytePlus price and a
 * persistent cap. Never treat a public Stripe product or a signed-in email
 * as authorization for a billable provider operation.
 */
import {OWNER_CONFIRMED_BUDGET,OWNER_CONFIRMED_SINGLE_JOB_MAX_INPUT_SECONDS,ownerConfirmedBytePlusPolicy} from "./owner-confirmed-provider-policy.ts";
import {validateStudioPolicy} from "../live/studio-policy.ts";

const STAGING="dfaeabed-03df-43ed-aa71-50f343a75041";
export const CUSTOMER_STUDIO_BETA_DAILY_CAP=OWNER_CONFIRMED_BUDGET.dailyCapMicroUsd;
export const CUSTOMER_STUDIO_BETA_LIFETIME_CAP=OWNER_CONFIRMED_BUDGET.lifetimeCapMicroUsd;
export const CUSTOMER_STUDIO_BETA_MAX_SECONDS=OWNER_CONFIRMED_SINGLE_JOB_MAX_INPUT_SECONDS;
export function customerCreditStudioBetaEnabled(env:Record<string,string|undefined>):boolean{
 return env.RAILWAY_ENVIRONMENT_ID===STAGING &&
  env.CUSTOMER_CREDIT_STUDIO_TEST_ENABLED==="true" &&
  env.STAGING_AUTH_ENABLED==="true" &&
  env.DEMO_MODE==="true" && env.GENERATIONS_ENABLED==="false" &&
  env.CUSTOMER_ACCOUNTS_ENABLED==="true" &&
  env.STRIPE_CREDIT_TOPUPS_TEST_ENABLED==="true" &&
  /^sk_test_[A-Za-z0-9_]+$/.test(env.STRIPE_SECRET_KEY||"") &&
  /^whsec_[A-Za-z0-9_]+$/.test(env.STRIPE_WEBHOOK_SECRET||"") &&
  env.CUSTOMER_BYTEPLUS_OWNER_CONFIRMED_PRICING==="true" &&
  env.BYTEPLUS_STUDIO_ENABLED==="true" &&
  env.BYTEPLUS_STUDIO_RECOVERY_ENABLED==="true" &&
  (env.BYTEPLUS_STUDIO_OPERATOR_SECRET?.length||0)>=32 &&
  env.CUSTOMER_R2_STORAGE_ENABLED==="true" &&
  // The conservative reviewed policy must be current for every new admission.
  (()=>{try {validateStudioPolicy(ownerConfirmedBytePlusPolicy());return true}catch{return false}})();
}
/** No customer ID, email or wallet subject supplied by a browser is trusted. */
export function exactCustomerCreditSubject(owner:string,subject:string|null):boolean{
 return /^customer-[a-f0-9-]{36}$/.test(owner) &&
  subject==="customer:"+owner.slice("customer-".length);
}
