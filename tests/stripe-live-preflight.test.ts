import {test} from "node:test";
import assert from "node:assert/strict";
import {readOnlyStripeLivePreflight} from "../lib/commerce/stripe-live-preflight.ts";
const env={
 RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d",
 STRIPE_SECRET_KEY:"sk_live_fixture_for_readonly_testing",
 STRIPE_WEBHOOK_SECRET:"whsec_fixture_for_readonly_testing",
 PUBLIC_SITE_ORIGIN:"https://singmotion.example",
};
const account={object:"account",id:"acct_fixture",charges_enabled:true,details_submitted:true};
const endpoint={data:[
 {url:env.PUBLIC_SITE_ORIGIN+"/api/stripe-webhook",
  livemode:true,status:"enabled",enabled_events:["checkout.session.completed",
  "checkout.session.async_payment_succeeded","refund.created","refund.updated",
  "charge.dispute.created"]},
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
const product={id:"prod_Vchw1yEak3Xa6k",object:"product",livemode:true,active:true,
 name:"SingMotion AI Credits",description:"Prepaid Credits for AI video generation",
 tax_code:"txcd_10105003"};
const accountUrl="https://api.stripe.com/v1/account";
const hooksUrl="https://api.stripe.com/v1/webhook_endpoints?limit=100";
const productUrl="https://api.stripe.com/v1/products/prod_Vchw1yEak3Xa6k";
const pricesUrl="https://api.stripe.com/v1/prices?product=prod_Vchw1yEak3Xa6k&active=true&limit=100";
const taxUrl="https://api.stripe.com/v1/tax/settings";
const creditPrice={id:"price_fixture",product:product.id,active:true,livemode:true,
 currency:"eur",unit_amount:500,tax_behavior:"inclusive",recurring:null};
const valid={ [accountUrl]:account,[hooksUrl]:endpoint,[productUrl]:product,
 [pricesUrl]:{data:[creditPrice]},[taxUrl]:{status:"active"} };
test("Stripe read-only live preflight calls only GET and does not approve unavailable paid delivery",async()=>{
 const calls:string[]=[];
 const result=await readOnlyStripeLivePreflight(env,mock(valid,calls));
 assert.deepEqual(calls.sort(),[accountUrl,hooksUrl,productUrl,pricesUrl,taxUrl].sort());
 assert.equal(result.stripeConfigurationVerified,true);
 assert.equal(result.paidOrdersEnabled,false);
 assert.deepEqual(result.checks.filter(c=>!c.ok),[]);
 const output=JSON.stringify(result);
 assert.equal(output.includes(env.STRIPE_SECRET_KEY),false);
 assert.equal(output.includes(env.STRIPE_WEBHOOK_SECRET),false);
 assert.equal(output.includes(product.id),false);
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
test("Stripe preflight rejects public URL spoofing, test keys and missing signature before any fetch",async()=>{
 for(const patch of [
  {PUBLIC_SITE_ORIGIN:"https://singmotion.example.evil.test"},
  {PUBLIC_SITE_ORIGIN:"http://singmotion.example"},
  {PUBLIC_SITE_ORIGIN:"https://user@singmotion.example"},
  {PUBLIC_SITE_ORIGIN:"https://singmotion.example/admin"},
  {STRIPE_SECRET_KEY:"sk_test_fixture"},
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
test("Stripe preflight rejects inactive, test, unclassified Credits or unverified webhook",async()=>{
 const bad=[
  {[productUrl]:{...product,active:false}},
  {[productUrl]:{...product,livemode:false}},
  {[productUrl]:{...product,tax_code:null}},
  {[productUrl]:{...product,tax_code:"txcd_99999999"}},
  {[productUrl]:{...product,name:"SingMotion AI Hobby"}},
  {[productUrl]:{...product,description:"Subscription plan"}},
  {[accountUrl]:{...account,charges_enabled:false}},
  {[hooksUrl]:{data:[{...endpoint.data[0],livemode:false}]}},
  {[hooksUrl]:{data:[{...endpoint.data[0],enabled_events:["checkout.session.completed"]}]}},
  {[hooksUrl]:{data:[{...endpoint.data[0],url:"https://evil.example/api/stripe-webhook"}]}},
 ];
 for(const o of bad){
  const result=await readOnlyStripeLivePreflight(env,mock({...valid,...o},[]));
  assert.equal(result.stripeConfigurationVerified,false);
 }
 const unreachable=await readOnlyStripeLivePreflight(env,async()=>new Response("",{status:503}));
 assert.equal(unreachable.stripeConfigurationVerified,false);
});

test("real Production Railway webhook hostname is accepted only for actual canonical SingMotion origin",async()=>{
 const realSite="https://www.singmotion.ai";
 const railway="https://singmotion-ai-production.up.railway.app";
 const railwayHooks={data:endpoint.data.map(h=>({...h,
  url:railway+new URL(h.url).pathname}))};
 const result=await readOnlyStripeLivePreflight({...env,PUBLIC_SITE_ORIGIN:realSite},
  mock({...valid,[hooksUrl]:railwayHooks},[]));
 assert.equal(result.stripeConfigurationVerified,true);
 assert.equal(result.paidOrdersEnabled,false);
 const unrelated=await readOnlyStripeLivePreflight({...env,PUBLIC_SITE_ORIGIN:"https://unrelated.example"},
  mock({...valid,[hooksUrl]:railwayHooks},[]));
 assert.equal(unrelated.stripeConfigurationVerified,false);
 assert.equal(unrelated.checks.find(x=>x.name==="verified-live-checkout-webhook")?.ok,false);
});

test("retired Hobby product and webhook are not required for live Credits preflight",async()=>{
 const calls:string[]=[];
 const result=await readOnlyStripeLivePreflight(env,mock(valid,calls));
 assert.equal(result.stripeConfigurationVerified,true);
 assert.equal(calls.some(url=>url.includes("hobby")||url.includes("/prices/")),false);
 assert.equal(result.checks.some(x=>x.name.includes("hobby")),false);
 const unavailable=await readOnlyStripeLivePreflight({...env,STRIPE_SECRET_KEY:"missing"},async()=>{throw Error("No network expected")});
 assert.equal(unavailable.checks.some(x=>x.name.includes("hobby")),false);
});

test("live credits preflight requires an active, tax-inclusive one-time EUR price and active tax settings",async()=>{
 const invalid=[
  {[pricesUrl]:{data:[]}},
  {[pricesUrl]:{data:[{...creditPrice,active:false}]}},
  {[pricesUrl]:{data:[{...creditPrice,livemode:false}]}},
  {[pricesUrl]:{data:[{...creditPrice,currency:"usd"}]}},
  {[pricesUrl]:{data:[{...creditPrice,tax_behavior:"unspecified"}]}},
  {[pricesUrl]:{data:[{...creditPrice,recurring:{interval:"month"}}]}},
  {[pricesUrl]:{data:[{...creditPrice,product:"prod_other"}]}},
  {[pricesUrl]:{data:[{...creditPrice,unit_amount:0}]}},
  {[taxUrl]:{status:"pending"}},
 ];
 for(const patch of invalid){
  const result=await readOnlyStripeLivePreflight(env,mock({...valid,...patch},[]));
  assert.equal(result.stripeConfigurationVerified,false);
  assert.equal(result.paidOrdersEnabled,false);
 }
 const validResult=await readOnlyStripeLivePreflight(env,mock(valid,[]));
 assert.equal(validResult.checks.find(x=>x.name==="active-inclusive-eur-credit-price")?.ok,true);
 assert.equal(validResult.checks.find(x=>x.name==="stripe-tax-settings-active")?.ok,true);
});
