import {test} from "node:test";
import assert from "node:assert/strict";
import {productionPrivateCustomerPreviewEnabled,PRODUCTION_RAILWAY_ENVIRONMENT_ID} from "../lib/commerce/customer-live-config.ts";
import {quotePlanSeconds} from "../lib/commerce/plans.ts";
const privateEnv=()=>({
 RAILWAY_ENVIRONMENT_ID:PRODUCTION_RAILWAY_ENVIRONMENT_ID,
 PRODUCTION_PRIVATE_CUSTOMER_PREVIEW_ENABLED:"true",
 STAGING_AUTH_ENABLED:"true",STAGING_PASSWORD:"a".repeat(48),
 PRODUCTION_PUBLIC_ACCESS_ENABLED:"false",
 PUBLIC_CUSTOMER_LAUNCH_APPROVED:"false",
 STRIPE_LIVE_CHECKOUT_ENABLED:"false",
 HOBBY_SUBSCRIPTIONS_ENABLED:"false",
 CUSTOMER_PAID_WORKER_ENABLED:"false",
 CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED:"false",
 DEMO_MODE:"true",GENERATIONS_ENABLED:"false",ADMIN_DEMO_ENABLED:"false"
});
test("private Production customer preview requires Basic Auth and all monetary/provider gates closed",()=>{
 const base=privateEnv();
 assert.equal(productionPrivateCustomerPreviewEnabled(base),true);
 for(const [name,value] of [
  ["RAILWAY_ENVIRONMENT_ID","invalid"],
  ["PRODUCTION_PRIVATE_CUSTOMER_PREVIEW_ENABLED","false"],
  ["STAGING_AUTH_ENABLED","false"],["STAGING_PASSWORD","short"],
  ["PRODUCTION_PUBLIC_ACCESS_ENABLED","true"],
  ["PUBLIC_CUSTOMER_LAUNCH_APPROVED","true"],
  ["STRIPE_LIVE_CHECKOUT_ENABLED","true"],
  ["HOBBY_SUBSCRIPTIONS_ENABLED","true"],
  ["CUSTOMER_PAID_WORKER_ENABLED","true"],
  ["CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED","true"],
  ["DEMO_MODE","false"],["GENERATIONS_ENABLED","true"],
  ["ADMIN_DEMO_ENABLED","true"],
 ] as const){
  assert.equal(productionPrivateCustomerPreviewEnabled({...base,[name]:value}),false,name);
 }
});
test("all preview plans price 5s and 300s without authorizing a payment",()=>{
 assert.deepEqual(quotePlanSeconds("free",0,5),{seconds:5,includedSeconds:0,extraSeconds:5,extraCents:125,currency:"EUR"});
 assert.deepEqual(quotePlanSeconds("free",0,300),{seconds:300,includedSeconds:0,extraSeconds:300,extraCents:7500,currency:"EUR"});
 assert.deepEqual(quotePlanSeconds("hobby",30,300),{seconds:300,includedSeconds:30,extraSeconds:270,extraCents:5400,currency:"EUR"});
 assert.throws(()=>quotePlanSeconds("free",0,300.001),/Invalid video quote/);
 assert.throws(()=>quotePlanSeconds("free",0,4.999),/Invalid video quote/);
});
