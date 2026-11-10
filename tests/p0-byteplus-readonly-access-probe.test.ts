import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {readonlyBytePlusAccessProbe} from "../scripts/byteplus-readonly-access-probe.ts";
import {BytePlusTransportError} from "../lib/live/signed-transport.ts";
import type {Transport} from "../lib/live/byteplus.ts";

const env={
 RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d",
 BYTEPLUS_READONLY_ACCESS_PREFLIGHT_ENABLED:"true",
 STAGING_AUTH_ENABLED:"true",STAGING_PASSWORD:"X".repeat(32),
 PRODUCTION_PUBLIC_ACCESS_ENABLED:"false",
 PUBLIC_CUSTOMER_LAUNCH_APPROVED:"false",
 STRIPE_LIVE_CHECKOUT_ENABLED:"false",
 CUSTOMER_PAID_WORKER_ENABLED:"false",
 CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED:"false",
 BYTEPLUS_ACCESS_KEY_ID:"test_key_id",BYTEPLUS_SECRET_ACCESS_KEY:"test-secret",
};
test("readonly BytePlus probe refuses every unapproved production release condition",async()=>{
 for(const patch of [
  {BYTEPLUS_READONLY_ACCESS_PREFLIGHT_ENABLED:"false"},
  {RAILWAY_ENVIRONMENT_ID:"unknown"},
  {STAGING_AUTH_ENABLED:"false"},{STAGING_PASSWORD:"short"},
  {PRODUCTION_PUBLIC_ACCESS_ENABLED:"true"},
  {PUBLIC_CUSTOMER_LAUNCH_APPROVED:"true"},
  {STRIPE_LIVE_CHECKOUT_ENABLED:"true"},
  {CUSTOMER_PAID_WORKER_ENABLED:"true"},
  {CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED:"true"},
 ]){
  assert.equal(await readonlyBytePlusAccessProbe({...env,...patch},
    async()=>{throw Error("Network call must never occur")}),"skipped");
 }
});
test("readonly BytePlus probe makes only one GetResult call with random noncustomer ID",async()=>{
 let called=0,bodyId="";
 const mock:Transport=async(request)=>{
  called++;
  assert.equal(new URL(request.url).searchParams.get("Action"),"CVSync2AsyncGetResult");
  assert.equal(new URL(request.url).host,"cv.byteplusapi.com");
  const body=JSON.parse(request.body);
  assert.deepEqual(Object.keys(body).sort(),["req_key","task_id"]);
  assert.match(body.task_id,/^singmotion-probe-never-submitted-[a-f0-9-]{36}$/);
  bodyId=body.task_id;
  return {status:500,body:{code:50510,message:"test ID not found"}};
 };
 assert.equal(await readonlyBytePlusAccessProbe(env,mock),"verified_readonly");
 assert.equal(called,1);
 assert.ok(bodyId.length>0);
});
test("readonly BytePlus probe accepts string-coded task not found or signed 10000/not_found",async()=>{
 assert.equal(await readonlyBytePlusAccessProbe(env,async()=>({
  status:500,body:{code:"50510",message:"redacted"},
 })),"verified_readonly");
 assert.equal(await readonlyBytePlusAccessProbe(env,async()=>({
  status:200,body:{code:10000,data:{status:"not_found"}},
 })),"verified_readonly");
 assert.equal(await readonlyBytePlusAccessProbe(env,async()=>({
  status:200,body:{code:50420,message:"Must never log this body"},
 })),"provider_rejected_code_50420");
});
test("readonly probe refuses to equate authentication errors with 300s release",async()=>{
 assert.equal(await readonlyBytePlusAccessProbe(env,async()=>{throw new BytePlusTransportError("authentication",403)}),"authentication_failed");
 assert.equal(await readonlyBytePlusAccessProbe(env,async()=>({status:200,body:{code:10000,data:{status:"in_queue"}}})),"provider_rejected_code_10000");
 assert.equal(await readonlyBytePlusAccessProbe({...env,BYTEPLUS_SECRET_ACCESS_KEY:""}),"blocked");
});
test("startup probe never blocks web/worker and does not expose credentials or provider payloads",()=>{
 const src=readFileSync(new URL("../scripts/byteplus-readonly-access-probe.ts",import.meta.url),"utf8");
 const server=readFileSync(new URL("../scripts/serve.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(src,/CVSync2AsyncSubmitTask|CVCancelTask/);
 assert.match(src,/wireRequest\("CVSync2AsyncGetResult"/);
 assert.match(src,/randomUUID\(\)/);
 const worker=server.indexOf("const worker = spawn(");
 const probe=server.indexOf('console.log("BYTEPLUS_READONLY_ACCESS_PREFLIGHT started")');
 assert.ok(worker>0&&probe>worker);
});
