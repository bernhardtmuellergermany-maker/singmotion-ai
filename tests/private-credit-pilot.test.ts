import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {assessPrivateCreditPilot,privateCreditPilotApproved} from "../lib/commerce/private-credit-pilot.ts";
import {stripeCreditTopupsLiveEnabled} from "../lib/commerce/credit-wallet.ts";
import {configuredStripePaymentMode,configuredStripeReversalMode} from "../lib/commerce/stripe-payment-mode.ts";
import {protectedProductionLivePilotApproved} from "../lib/commerce/protected-production-live-pilot.ts";

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
 assert.match(webhook,/settlementEnabled\|\|privateCreditPilotApproved/);
 assert.match(webhook,/verifyStripePaymentEvent/);
});
