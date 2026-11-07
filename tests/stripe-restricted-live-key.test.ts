import {test} from "node:test";
import assert from "node:assert/strict";
import {configuredStripePaymentMode,stripeKeyMatchesMode} from "../lib/commerce/stripe-payment-mode.ts";
import {readOnlyStripeLivePreflight} from "../lib/commerce/stripe-live-preflight.ts";

const live={
 RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d",
 STRIPE_SECRET_KEY:"rk_live_offline_restricted_example",
 STRIPE_WEBHOOK_SECRET:"whsec_offline_example",
 STRIPE_LIVE_CHECKOUT_ENABLED:"true",
 PUBLIC_CUSTOMER_LAUNCH_APPROVED:"true",
 STRIPE_ACCOUNT_LIVE_REVIEW_APPROVED:"true",
 STRIPE_HOBBY_PRICE_ID:"price_offline_live_1",
 STRIPE_HOBBY_WEBHOOK_SECRET:"whsec_offline_hobby_example",
 PUBLIC_SITE_ORIGIN:"https://singmotion.example",
};
test("restricted Live key is classified only with actual production and required live release flags",()=>{
 assert.equal(stripeKeyMatchesMode(live.STRIPE_SECRET_KEY,"live"),true);
 assert.equal(configuredStripePaymentMode(live),"live");
 for(const patch of [
  {RAILWAY_ENVIRONMENT_ID:"dfaeabed-03df-43ed-aa71-50f343a75041"},
  {STRIPE_LIVE_CHECKOUT_ENABLED:"false"},
  {PUBLIC_CUSTOMER_LAUNCH_APPROVED:"false"},
  {STRIPE_ACCOUNT_LIVE_REVIEW_APPROVED:"false"},
  {STRIPE_WEBHOOK_SECRET:"missing"},
  {STRIPE_SECRET_KEY:"rk_test_wrong_environment"},
 ])assert.equal(configuredStripePaymentMode({...live,...patch}),null);
 assert.equal(stripeKeyMatchesMode("rk_test_fake","live"),false);
 assert.equal(stripeKeyMatchesMode("rk_live_fake","test"),false);
});
test("restricted Live key does not bypass private webhook or vendor preflight",async()=>{
 const calls:string[]=[];
 const result=await readOnlyStripeLivePreflight(live,async(input,init)=>{
  calls.push(String(input));
  assert.equal(init.method,"GET");
  return new Response(JSON.stringify({error:{message:"Restricted key lacks read access"}}),{status:403});
 });
 assert.equal(calls.length,3);
 assert.equal(result.stripeConfigurationVerified,false);
 assert.equal(result.paidOrdersEnabled,false);
 assert.equal(JSON.stringify(result).includes(live.STRIPE_SECRET_KEY),false);
});
