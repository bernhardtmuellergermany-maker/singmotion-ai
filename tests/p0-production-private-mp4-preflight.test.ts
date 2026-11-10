import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {productionR2Mp4Preflight} from "../scripts/production-r2-mp4-preflight.ts";
const source=readFileSync(new URL("../scripts/production-r2-mp4-preflight.ts",import.meta.url),"utf8");
const server=readFileSync(new URL("../scripts/serve.mjs",import.meta.url),"utf8");
test("P0 production private MP4 canary never runs on open/live-payment website or missing explicit opt-in",async()=>{
 const safe={
  RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d",
  PRODUCTION_R2_MP4_PREFLIGHT_ENABLED:"true",STAGING_AUTH_ENABLED:"true",
  STAGING_PASSWORD:"X".repeat(32),PRODUCTION_PUBLIC_ACCESS_ENABLED:"false",
  PUBLIC_CUSTOMER_LAUNCH_APPROVED:"false",STRIPE_LIVE_CHECKOUT_ENABLED:"false",
  CUSTOMER_PAID_WORKER_ENABLED:"false",CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED:"false",
 };
 for(const patch of [
  {PRODUCTION_R2_MP4_PREFLIGHT_ENABLED:"false"},
  {STAGING_AUTH_ENABLED:"false"},{STAGING_PASSWORD:"short"},
  {PRODUCTION_PUBLIC_ACCESS_ENABLED:"true"},
  {PUBLIC_CUSTOMER_LAUNCH_APPROVED:"true"},
  {STRIPE_LIVE_CHECKOUT_ENABLED:"true"},
  {CUSTOMER_PAID_WORKER_ENABLED:"true"},
  {CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED:"true"},
  {RAILWAY_ENVIRONMENT_ID:"dfaeabed-03df-43ed-aa71-50f343a75041"},
 ]){
  const status=await productionR2Mp4Preflight({...safe,...patch},()=>{throw Error("Network must not be contacted")});
  assert.equal(status,"skipped");
 }
});
test("P0 private MP4 preflight is isolated, validates full and range bytes, confirms cleanup",()=>{
 assert.match(source,/singmotion-private-preflight\/mp4-v1\/.*randomUUID/);
 assert.match(source,/PutObjectCommand/);
 assert.match(source,/HeadObjectCommand/);
 assert.match(source,/GetObjectCommand/);
 assert.match(source,/DeleteObjectCommand/);
 assert.match(source,/actual\.equals\(expected\)/);
 assert.match(source,/verified&&deleted\?"verified":"blocked"/);
 const spawn=server.indexOf("const worker = spawn(");
 const probe=server.indexOf('console.log("PRODUCTION_R2_MP4_PREFLIGHT started")');
 assert.ok(spawn>0&&probe>spawn,"External MP4 network test must not block production startup");
 assert.doesNotMatch(source,/CUSTOMER_R2_PRODUCTION_RELEASE_APPROVED:"true"/);
});
