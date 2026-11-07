import {test} from "node:test";
import assert from "node:assert/strict";
import {HeadBucketCommand} from "@aws-sdk/client-s3";
import {productionR2ReadOnlyPreflight} from "../scripts/production-r2-readonly-preflight.ts";

const env={
 RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d",
 PRODUCTION_R2_READONLY_PREFLIGHT_ENABLED:"true",
 STRIPE_LIVE_CHECKOUT_ENABLED:"false",
 PUBLIC_CUSTOMER_LAUNCH_APPROVED:"false",
 CUSTOMER_PAID_WORKER_ENABLED:"false",
 CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED:"false",
 R2_ACCOUNT_ID:"0".repeat(32),
 R2_BUCKET:"singmotion-ai-private",
 R2_ACCESS_KEY_ID:"test-access",
 R2_SECRET_ACCESS_KEY:"test-secret",
};
test("production R2 HEAD-only bucket check is read-only",async()=>{
 let count=0;
 const status=await productionR2ReadOnlyPreflight(env,async command=>{
   count++;
   assert.ok(command instanceof HeadBucketCommand);
   assert.equal(command.input.Bucket,"singmotion-ai-private");
   return {};
 });
 assert.equal(status,"verified");
 assert.equal(count,1);
});
test("disabled or non-production R2 preflight never connects",async()=>{
 for(const patch of [
  {RAILWAY_ENVIRONMENT_ID:"dfaeabed-03df-43ed-aa71-50f343a75041"},
  {PRODUCTION_R2_READONLY_PREFLIGHT_ENABLED:"false"},
  {STRIPE_LIVE_CHECKOUT_ENABLED:"true"},
  {PUBLIC_CUSTOMER_LAUNCH_APPROVED:"true"},
  {CUSTOMER_PAID_WORKER_ENABLED:"true"},
  {CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED:"true"},
 ]){
  const result=await productionR2ReadOnlyPreflight({...env,...patch},async()=>{throw Error("Unexpected");});
  assert.equal(result,"skipped");
 }
});
test("invalid settings and remote failures return only blocked status",async()=>{
 assert.equal(await productionR2ReadOnlyPreflight({...env,R2_ACCOUNT_ID:"invalid"},async()=>{throw Error("Unexpected");}),"blocked");
 assert.equal(await productionR2ReadOnlyPreflight(env,async()=>{throw Error("Bad credentials");}),"blocked");
});
