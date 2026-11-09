import {test} from "node:test";
import assert from "node:assert/strict";
import {assessProductionSandboxPilot,REQUESTED_PILOT} from "../lib/commerce/customer-sandbox-pilot-policy.ts";
const production="36adc41d-7e54-4396-ad1a-fd432ba0441d";
const full=()=>{
 const env:Record<string,string>={
 RAILWAY_ENVIRONMENT_ID:production,
 PRODUCTION_SANDBOX_PILOT_ENABLED:"true",
 STAGING_AUTH_ENABLED:"true",
 STAGING_PASSWORD:"x".repeat(48),
 PRODUCTION_PUBLIC_ACCESS_ENABLED:"false",
 PUBLIC_CUSTOMER_LAUNCH_APPROVED:"false",
 STRIPE_LIVE_CHECKOUT_ENABLED:"false",
 HOBBY_SUBSCRIPTIONS_ENABLED:"false",
 PRODUCTION_SANDBOX_STRIPE_SECRET_KEY:"sk_test_sandbox_key",
 PRODUCTION_SANDBOX_STRIPE_WEBHOOK_SECRET:"whsec_sandbox_secret",
 CUSTOMER_ACCOUNTS_ENABLED:"true",
 CUSTOMER_R2_STORAGE_ENABLED:"true",
 CUSTOMER_R2_PRODUCTION_RELEASE_APPROVED:"true",
 CUSTOMER_SANDBOX_CONTRACT_REVIEW_APPROVED:"true",
 CUSTOMER_SANDBOX_VIDEO_E2E_VERIFIED:"true",
 CUSTOMER_SANDBOX_COST_ALERTS_VERIFIED:"true",
 CUSTOMER_SANDBOX_EUR_BUDGET_GUARD_VERIFIED:"true",
 CUSTOMER_SANDBOX_LEGAL_TEST_REVIEW_APPROVED:"true",
 CUSTOMER_SANDBOX_RATE_MICRO_USD_PER_SECOND:"70000",
 CUSTOMER_SANDBOX_OWNER_BUDGET_EUR_CENTS:"10000",
 CUSTOMER_SANDBOX_MAX_RESERVED_MICRO_USD:"70000000",
 };
 return env;
};
test("owner request is price 7 US cents per generated second and EUR100 maximum, never interpreted as USD100",()=>{
 assert.equal(REQUESTED_PILOT.providerRateMicroUsdPerGeneratedSecond,70_000);
 assert.equal(REQUESTED_PILOT.ownerBudgetEuroCents,10_000);
 assert.ok(REQUESTED_PILOT.provisionalProviderCeilingMicroUsd<100_000_000);
});
test("default Production cannot activate sandbox spending just because it has live Stripe keys",()=>{
 const result=assessProductionSandboxPilot({RAILWAY_ENVIRONMENT_ID:production,
  STRIPE_SECRET_KEY:"sk_live_synthetic",STRIPE_WEBHOOK_SECRET:"whsec_live_synthetic"});
 assert.equal(result.ready,false);
 assert.ok(result.blockers.includes("PILOT_NOT_ENABLED"));
 assert.ok(result.blockers.includes("DEDICATED_STRIPE_TEST_KEY_REQUIRED"));
 assert.ok(result.blockers.includes("PRIVATE_PASSWORD_GATE_REQUIRED"));
});
test("sandbox approval fails shut if ANY required gate is missing or inconsistent",()=>{
 const ready=full();
 assert.deepEqual(assessProductionSandboxPilot(ready),{ready:true,blockers:[]});
 for(const key of Object.keys(ready).filter(key=>ready[key]!=="false")){
  const changed={...ready,[key]:"false"};
  assert.equal(assessProductionSandboxPilot(changed).ready,false,key);
 }
 for(const key of ["PUBLIC_CUSTOMER_LAUNCH_APPROVED","STRIPE_LIVE_CHECKOUT_ENABLED",
  "PRODUCTION_PUBLIC_ACCESS_ENABLED","HOBBY_SUBSCRIPTIONS_ENABLED"]){
  assert.equal(assessProductionSandboxPilot({...ready,[key]:"true"}).ready,false,key);
 }
 assert.equal(assessProductionSandboxPilot({...ready,
  PRODUCTION_SANDBOX_STRIPE_SECRET_KEY:"sk_live_wrong_mode"}).ready,false);
 assert.equal(assessProductionSandboxPilot({...ready,
  CUSTOMER_SANDBOX_OWNER_BUDGET_EUR_CENTS:"100000"}).ready,false);
 assert.equal(assessProductionSandboxPilot({...ready,
  CUSTOMER_SANDBOX_RATE_MICRO_USD_PER_SECOND:"700"}).ready,false);
});
