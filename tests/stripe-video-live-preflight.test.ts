import {test} from "node:test";
import assert from "node:assert/strict";
import {readOnlyStripeVideoLivePreflight} from "../lib/commerce/stripe-video-live-preflight.ts";

const production="36adc41d-7e54-4396-ad1a-fd432ba0441d";
const staging="dfaeabed-03df-43ed-aa71-50f343a75041";
const canonical="https://www.singmotion.ai";
const rail="https://singmotion-ai-production.up.railway.app";
const env={
 RAILWAY_ENVIRONMENT_ID:production,
 STRIPE_SECRET_KEY:"sk_live_offline_fixture",
 STRIPE_WEBHOOK_SECRET:"whsec_offline_fixture",
 PUBLIC_SITE_ORIGIN:canonical,
 STAGING_AUTH_ENABLED:"true",
 STAGING_PASSWORD:"only-synthetic-private-secret-password-for-test",
 PRODUCTION_PUBLIC_ACCESS_ENABLED:"false",
 PUBLIC_CUSTOMER_LAUNCH_APPROVED:"false",
 HOBBY_SUBSCRIPTIONS_ENABLED:"false",
};
const account={object:"account",charges_enabled:true,details_submitted:true};
const hooks={data:[{livemode:true,status:"enabled",url:rail+"/api/stripe-webhook",
 enabled_events:["checkout.session.completed","checkout.session.async_payment_succeeded",
  "refund.created","refund.updated","charge.dispute.created"]}]};
const settings={status:"active",defaults:{tax_behavior:"exclusive",tax_code:null}};
const registrations={object:"list",has_more:false,data:[]};
const api={
 "https://api.stripe.com/v1/account":account,
 "https://api.stripe.com/v1/webhook_endpoints?limit=100":hooks,
 "https://api.stripe.com/v1/tax/settings":settings,
 "https://api.stripe.com/v1/tax/registrations?limit=100":registrations,
};
function mock(responses:Record<string,unknown>,calls:string[]){
 return async(url:string,options:RequestInit)=>{
  calls.push(url);
  assert.equal(options.method,"GET");
  assert.equal(options.cache,"no-store");
  assert.ok(url.startsWith("https://api.stripe.com/v1/"));
  const value=responses[url];
  return new Response(value===undefined?"not found":JSON.stringify(value),
    {status:value===undefined?404:200});
 };
}
test("read-only one-time video check requires NO Hobby subscription product",async()=>{
 const calls:string[]=[];
 const result=await readOnlyStripeVideoLivePreflight(env,mock(api,calls));
 assert.deepEqual(calls.sort(),Object.keys(api).sort());
 assert.equal(result.stripeVideoConfigurationVerified,true);
 assert.equal(result.taxRegistrationCount,0);
 assert.equal(result.privateProductionPilotApproved,false);
 assert.equal(result.customerFulfillmentReady,false);
 assert.equal(result.paidVideoOrdersEnabled,false);
 assert.ok(result.checks.every(x=>x.ok));
 assert.ok(!JSON.stringify(result).includes(env.STRIPE_SECRET_KEY));
 assert.ok(!JSON.stringify(result).includes(env.STRIPE_WEBHOOK_SECRET));
});
test("live key is NEVER used outside exact private Production",async()=>{
 for(const change of [
  {RAILWAY_ENVIRONMENT_ID:staging},
  {RAILWAY_ENVIRONMENT_ID:"unknown"},
  {STRIPE_SECRET_KEY:"sk_test_wrong"},
  {STRIPE_WEBHOOK_SECRET:""},
  {PUBLIC_SITE_ORIGIN:"https://staging.singmotion.ai"},
  {PUBLIC_SITE_ORIGIN:"https://www.singmotion.ai.evil.test"},
  {PUBLIC_SITE_ORIGIN:"http://www.singmotion.ai"},
  {PUBLIC_SITE_ORIGIN:"https://user@www.singmotion.ai"},
  {PUBLIC_SITE_ORIGIN:"https://www.singmotion.ai/a"},
  {PUBLIC_SITE_ORIGIN:"https://www.singmotion.ai:444"},
  {STAGING_AUTH_ENABLED:"false"},
  {STAGING_PASSWORD:"short"},
  {PRODUCTION_PUBLIC_ACCESS_ENABLED:"true"},
  {PUBLIC_CUSTOMER_LAUNCH_APPROVED:"true"},
 ]){
  let calls=0;
  const result=await readOnlyStripeVideoLivePreflight({...env,...change},
   async()=>{calls++;throw Error("No live call permitted");});
  assert.equal(calls,0,JSON.stringify(change));
  assert.equal(result.paidVideoOrdersEnabled,false);
  assert.equal(result.stripeVideoConfigurationVerified,false);
 }
});
test("live video webhook must be production-only, active, complete and mode-matched",async()=>{
 const valid=hooks.data[0];
 for(const mutation of [
  {livemode:false},
  {status:"disabled"},
  {url:"https://singmotion-ai-staging.up.railway.app/api/stripe-webhook"},
  {url:"https://attacker.example/api/stripe-webhook"},
  {url:"https://www.singmotion.ai.evil.test/api/stripe-webhook"},
  {url:"http://singmotion-ai-production.up.railway.app/api/stripe-webhook"},
  {url:rail+"/api/stripe-webhook?mode=live"},
  {url:rail+"/api/stripe-webhook/"},
  {enabled_events:["checkout.session.completed"]},
 ]){
  const changes={...api,["https://api.stripe.com/v1/webhook_endpoints?limit=100"]:
   {data:[{...valid,...mutation}]}};
  const result=await readOnlyStripeVideoLivePreflight(env,mock(changes,[]));
  assert.equal(result.checks.find(x=>x.name==="video-webhook-endpoint-configured")?.ok,false,
   JSON.stringify(mutation));
  assert.equal(result.stripeVideoConfigurationVerified,false);
 }
});
test("Stripe tax account visibility is necessary but never authorizes payments",async()=>{
 const valid=await readOnlyStripeVideoLivePreflight(env,mock(api,[]));
 assert.equal(valid.stripeVideoConfigurationVerified,true);
 assert.equal(valid.paidVideoOrdersEnabled,false);
 for(const change of [
  {key:"https://api.stripe.com/v1/account",value:{...account,charges_enabled:false}},
  {key:"https://api.stripe.com/v1/tax/settings",value:{status:"inactive"}},
  {key:"https://api.stripe.com/v1/tax/registrations?limit=100",value:{data:[],has_more:true}},
 ]){
  const result=await readOnlyStripeVideoLivePreflight(env,mock({...api,[change.key]:change.value},[]));
  assert.equal(result.stripeVideoConfigurationVerified,false);
  assert.equal(result.paidVideoOrdersEnabled,false);
 }
 const withRegistration=await readOnlyStripeVideoLivePreflight(env,mock({
  ...api,["https://api.stripe.com/v1/tax/registrations?limit=100"]:
   {has_more:false,data:[{country:"DE",status:"active"}]},
 },[]));
 assert.equal(withRegistration.taxRegistrationCount,1);
 assert.equal(withRegistration.paidVideoOrdersEnabled,false);
});
