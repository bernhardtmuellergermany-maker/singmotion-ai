import {test} from "node:test";
import assert from "node:assert/strict";
import {readOnlyStripeLivePreflight} from "../lib/commerce/stripe-live-preflight.ts";
const env={
 RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d",
 STRIPE_SECRET_KEY:"sk_live_fixture_for_readonly_testing",
 STRIPE_WEBHOOK_SECRET:"whsec_fixture_for_readonly_testing",
 STRIPE_HOBBY_PRICE_ID:"price_live_testfixture",
 STRIPE_HOBBY_WEBHOOK_SECRET:"whsec_hobby_testfixture",
 PUBLIC_SITE_ORIGIN:"https://singmotion.example",
};
const account={object:"account",id:"acct_fixture",charges_enabled:true,details_submitted:true};
const price={id:env.STRIPE_HOBBY_PRICE_ID,livemode:true,active:true,
 currency:"eur",unit_amount:499,tax_behavior:"inclusive",recurring:{
  interval:"month",interval_count:1,usage_type:"licensed"}};
const endpoint={data:[
 {url:env.PUBLIC_SITE_ORIGIN+"/api/stripe-webhook",
  livemode:true,status:"enabled",enabled_events:["checkout.session.completed",
  "checkout.session.async_payment_succeeded","refund.created","refund.updated",
  "charge.dispute.created"]},
 {url:env.PUBLIC_SITE_ORIGIN+"/api/hobby-webhook",
  livemode:true,status:"enabled",enabled_events:["customer.subscription.created",
  "customer.subscription.updated","customer.subscription.deleted",
  "invoice.paid","invoice.payment_failed"]},
]};
function mock(objects:Record<string,unknown>,calls:string[]){
 return async(input:string,init:RequestInit)=>{
  calls.push(input);
  assert.equal(init.method,"GET");
  assert.equal(init.cache,"no-store");
  assert.equal(input.startsWith("https://api.stripe.com/v1/"),true);
  const body=objects[input];
  return new Response(body===undefined?"not found":JSON.stringify(body),
   {status:body===undefined?404:200});
 };
}
const accountUrl="https://api.stripe.com/v1/account";
const priceUrl="https://api.stripe.com/v1/prices/price_live_testfixture";
const hooksUrl="https://api.stripe.com/v1/webhook_endpoints?limit=100";
const valid={ [accountUrl]:account,[priceUrl]:price,[hooksUrl]:endpoint };
test("Stripe read-only live preflight calls only GET and does not approve unavailable paid delivery",async()=>{
 const calls:string[]=[];
 const result=await readOnlyStripeLivePreflight(env,mock(valid,calls));
 assert.deepEqual(calls.sort(),[accountUrl,priceUrl,hooksUrl].sort());
 assert.equal(result.stripeConfigurationVerified,true);
 assert.equal(result.paidOrdersEnabled,false);
 assert.deepEqual(result.checks.filter(c=>!c.ok),[]);
 const output=JSON.stringify(result);
 assert.equal(output.includes(env.STRIPE_SECRET_KEY),false);
 assert.equal(output.includes(env.STRIPE_WEBHOOK_SECRET),false);
 assert.equal(output.includes(env.STRIPE_HOBBY_PRICE_ID),false);
});
test("Stripe preflight refuses live network outside production even with live credentials",async()=>{
 let called=0;
 const result=await readOnlyStripeLivePreflight({
  ...env,RAILWAY_ENVIRONMENT_ID:"dfaeabed-03df-43ed-aa71-50f343a75041"
 },async()=>{called++;throw Error("Never call");});
 assert.equal(called,0);
 assert.equal(result.stripeConfigurationVerified,false);
 assert.equal(result.paidOrdersEnabled,false);
});
test("Stripe preflight rejects public URL spoofing, test keys and missing price before any fetch",async()=>{
 for(const patch of [
  {PUBLIC_SITE_ORIGIN:"https://singmotion.example.evil.test"},
  {PUBLIC_SITE_ORIGIN:"http://singmotion.example"},
  {PUBLIC_SITE_ORIGIN:"https://user@singmotion.example"},
  {PUBLIC_SITE_ORIGIN:"https://singmotion.example/admin"},
  {STRIPE_SECRET_KEY:"sk_test_fixture"},
  {STRIPE_HOBBY_PRICE_ID:"price_live/../../evil"},
  {STRIPE_HOBBY_WEBHOOK_SECRET:"invalid"},
  {STRIPE_WEBHOOK_SECRET:"missing"},
 ]) {
  let calls=0;
  const e={...env,...patch};
  const result=await readOnlyStripeLivePreflight(e,async()=>{calls++;throw Error("Unexpected");});
  if(patch.PUBLIC_SITE_ORIGIN==="https://singmotion.example.evil.test"){
   assert.equal(result.stripeConfigurationVerified,false);
   assert.equal(result.paidOrdersEnabled,false);
  }else{
   assert.equal(calls,0);
   assert.equal(result.stripeConfigurationVerified,false);
  }
 }
});
test("Stripe preflight rejects inactive wrong-amount wrong-mode or unverified webhook",async()=>{
 const bad=[
  {[priceUrl]:{...price,unit_amount:599}},
  {[priceUrl]:{...price,livemode:false}},
  {[priceUrl]:{...price,tax_behavior:"exclusive"}},
  {[accountUrl]:{...account,charges_enabled:false}},
  {[hooksUrl]:{data:[{...endpoint.data[0],livemode:false},endpoint.data[1]]}},
  {[hooksUrl]:{data:[{...endpoint.data[0],enabled_events:["checkout.session.completed"]},endpoint.data[1]]}},
  {[hooksUrl]:{data:[{...endpoint.data[0],url:"https://evil.example/api/stripe-webhook"},endpoint.data[1]]}},
  {[hooksUrl]:{data:[endpoint.data[0],{...endpoint.data[1],livemode:false}]}},
  {[hooksUrl]:{data:[endpoint.data[0],{...endpoint.data[1],enabled_events:["invoice.paid"]}]}},
 ];
 for(const o of bad){
  const result=await readOnlyStripeLivePreflight(env,mock({...valid,...o},[]));
  assert.equal(result.stripeConfigurationVerified,false);
  assert.equal(result.paidOrdersEnabled,false);
 }
 const unreachable=await readOnlyStripeLivePreflight(env,async()=>new Response("",{status:503}));
 assert.equal(unreachable.stripeConfigurationVerified,false);
});
