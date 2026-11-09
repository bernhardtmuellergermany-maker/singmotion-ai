import {test} from "node:test";
import assert from "node:assert/strict";
import {assessProductionSandboxPilot,REQUESTED_PILOT,privatePilotEurBudgetCap} from "../lib/commerce/customer-sandbox-pilot-policy.ts";
import {configuredStripePaymentMode,configuredStripeReversalMode,stripeWebhookEventAdmitted,customerStripeCredential,customerStripeWebhookSecret} from "../lib/commerce/stripe-payment-mode.ts";
import {customerWorkerEnabled,boundPrivatePilotPolicy} from "../lib/commerce/customer-paid-worker.ts";
import {productionCustomerReleaseApproved} from "../lib/commerce/customer-live-config.ts";
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
 CUSTOMER_SANDBOX_COST_ALERTS_VERIFIED:"true",
 CUSTOMER_SANDBOX_EUR_BUDGET_GUARD_VERIFIED:"true",
 CUSTOMER_SANDBOX_LEGAL_TEST_REVIEW_APPROVED:"true",
 CUSTOMER_SANDBOX_RATE_MICRO_USD_PER_SECOND:"70000",
 CUSTOMER_SANDBOX_OWNER_BUDGET_EUR_CENTS:"10000",
 CUSTOMER_SANDBOX_MAX_RESERVED_MICRO_USD:"70000000",
 CUSTOMER_SANDBOX_EUR_PER_USD_UPPER_PPM:"1200000",
 CUSTOMER_SANDBOX_MAX_EXTRA_EUR_CENTS:"1000",
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

test("private Production Sandbox uses its own test API key and webhook secret, never live secrets",()=>{
 const e:Record<string,string>={...full(),STRIPE_SECRET_KEY:"sk_live_liveaccount",STRIPE_WEBHOOK_SECRET:"whsec_liveaccount"};
 assert.equal(configuredStripePaymentMode(e),"test");
 assert.equal(customerStripeCredential(e,"test"),e.PRODUCTION_SANDBOX_STRIPE_SECRET_KEY);
 assert.equal(customerStripeWebhookSecret(e,"test"),e.PRODUCTION_SANDBOX_STRIPE_WEBHOOK_SECRET);
 assert.equal(productionCustomerReleaseApproved(e),false);
 assert.equal(configuredStripePaymentMode({...e,PRODUCTION_SANDBOX_PILOT_ENABLED:"false"}),null);
 assert.equal(configuredStripePaymentMode({...e,STRIPE_LIVE_CHECKOUT_ENABLED:"true"}),null);
 assert.equal(configuredStripePaymentMode({...e,PRODUCTION_PUBLIC_ACCESS_ENABLED:"true"}),null);
 assert.equal(customerStripeCredential({...e,PRODUCTION_SANDBOX_STRIPE_SECRET_KEY:"sk_live_wrong"},"test"),null);
});
test("private Production worker requires every worker flag, scoped owner, and activation time",()=>{
 const e={...full(),CUSTOMER_PAID_WORKER_ENABLED:"true",
  CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED:"true",
  CUSTOMER_BYTEPLUS_OWNER_CONFIRMED_PRICING:"true",
  CUSTOMER_PAID_WORKER_ACTIVATED_AT:"1"};
 assert.equal(customerWorkerEnabled(e),true);
 for(const flag of ["CUSTOMER_PAID_WORKER_ENABLED","CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED",
   "CUSTOMER_BYTEPLUS_OWNER_CONFIRMED_PRICING","CUSTOMER_PAID_WORKER_ACTIVATED_AT"]){
  assert.equal(customerWorkerEnabled({...e,[flag]:"false"}),false,flag);
 }
 assert.equal(customerWorkerEnabled({...e,PRODUCTION_SANDBOX_PILOT_ENABLED:"false"}),false);
});
test("private Production provider reservation enforces conservative lifetime and daily USD ceiling",()=>{
 const e=full();
 const fixture={dailyCapMicroUsd:200_000_000,lifetimeCapMicroUsd:500_000_000,
  contract:{billing:{microUsdPerSecond:70_000}}} as unknown as Parameters<typeof boundPrivatePilotPolicy>[0];
 const bounded=boundPrivatePilotPolicy(fixture,e);
 assert.equal(bounded.dailyCapMicroUsd,70_000_000);
 assert.equal(bounded.lifetimeCapMicroUsd,70_000_000);
 assert.equal(fixture.lifetimeCapMicroUsd,500_000_000);
 assert.equal(boundPrivatePilotPolicy({...fixture, dailyCapMicroUsd:35_000_000},e).dailyCapMicroUsd,35_000_000);
 assert.throws(()=>boundPrivatePilotPolicy({...fixture,contract:{...fixture.contract,billing:{
  ...fixture.contract.billing,microUsdPerSecond:700}}},e),/rate mismatch/);
 assert.equal(boundPrivatePilotPolicy(fixture,{...e,PRODUCTION_SANDBOX_PILOT_ENABLED:"false"}).lifetimeCapMicroUsd,500_000_000);
});

test("first bounded private pilot order does not require claiming an E2E test has already succeeded",()=>{
 assert.equal(assessProductionSandboxPilot({...full(),CUSTOMER_SANDBOX_VIDEO_E2E_VERIFIED:"false"}).ready,true);
});

test("private sandbox budget reserves upper EUR conversion and extra costs without upward rounding",()=>{
 const e=full();
 assert.equal(privatePilotEurBudgetCap(e),70_000_000);
 assert.equal(privatePilotEurBudgetCap({...e,CUSTOMER_SANDBOX_EUR_PER_USD_UPPER_PPM:"1500000"}),60_000_000);
 assert.equal(privatePilotEurBudgetCap({...e,CUSTOMER_SANDBOX_EUR_PER_USD_UPPER_PPM:"1500000",CUSTOMER_SANDBOX_MAX_EXTRA_EUR_CENTS:"2500"}),50_000_000);
 assert.equal(privatePilotEurBudgetCap({...e,CUSTOMER_SANDBOX_EUR_PER_USD_UPPER_PPM:"false"}),null);
 assert.equal(privatePilotEurBudgetCap({...e,CUSTOMER_SANDBOX_MAX_EXTRA_EUR_CENTS:"10000"}),null);
 assert.equal(privatePilotEurBudgetCap({...e,CUSTOMER_SANDBOX_EUR_PER_USD_UPPER_PPM:"0"}),null);
 assert.equal(assessProductionSandboxPilot({...e,CUSTOMER_SANDBOX_EUR_PER_USD_UPPER_PPM:"false"}).ready,false);
 const fixture={dailyCapMicroUsd:200_000_000,lifetimeCapMicroUsd:500_000_000,
  contract:{billing:{microUsdPerSecond:70_000}}} as unknown as Parameters<typeof boundPrivatePilotPolicy>[0];
 const tighter=boundPrivatePilotPolicy(fixture,{...e,CUSTOMER_SANDBOX_EUR_PER_USD_UPPER_PPM:"1500000"});
 assert.equal(tighter.dailyCapMicroUsd,60_000_000);
 assert.equal(tighter.lifetimeCapMicroUsd,60_000_000);
});

test("paused private Production Sandbox accepts signed TEST reversals but not new settlements",()=>{
 const paused:Record<string,string>={...full(),
  PRODUCTION_SANDBOX_PILOT_ENABLED:"false",
  STRIPE_SECRET_KEY:"sk_live_otheraccount",
  STRIPE_WEBHOOK_SECRET:"whsec_otheraccount",
 };
 assert.equal(configuredStripePaymentMode(paused),null);
 assert.equal(configuredStripeReversalMode(paused),"test");
 assert.equal(configuredStripeReversalMode({...paused,STRIPE_SECRET_KEY:"",STRIPE_WEBHOOK_SECRET:""}),"test");
 assert.equal(customerStripeCredential(paused,"test"),paused.PRODUCTION_SANDBOX_STRIPE_SECRET_KEY);
 assert.equal(customerStripeWebhookSecret(paused,"test"),paused.PRODUCTION_SANDBOX_STRIPE_WEBHOOK_SECRET);
 assert.equal(stripeWebhookEventAdmitted("refund.created",false),true);
 assert.equal(stripeWebhookEventAdmitted("refund.updated",false),true);
 assert.equal(stripeWebhookEventAdmitted("charge.dispute.created",false),true);
 assert.equal(stripeWebhookEventAdmitted("checkout.session.completed",false),false);
 assert.equal(stripeWebhookEventAdmitted("checkout.session.async_payment_succeeded",false),false);
 for(const [key,value] of [
  ["STAGING_AUTH_ENABLED","false"],
  ["STAGING_PASSWORD","tiny"],
  ["PRODUCTION_PUBLIC_ACCESS_ENABLED","true"],
  ["PUBLIC_CUSTOMER_LAUNCH_APPROVED","true"],
  ["STRIPE_LIVE_CHECKOUT_ENABLED","true"],
  ["PRODUCTION_SANDBOX_STRIPE_SECRET_KEY","sk_live_wrong"],
  ["PRODUCTION_SANDBOX_STRIPE_WEBHOOK_SECRET","false"],
 ]){
  assert.notEqual(configuredStripeReversalMode({...paused,[key]:value}),"test",key);
 }
});
