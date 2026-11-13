/** Separately reviewed private Production Stripe LIVE pilot.
 *
 * This is NOT the public launch gate and NEVER turns a service public.
 * A configured live API key, a password, or this flag alone is insufficient
 * to admit money or provider spending. Every missing attestation fails closed.
 */
const PRODUCTION="36adc41d-7e54-4396-ad1a-fd432ba0441d";
const requiredProofs=[
 "PRODUCTION_PRIVATE_LIVE_PILOT_APPROVED",
 "PRODUCTION_PRIVATE_LIVE_WEBHOOK_VERIFIED",
 "PRODUCTION_PRIVATE_LIVE_PRICE_TAX_APPROVED",
 "PRODUCTION_MEDIA_MIGRATION_VERIFIED",
 "PRODUCTION_CMS_BACKUP_RESTORE_VERIFIED",
 "PRODUCTION_CMS_RBAC_AND_PUBLISH_E2E_VERIFIED",
 "STRIPE_ACCOUNT_LIVE_REVIEW_APPROVED",
 "BYTEPLUS_BILLING_AND_TAX_APPROVED",
 "BYTEPLUS_OUTPUT_HOSTS_APPROVED",
 "CUSTOMER_CLOUD_E2E_VERIFIED",
 "CUSTOMER_R2_PRODUCTION_RELEASE_APPROVED",
 "BACKUP_RESTORE_EXERCISE_VERIFIED",
 "COST_ALERTS_AND_KILL_SWITCH_VERIFIED",
 "CUSTOMER_PRODUCTION_PROVIDER_BUDGET_APPROVED",
 "CUSTOMER_BYTEPLUS_OWNER_CONFIRMED_PRICING",
 "LEGAL_REVIEW_APPROVED",
] as const;
const requiredRuntime=[
 "CUSTOMER_ACCOUNTS_ENABLED",
 "CUSTOMER_GENERATION_ENABLED",
 "CUSTOMER_FULFILLMENT_ENABLED",
 "CUSTOMER_DELIVERY_ENABLED",
 "CUSTOMER_R2_STORAGE_ENABLED",
 "CUSTOMER_PAID_WORKER_ENABLED",
 "CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED",
 "CMS_ENABLED",
] as const;

export function privateProductionLiveProviderCap(env:Record<string,string|undefined>):number|null{
 const value=env.PRODUCTION_PRIVATE_LIVE_PROVIDER_MICRO_USD_CAP||"";
 if(!/^[1-9][0-9]{5,8}$/.test(value))return null;
 const cap=Number(value);
 return Number.isSafeInteger(cap)&&cap>=1_000_000&&cap<=100_000_000?cap:null;
}

export function assessProtectedProductionLivePilot(env:Record<string,string|undefined>){
 const blockers:string[]=[];
 const check=(valid:boolean,reason:string)=>{if(!valid)blockers.push(reason);};
 check(env.RAILWAY_ENVIRONMENT_ID===PRODUCTION,"PRODUCTION_ONLY");
 check(env.PRODUCTION_PRIVATE_LIVE_PILOT_ENABLED==="true","PRIVATE_LIVE_PILOT_DISABLED");
 check(env.STAGING_AUTH_ENABLED==="true"&&(env.STAGING_PASSWORD?.length||0)>=32,"BASIC_AUTH_REQUIRED");
 check(env.PRODUCTION_PUBLIC_ACCESS_ENABLED==="false"&&
   env.PUBLIC_CUSTOMER_LAUNCH_APPROVED==="false","PUBLIC_LAUNCH_MUST_REMAIN_OFF");
 check(env.PRODUCTION_SANDBOX_PILOT_ENABLED!=="true","SANDBOX_PILOT_MUST_REMAIN_OFF");
 check(env.DEMO_MODE==="true"&&env.GENERATIONS_ENABLED==="false"&&
   env.ADMIN_DEMO_ENABLED==="false"&&env.BYTEPLUS_LIVE_TEST_ENABLED!=="true",
   "PRIVATE_WORKER_RUNTIME_REQUIRED");
 check(env.STRIPE_LIVE_CHECKOUT_ENABLED==="true"&&
   /^(?:sk|rk)_live_[A-Za-z0-9_]+$/.test(env.STRIPE_SECRET_KEY||"")&&
   /^whsec_[A-Za-z0-9_]+$/.test(env.STRIPE_WEBHOOK_SECRET||""),
   "SIGNED_LIVE_STRIPE_REQUIRED");
 check(env.HOBBY_SUBSCRIPTIONS_ENABLED!=="true","HOBBY_LIVE_OFFER_NOT_REVIEWED");
 check(env.APP_ORIGIN==="https://www.singmotion.ai"&&
   env.PUBLIC_SITE_ORIGIN==="https://www.singmotion.ai","CANONICAL_PRODUCTION_ORIGIN_REQUIRED");
 check(requiredProofs.every(key=>env[key]==="true"),"INDEPENDENT_LIVE_APPROVALS_REQUIRED");
 check(requiredRuntime.every(key=>env[key]==="true"),"CUSTOMER_FULFILLMENT_RUNTIME_REQUIRED");
 check(typeof env.SUPPORT_CONTACT_VERIFIED==="string"&&
   /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.SUPPORT_CONTACT_VERIFIED),
   "VERIFIED_SUPPORT_CONTACT_REQUIRED");
 check(env.CMS_DATABASE_URL?.startsWith("postgresql://")===true||
   env.CMS_DATABASE_URL?.startsWith("postgres://")===true,
   "PRODUCTION_CMS_DATABASE_REQUIRED");
 check((env.PAYLOAD_SECRET?.length||0)>=32,"CMS_SIGNING_SECRET_REQUIRED");
 const activation=Number(env.CUSTOMER_PAID_WORKER_ACTIVATED_AT);
 // Never sweep historical payments before this release; do not expire the
 // worker after 24h while already-paid orders still require fulfillment.
 const earliest=Date.parse("2026-11-13T14:00:00.000Z");
 check(Number.isSafeInteger(activation)&&activation>=earliest&&activation<=Date.now(),
   "REVIEWED_PRIVATE_WORKER_ACTIVATION_REQUIRED");
 check(privateProductionLiveProviderCap(env)!==null,"FINITE_PRIVATE_PROVIDER_BUDGET_REQUIRED");
 return {ready:blockers.length===0,blockers};
}
export function protectedProductionLivePilotApproved(env:Record<string,string|undefined>):boolean{
 return assessProtectedProductionLivePilot(env).ready;
}
