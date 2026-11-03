import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {privateSourceKey,validCloudRecord,customerR2Enabled} from "../lib/cloud-media.ts";
import {privatePaidVideoKey,validPaidCloudRecord,mirrorPrivatePaidVideo} from "../lib/cloud-paid-video.ts";

const customer="11111111-1111-4111-8111-111111111111";
const order="22222222-2222-4222-8222-222222222222";
const digest=createHash("sha256").update("private material").digest("hex");
test("R2 private input key never embeds customer ID or raw account path",()=>{
 const key=privateSourceKey("customer-"+customer,order,digest);
 assert.match(key,/^customer-sources\/v1\/[a-f0-9]{64}\/[a-f0-9-]{36}\/[a-f0-9]{64}$/);
 assert.ok(!key.includes(customer));
 assert.ok(validCloudRecord("customer-"+customer,order,{key,sha256:digest,bytes:123}));
 assert.equal(validCloudRecord("customer-"+order,order,{key,sha256:digest,bytes:123}),false);
});
test("paid R2 key is immutable, owner-specific and outside source quotas",()=>{
 const key=privatePaidVideoKey(customer,order,digest);
 assert.match(key,/^customer-videos\/v1\/[a-f0-9]{64}\/[a-f0-9-]{36}\/[a-f0-9]{64}\.mp4$/);
 assert.ok(!key.includes(customer));
 assert.equal(validPaidCloudRecord(customer,order,{key,sha256:digest,bytes:100}),true);
 assert.equal(validPaidCloudRecord(order,order,{key,sha256:digest,bytes:100}),false);
 assert.equal(validPaidCloudRecord(customer,order,{key,sha256:digest,bytes:0}),false);
});
test("paid R2 is fail-closed outside protected staging without touching provider",async()=>{
 const beforeFlag=process.env.CUSTOMER_R2_STORAGE_ENABLED, beforeEnv=process.env.RAILWAY_ENVIRONMENT_ID;
 try{
  process.env.CUSTOMER_R2_STORAGE_ENABLED="true";
  process.env.RAILWAY_ENVIRONMENT_ID="36adc41d-7e54-4396-ad1a-fd432ba0441d";
  assert.equal(customerR2Enabled(),false);
  assert.equal(await mirrorPrivatePaidVideo(customer,order,"/should-not-be-opened",128),null);
 }finally{
  if(beforeFlag===undefined)delete process.env.CUSTOMER_R2_STORAGE_ENABLED;else process.env.CUSTOMER_R2_STORAGE_ENABLED=beforeFlag;
  if(beforeEnv===undefined)delete process.env.RAILWAY_ENVIRONMENT_ID;else process.env.RAILWAY_ENVIRONMENT_ID=beforeEnv;
 }
});

test("production R2 release requires independent approval and never inherits staging flag",()=>{
 const old={env:process.env.RAILWAY_ENVIRONMENT_ID,enabled:process.env.CUSTOMER_R2_STORAGE_ENABLED,approved:process.env.CUSTOMER_R2_PRODUCTION_RELEASE_APPROVED};
 try{
  process.env.RAILWAY_ENVIRONMENT_ID="36adc41d-7e54-4396-ad1a-fd432ba0441d";
  process.env.CUSTOMER_R2_STORAGE_ENABLED="true";
  delete process.env.CUSTOMER_R2_PRODUCTION_RELEASE_APPROVED;
  assert.equal(customerR2Enabled(),false);
  process.env.CUSTOMER_R2_PRODUCTION_RELEASE_APPROVED="true";
  assert.equal(customerR2Enabled(),true);
  process.env.RAILWAY_ENVIRONMENT_ID="unknown-environment";
  assert.equal(customerR2Enabled(),false);
 }finally{
  for(const [key,value] of Object.entries({
   RAILWAY_ENVIRONMENT_ID:old.env,
   CUSTOMER_R2_STORAGE_ENABLED:old.enabled,
   CUSTOMER_R2_PRODUCTION_RELEASE_APPROVED:old.approved,
  })){
   if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
 }
});
