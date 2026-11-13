import {worldwideTaxPolicyAvailable} from "./worldwide-credit-tax.ts";
/** Independently gated private LIVE Credit purchases on Production.
 * This does not approve public access or permit BytePlus dispatch.
 * All checks fail closed; attestations must reflect actual verified evidence.
 */
const PRODUCTION="36adc41d-7e54-4396-ad1a-fd432ba0441d";
export function assessPrivateCreditPilot(env:Record<string,string|undefined>){
 const blockers:string[]=[];
 const check=(ok:boolean,name:string)=>{if(!ok)blockers.push(name);};
 check(env.RAILWAY_ENVIRONMENT_ID===PRODUCTION,"PRODUCTION_ONLY");
 check(env.PRODUCTION_PRIVATE_CREDIT_PILOT_APPROVED==="true","CREDIT_PILOT_NOT_APPROVED");
 check(env.STAGING_AUTH_ENABLED==="true"&&(env.STAGING_PASSWORD?.length||0)>=32,"PRIVATE_PASSWORD_REQUIRED");
 check(env.PRODUCTION_PUBLIC_ACCESS_ENABLED==="false"&&env.PUBLIC_CUSTOMER_LAUNCH_APPROVED==="false","PUBLIC_ACCESS_MUST_REMAIN_CLOSED");
 check(env.PRODUCTION_SANDBOX_PILOT_ENABLED!=="true","SANDBOX_PILOT_CONFLICT");
 check(env.APP_ORIGIN==="https://www.singmotion.ai"&&env.PUBLIC_SITE_ORIGIN==="https://www.singmotion.ai","PRODUCTION_ORIGIN_REQUIRED");
 check(env.CUSTOMER_ACCOUNTS_ENABLED==="true","ACCOUNT_LOGIN_REQUIRED");
 check(env.CMS_ENABLED==="true"&&(env.PAYLOAD_SECRET?.length||0)>=32,"CMS_IDENTITY_REQUIRED");
 check(env.STRIPE_CREDIT_TOPUPS_LIVE_ENABLED==="true"&&env.STRIPE_LIVE_CHECKOUT_ENABLED==="true","LIVE_CREDIT_CHECKOUT_DISABLED");
 check(env.STRIPE_ACCOUNT_LIVE_REVIEW_APPROVED==="true","STRIPE_LIVE_REVIEW_REQUIRED");
 check(worldwideTaxPolicyAvailable(env),"REVIEWED_COUNTRY_BY_COUNTRY_CREDIT_TAX_POLICY_REQUIRED");
 check(env.PRODUCTION_PRIVATE_CREDIT_WEBHOOK_VERIFIED==="true","SIGNED_LIVE_WEBHOOK_REVIEW_REQUIRED");
 check(env.PRODUCTION_PRIVATE_CREDIT_REFUND_VERIFIED==="true","REFUND_RECONCILIATION_REQUIRED");
 check(env.PRODUCTION_PRIVATE_CREDIT_BACKUP_RESTORE_VERIFIED==="true","CREDIT_LEDGER_BACKUP_RESTORE_REQUIRED");
 check(/^(?:sk|rk)_live_[A-Za-z0-9_]+$/.test(env.STRIPE_SECRET_KEY||"")&&/^whsec_[A-Za-z0-9_]+$/.test(env.STRIPE_WEBHOOK_SECRET||""),"MATCHED_LIVE_STRIPE_SECRETS_REQUIRED");
 return {ready:blockers.length===0,blockers};
}
export const privateCreditPilotApproved=(env:Record<string,string|undefined>)=>assessPrivateCreditPilot(env).ready;
