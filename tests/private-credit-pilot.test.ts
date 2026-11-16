import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {assessPrivateCreditPilot,privateCreditPilotApproved} from "../lib/commerce/private-credit-pilot.ts";
import {stripeCreditTopupsLiveEnabled} from "../lib/commerce/credit-wallet.ts";
import {configuredStripePaymentMode,configuredStripeReversalMode} from "../lib/commerce/stripe-payment-mode.ts";
import {protectedProductionLivePilotApproved} from "../lib/commerce/protected-production-live-pilot.ts";
import {privateLiveCreditTestEnabled,privateLiveCreditTestTaxDecision} from "../lib/commerce/private-live-credit-test.ts";
import {customerCreditStudioBetaEnabled} from "../lib/commerce/customer-credit-studio-beta.ts";

const approved=():Record<string,string>=>({
 RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d",
 PRODUCTION_PRIVATE_CREDIT_PILOT_APPROVED:"true",
 PRODUCTION_PRIVATE_CREDIT_WEBHOOK_VERIFIED:"true",
 PRODUCTION_PRIVATE_CREDIT_REFUND_VERIFIED:"true",
 PRODUCTION_PRIVATE_CREDIT_BACKUP_RESTORE_VERIFIED:"true",
 STAGING_AUTH_ENABLED:"true",STAGING_PASSWORD:"synthetic-password-long-enough-for-gate",
 PRODUCTION_PUBLIC_ACCESS_ENABLED:"false",PUBLIC_CUSTOMER_LAUNCH_APPROVED:"false",
 PRODUCTION_SANDBOX_PILOT_ENABLED:"false",
 APP_ORIGIN:"https://www.singmotion.ai",PUBLIC_SITE_ORIGIN:"https://www.singmotion.ai",
 CUSTOMER_ACCOUNTS_ENABLED:"true",CMS_ENABLED:"true",
 PAYLOAD_SECRET:"test-only-signing-secret-longer-than-32",
 STRIPE_CREDIT_TOPUPS_LIVE_ENABLED:"true",STRIPE_LIVE_CHECKOUT_ENABLED:"true",
 STRIPE_ACCOUNT_LIVE_REVIEW_APPROVED:"true",
 CREDIT_TAX_WORLDWIDE_REVIEW_APPROVED:"true",
 CREDIT_TAX_COUNTRY_POLICY_JSON:JSON.stringify({revision:"fixture-2026",reviewedAt:new Date().toISOString().slice(0,10),entries:[
  {country:"DE",buyerType:"consumer",voucherKind:"single-purpose",mode:"de-small-business",evidence:"Synthetic DE small business tax voucher issuance review for tests only"}
 ]}),
 STRIPE_SECRET_KEY:"sk_live_synthetic",STRIPE_WEBHOOK_SECRET:"whsec_synthetic"
});
test("private credit gate is independent of public video or provider dispatch approval",()=>{
 const env=approved();
 assert.deepEqual(assessPrivateCreditPilot(env),{ready:true,blockers:[]});
 assert.equal(stripeCreditTopupsLiveEnabled(env),true);
 assert.equal(protectedProductionLivePilotApproved(env),false);
 assert.equal(configuredStripePaymentMode(env),null,"Legacy per-video checkout must remain disabled");
 assert.equal(configuredStripeReversalMode(env),"live","Verified live credit webhook can still settle and reverse");
});
test("every independently required proof must fail closed",()=>{
 const env=approved();
 for(const name of Object.keys(env)){
  const v=env[name];
  if(v==="true"||name==="RAILWAY_ENVIRONMENT_ID"||name==="STAGING_PASSWORD"||
     name==="PAYLOAD_SECRET"||name==="CREDIT_TAX_COUNTRY_POLICY_JSON"||name==="APP_ORIGIN"||
     name==="PUBLIC_SITE_ORIGIN"||name==="STRIPE_SECRET_KEY"||name==="STRIPE_WEBHOOK_SECRET"){
   const changed={...env,[name]:"false"};
   assert.equal(privateCreditPilotApproved(changed),false,name);
   assert.equal(stripeCreditTopupsLiveEnabled(changed),false,name);
  }
 }
 for(const name of ["PRODUCTION_PUBLIC_ACCESS_ENABLED","PUBLIC_CUSTOMER_LAUNCH_APPROVED","PRODUCTION_SANDBOX_PILOT_ENABLED"]){
  assert.equal(privateCreditPilotApproved({...env,[name]:"true"}),false,name);
 }
});
test("existing video worker and public launch never inherit credit-only approval",()=>{
 const env=approved();
 assert.equal(protectedProductionLivePilotApproved(env),false);
 const root=new URL("../",import.meta.url);
 const checkout=readFileSync(new URL("app/(site)/api/credit-checkout/route.ts",root),"utf8");
 const balance=readFileSync(new URL("app/(site)/api/credit-balance/route.ts",root),"utf8");
 const webhook=readFileSync(new URL("app/(site)/api/stripe-webhook/route.ts",root),"utf8");
 assert.match(checkout,/privateCreditPilotApproved/);
 assert.match(balance,/privateCreditPilotApproved/);
 assert.match(webhook,/settlementEnabled\|\|publicCreditReleaseApproved\(process\.env\)\|\|privateCreditPilotApproved/);
 assert.match(webhook,/verifyStripePaymentEvent/);
});

// Private owner-operated real-money acceptance is not a public release,
// legacy video checkout, or a claim of general jurisdiction tax approval.
test("password-protected Production can accept live owner Credit testing without public approval",()=>{
 const e:Record<string,string>={
  RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d",
  PRODUCTION_PRIVATE_CREDIT_TEST_ENABLED:"true",
  STAGING_AUTH_ENABLED:"true",STAGING_PASSWORD:"z".repeat(48),
  PRODUCTION_PUBLIC_ACCESS_ENABLED:"false",PUBLIC_CUSTOMER_LAUNCH_APPROVED:"false",
  PRODUCTION_SANDBOX_PILOT_ENABLED:"false",HOBBY_SUBSCRIPTIONS_ENABLED:"false",
  APP_ORIGIN:"https://www.singmotion.ai",PUBLIC_SITE_ORIGIN:"https://www.singmotion.ai",
  DEMO_MODE:"true",GENERATIONS_ENABLED:"false",ADMIN_DEMO_ENABLED:"false",
  CMS_ENABLED:"true",CUSTOMER_ACCOUNTS_ENABLED:"true",PAYLOAD_SECRET:"p".repeat(40),
  STRIPE_SECRET_KEY:"sk_live_synthetic",STRIPE_WEBHOOK_SECRET:"whsec_synthetic",
  CUSTOMER_PRIVATE_LIVE_CREDIT_VIDEO_ENABLED:"true",
  CUSTOMER_BYTEPLUS_OWNER_CONFIRMED_PRICING:"true",
  BYTEPLUS_STUDIO_RECOVERY_ENABLED:"true",
  BYTEPLUS_STUDIO_OPERATOR_SECRET:"s".repeat(40),
  CUSTOMER_R2_STORAGE_ENABLED:"true",
 };
 assert.equal(privateLiveCreditTestEnabled(e),true);
 assert.equal(stripeCreditTopupsLiveEnabled(e),true);
 assert.equal(configuredStripePaymentMode(e),"live");
 assert.equal(protectedProductionLivePilotApproved(e),false);
 assert.equal(customerCreditStudioBetaEnabled(e),true);
 const omitted=privateLiveCreditTestTaxDecision(undefined,undefined);
 assert.equal(omitted.ready,true,"Private owner LIVE checkout works with Stripe-collected billing details");
 assert.equal(omitted.decision?.country,"DE");
 assert.equal(omitted.decision?.buyerType,"consumer");
 const d=privateLiveCreditTestTaxDecision("DE","consumer");
 assert.equal(d.ready,true);
 assert.equal(d.decision?.mode,"private-live-verification");
 for(const [key,value] of [
  ["RAILWAY_ENVIRONMENT_ID","dfaeabed-03df-43ed-aa71-50f343a75041"],
  ["PRODUCTION_PRIVATE_CREDIT_TEST_ENABLED","false"],
  ["STAGING_AUTH_ENABLED","false"],["STAGING_PASSWORD","short"],
  ["PRODUCTION_PUBLIC_ACCESS_ENABLED","true"],["PUBLIC_CUSTOMER_LAUNCH_APPROVED","true"],
  ["PRODUCTION_SANDBOX_PILOT_ENABLED","true"],["HOBBY_SUBSCRIPTIONS_ENABLED","true"],
  ["APP_ORIGIN","https://staging.example"],["PUBLIC_SITE_ORIGIN","https://evil.example"],
  ["STRIPE_SECRET_KEY","sk_test_synthetic"],["STRIPE_WEBHOOK_SECRET","missing"],
  ["CMS_ENABLED","false"],["CUSTOMER_ACCOUNTS_ENABLED","false"],
 ]){
  assert.equal(privateLiveCreditTestEnabled({...e,[key]:value}),false,key);
 }
 for(const [country,buyer] of [["US","consumer"],["DE","business"],["","consumer"],[null,"consumer"],["DE",null],["DE","unknown"]]){
  assert.equal(privateLiveCreditTestTaxDecision(country,buyer).ready,false);
 }
 assert.equal(customerCreditStudioBetaEnabled({...e,CUSTOMER_PRIVATE_LIVE_CREDIT_VIDEO_ENABLED:"false"}),false);
});
