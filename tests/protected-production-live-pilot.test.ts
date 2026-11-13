import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {assessProtectedProductionLivePilot,protectedProductionLivePilotApproved,
 privateProductionLiveProviderCap} from "../lib/commerce/protected-production-live-pilot.ts";
import {configuredStripePaymentMode,configuredStripeReversalMode,
 stripeSessionIdMatchesMode} from "../lib/commerce/stripe-payment-mode.ts";
import {productionCustomerReleaseApproved,customerAccountSettingsAccessible} from "../lib/commerce/customer-live-config.ts";
import {customerWorkerEnabled,boundPrivatePilotPolicy} from "../lib/commerce/customer-paid-worker.ts";
import {customerLaunchReadiness} from "../lib/commerce/readiness.ts";
import {stripeCreditTopupsLiveEnabled} from "../lib/commerce/credit-wallet.ts";
import {stagingEnabled,stagingAccess} from "../lib/staging.ts";

const production="36adc41d-7e54-4396-ad1a-fd432ba0441d";
const staging="dfaeabed-03df-43ed-aa71-50f343a75041";
const approved=():Record<string,string>=>({
 RAILWAY_ENVIRONMENT_ID:production,
 PRODUCTION_PRIVATE_LIVE_PILOT_ENABLED:"true",
 PRODUCTION_PRIVATE_LIVE_PILOT_APPROVED:"true",
 PRODUCTION_PRIVATE_LIVE_WEBHOOK_VERIFIED:"true",
 PRODUCTION_PRIVATE_LIVE_PRICE_TAX_APPROVED:"true",
 PRODUCTION_PRIVATE_LIVE_PROVIDER_MICRO_USD_CAP:"15000000",
 PRODUCTION_SANDBOX_PILOT_ENABLED:"false",
 STAGING_AUTH_ENABLED:"true",STAGING_PASSWORD:"private-only-synthetic".repeat(3),
 PRODUCTION_PUBLIC_ACCESS_ENABLED:"false",PUBLIC_CUSTOMER_LAUNCH_APPROVED:"false",
 DEMO_MODE:"true",GENERATIONS_ENABLED:"false",ADMIN_DEMO_ENABLED:"false",
 BYTEPLUS_LIVE_TEST_ENABLED:"false",
 STRIPE_LIVE_CHECKOUT_ENABLED:"true",STRIPE_ACCOUNT_LIVE_REVIEW_APPROVED:"true",
 STRIPE_SECRET_KEY:"sk_live_synthetic_only",STRIPE_WEBHOOK_SECRET:"whsec_synthetic_only",
 HOBBY_SUBSCRIPTIONS_ENABLED:"false",
 APP_ORIGIN:"https://www.singmotion.ai",PUBLIC_SITE_ORIGIN:"https://www.singmotion.ai",
 BYTEPLUS_BILLING_AND_TAX_APPROVED:"true",BYTEPLUS_OUTPUT_HOSTS_APPROVED:"true",
 CUSTOMER_CLOUD_E2E_VERIFIED:"true",CUSTOMER_R2_PRODUCTION_RELEASE_APPROVED:"true",
 PRODUCTION_MEDIA_MIGRATION_VERIFIED:"true",
 BACKUP_RESTORE_EXERCISE_VERIFIED:"true",COST_ALERTS_AND_KILL_SWITCH_VERIFIED:"true",
 CUSTOMER_PRODUCTION_PROVIDER_BUDGET_APPROVED:"true",
 CUSTOMER_BYTEPLUS_OWNER_CONFIRMED_PRICING:"true",LEGAL_REVIEW_APPROVED:"true",
 PRODUCTION_CMS_BACKUP_RESTORE_VERIFIED:"true",
 PRODUCTION_CMS_RBAC_AND_PUBLISH_E2E_VERIFIED:"true",
 CUSTOMER_ACCOUNTS_ENABLED:"true",CUSTOMER_GENERATION_ENABLED:"true",
 CUSTOMER_FULFILLMENT_ENABLED:"true",CUSTOMER_DELIVERY_ENABLED:"true",
 CUSTOMER_R2_STORAGE_ENABLED:"true",CUSTOMER_PAID_WORKER_ENABLED:"true",
 CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED:"true",
 CUSTOMER_PAID_WORKER_ACTIVATED_AT:String(Date.now()-30000),
 SUPPORT_CONTACT_VERIFIED:"support@example.test",
 CMS_ENABLED:"true",CMS_DATABASE_URL:"postgresql://test.invalid:5432/only_a_fixture",
 PAYLOAD_SECRET:"synthetic_persistent_cms_signer_for_tests",
});

test("protected Production LIVE is independent of public launch and remains behind Basic Auth",()=>{
 const e=approved();
 assert.deepEqual(assessProtectedProductionLivePilot(e),{ready:true,blockers:[]});
 assert.equal(protectedProductionLivePilotApproved(e),true);
 assert.equal(configuredStripePaymentMode(e),"live");
 assert.equal(productionCustomerReleaseApproved(e),false);
 assert.equal(stagingEnabled(e),true);
 assert.equal(stagingAccess(null,e),401);
 assert.equal(customerAccountSettingsAccessible(e),true);
 assert.equal(customerWorkerEnabled(e),true);
 assert.equal(stripeSessionIdMatchesMode("cs_live_synthetic","live"),true);
 // A route must still have independently verified R2/provider policy and
 // signed delivery; successful mode classification alone cannot take money.
 assert.equal(customerLaunchReadiness(e).readyForPaidOrders,false);
});

test("individual missing approval, secret, budget, authentication or runtime switch blocks LIVE",()=>{
 const e=approved();
 for(const [key,value] of Object.entries(e)){
  if(key==="RAILWAY_ENVIRONMENT_ID" || key==="APP_ORIGIN" ||
     key==="PUBLIC_SITE_ORIGIN" || key==="SUPPORT_CONTACT_VERIFIED" ||
     key==="CMS_DATABASE_URL" || key==="PAYLOAD_SECRET" ||
     key==="STRIPE_SECRET_KEY" || key==="STRIPE_WEBHOOK_SECRET" ||
     key==="STAGING_PASSWORD" || key==="PRODUCTION_PRIVATE_LIVE_PROVIDER_MICRO_USD_CAP" ||
     key==="CUSTOMER_PAID_WORKER_ACTIVATED_AT" || value==="true"){
    const wrong={...e,[key]:"false"};
    assert.equal(protectedProductionLivePilotApproved(wrong),false,key);
    assert.notEqual(configuredStripePaymentMode(wrong),"live",key);
    assert.equal(customerWorkerEnabled(wrong),false,key);
  }
 }
 for(const [key,value] of [
   ["PRODUCTION_PUBLIC_ACCESS_ENABLED","true"],
   ["PUBLIC_CUSTOMER_LAUNCH_APPROVED","true"],
   ["HOBBY_SUBSCRIPTIONS_ENABLED","true"],
   ["PRODUCTION_SANDBOX_PILOT_ENABLED","true"],
   ["GENERATIONS_ENABLED","true"],
   ["DEMO_MODE","false"],
   ["ADMIN_DEMO_ENABLED","true"],
   ["BYTEPLUS_LIVE_TEST_ENABLED","true"],
 ]){
  const wrong={...e,[key]:value};
  assert.equal(protectedProductionLivePilotApproved(wrong),false,key);
  assert.equal(customerWorkerEnabled(wrong),false,key);
 }
 assert.equal(protectedProductionLivePilotApproved({...e,
  CUSTOMER_PAID_WORKER_ACTIVATED_AT:"1"}),false,
  "Never sweep old paid orders as though freshly admitted into pilot");
 assert.equal(protectedProductionLivePilotApproved({...e,
  CUSTOMER_PAID_WORKER_ACTIVATED_AT:String(Date.parse("2026-11-13T14:01:00Z"))}),true,
  "Do not orphan paid customers by expiring the worker after 24 hours");
});

test("Staging can NEVER accept LIVE Stripe mode even with the entire private pilot config",()=>{
 const e={...approved(),RAILWAY_ENVIRONMENT_ID:staging};
 assert.equal(protectedProductionLivePilotApproved(e),false);
 assert.notEqual(configuredStripePaymentMode(e),"live");
 assert.equal(customerWorkerEnabled(e),false);
 assert.equal(stripeCreditTopupsLiveEnabled({...e,
  STRIPE_CREDIT_TOPUPS_LIVE_ENABLED:"true",STRIPE_CREDIT_TAX_REVIEW_APPROVED:"true",
  STRIPE_CREDIT_TAX_CODE:"txcd_12345"}),false);
});
test("existing LIVE reversal verification survives pause without re-enabling new purchases",()=>{
 const paused={...approved(),PRODUCTION_PRIVATE_LIVE_PILOT_ENABLED:"false"};
 assert.equal(configuredStripePaymentMode(paused),null);
 assert.equal(configuredStripeReversalMode(paused),"live");
 assert.equal(protectedProductionLivePilotApproved(paused),false);
 assert.equal(customerWorkerEnabled(paused),false);
});

test("provider cost cap is finite and never creates a video-count limit",()=>{
 const e=approved();
 assert.equal(privateProductionLiveProviderCap(e),15_000_000);
 for(const cap of ["","0","1000","999999","100000001","1000000000000","15.5","NaN"])
  assert.equal(privateProductionLiveProviderCap({...e,PRODUCTION_PRIVATE_LIVE_PROVIDER_MICRO_USD_CAP:cap}),null,cap);
 const policy={dailyCapMicroUsd:50_000_000,lifetimeCapMicroUsd:80_000_000} as Parameters<typeof boundPrivatePilotPolicy>[0];
 const bounded=boundPrivatePilotPolicy(policy,e);
 assert.equal(bounded.dailyCapMicroUsd,15_000_000);
 assert.equal(bounded.lifetimeCapMicroUsd,15_000_000);
 assert.equal(policy.lifetimeCapMicroUsd,80_000_000);
 assert.equal(boundPrivatePilotPolicy(policy,{...e,PRODUCTION_PRIVATE_LIVE_PILOT_ENABLED:"false"}),policy);
});
test("LIVE credit purchases remain separately controlled by VAT review and owner switch",()=>{
 const e=approved();
 assert.equal(stripeCreditTopupsLiveEnabled(e),false);
 const taxReviewed={...e,STRIPE_CREDIT_TOPUPS_LIVE_ENABLED:"true",
  STRIPE_CREDIT_TAX_REVIEW_APPROVED:"true",STRIPE_CREDIT_TAX_CODE:"txcd_12345"};
 assert.equal(stripeCreditTopupsLiveEnabled(taxReviewed),true);
 assert.equal(stripeCreditTopupsLiveEnabled({...taxReviewed,STRIPE_CREDIT_TAX_REVIEW_APPROVED:"false"}),false);
 assert.equal(stripeCreditTopupsLiveEnabled({...taxReviewed,PRODUCTION_PRIVATE_LIVE_PILOT_ENABLED:"false"}),false);
});
test("real customer checkout, refund webhook and R2 have distinct protected-live checks",()=>{
 const read=(name:string)=>readFileSync(new URL("../"+name,import.meta.url),"utf8");
 for(const filename of [
  "app/(site)/api/stripe-checkout/route.ts",
  "app/(site)/api/stripe-webhook/route.ts",
  "app/(site)/api/credit-checkout/route.ts",
  "lib/commerce/customer-byteplus-dispatch.ts",
  "lib/commerce/customer-r2-inputs.ts",
 ]){
  assert.match(read(filename),/protectedProductionLivePilotApproved/,filename);
 }
 assert.match(read("app/(site)/api/stripe-checkout/route.ts"),/owner.kind!=="account"/);
 assert.match(read("lib/staging.ts"),/stagingAccess/);
 assert.match(read("app/(site)/api/stripe-webhook/route.ts"),/verifyStripePaymentEvent/);
 for(const route of [
  "app/(site)/api/customer-auth/route.ts",
  "app/(site)/api/customer-quote/route.ts",
  "app/(site)/api/customer-plan/route.ts",
 ]){
  assert.match(read(route),/protectedProductionLivePilotApproved/,route+
   ": authenticated customer and plan/quote UI must work with Basic Auth still enabled");
 }
});
