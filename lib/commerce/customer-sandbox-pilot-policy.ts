/** Read-only Production sandbox pilot preflight. This module NEVER enables checkout
 * or provider calls. It records the owner's requested budget separately from
 * proven provider ceilings and cannot convert EUR to USD without a reviewed FX
 * allowance. Do not conflate Sandbox on Production with the public launch. */
const PRODUCTION="36adc41d-7e54-4396-ad1a-fd432ba0441d";
export const REQUESTED_PILOT=Object.freeze({
 origin:"https://www.singmotion.ai",
 providerRateMicroUsdPerGeneratedSecond:70_000,
 ownerBudgetEuroCents:10_000,
 // Intentionally conservative maximum provider reservation, NOT an FX conversion.
 provisionalProviderCeilingMicroUsd:70_000_000,
});
export type PilotAssessment={ready:boolean;blockers:string[]};
export function assessProductionSandboxPilot(env:Record<string,string|undefined>):PilotAssessment{
 const blockers:string[]=[];
 const check=(ok:boolean,code:string)=>{if(!ok)blockers.push(code)};
 check(env.RAILWAY_ENVIRONMENT_ID===PRODUCTION,"WRONG_ENVIRONMENT");
 check(env.PRODUCTION_SANDBOX_PILOT_ENABLED==="true","PILOT_NOT_ENABLED");
 check(env.STAGING_AUTH_ENABLED==="true" && (env.STAGING_PASSWORD?.length||0)>=32,"PRIVATE_PASSWORD_GATE_REQUIRED");
 check(env.PRODUCTION_PUBLIC_ACCESS_ENABLED!=="true","PUBLIC_ACCESS_MUST_REMAIN_OFF");
 check(env.PUBLIC_CUSTOMER_LAUNCH_APPROVED!=="true","PUBLIC_CUSTOMER_LAUNCH_MUST_REMAIN_OFF");
 check(env.STRIPE_LIVE_CHECKOUT_ENABLED!=="true","LIVE_STRIPE_MUST_REMAIN_OFF");
 check(env.HOBBY_SUBSCRIPTIONS_ENABLED!=="true","LIVE_SUBSCRIPTIONS_MUST_REMAIN_OFF");
 check(/^sk_test_[A-Za-z0-9_]+$/.test(env.PRODUCTION_SANDBOX_STRIPE_SECRET_KEY||""),"DEDICATED_STRIPE_TEST_KEY_REQUIRED");
 check(/^whsec_[A-Za-z0-9_]+$/.test(env.PRODUCTION_SANDBOX_STRIPE_WEBHOOK_SECRET||""),"DEDICATED_SIGNED_SANDBOX_WEBHOOK_REQUIRED");
 check(env.CUSTOMER_ACCOUNTS_ENABLED==="true","CUSTOMER_ACCOUNTS_REQUIRED");
 check(env.CUSTOMER_R2_STORAGE_ENABLED==="true" && env.CUSTOMER_R2_PRODUCTION_RELEASE_APPROVED==="true","VERIFIED_PRIVATE_PRODUCTION_STORAGE_REQUIRED");
 check(env.CUSTOMER_SANDBOX_CONTRACT_REVIEW_APPROVED==="true","INDEPENDENT_BYTEPLUS_TERMS_REQUIRED");
 // The first isolated Sandbox order is itself the E2E validation. Never
 // require completed-video proof before allowing that first bounded test.
 // PUBLIC Production launch remains blocked on its independent E2E proof.
 check(env.CUSTOMER_SANDBOX_COST_ALERTS_VERIFIED==="true","COST_MONITORING_AND_KILL_SWITCH_REQUIRED");
 check(env.CUSTOMER_SANDBOX_EUR_BUDGET_GUARD_VERIFIED==="true","EUR_BUDGET_GUARD_REQUIRED");
 check(env.CUSTOMER_SANDBOX_LEGAL_TEST_REVIEW_APPROVED==="true","LEGAL_REVIEW_FOR_TEST_PARTICIPANTS_REQUIRED");
 check(env.CUSTOMER_SANDBOX_RATE_MICRO_USD_PER_SECOND==="70000","PRICE_ASSUMPTION_MISMATCH");
 check(env.CUSTOMER_SANDBOX_OWNER_BUDGET_EUR_CENTS==="10000","OWNER_BUDGET_MISMATCH");
 check(env.CUSTOMER_SANDBOX_MAX_RESERVED_MICRO_USD==="70000000","PROVISIONAL_SPEND_CEILING_MISMATCH");
 // Presence of these variables is NOT proof of an enforced spending cap.
 return {ready:blockers.length===0,blockers};
}
