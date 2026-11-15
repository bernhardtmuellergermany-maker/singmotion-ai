import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
 assessPrivateProductionCreditVideo,PRODUCTION_CREDIT_VIDEO_ACCEPTANCE
} from "../lib/commerce/private-production-credit-readiness.ts";

const makeEnv=():Record<string,string>=>({
 RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d",
 PRODUCTION_PRIVATE_CREDIT_TEST_ENABLED:"true",
 CUSTOMER_PRIVATE_LIVE_CREDIT_VIDEO_ENABLED:"true",
 STAGING_AUTH_ENABLED:"true",STAGING_PASSWORD:"test-password-".repeat(4),
 PRODUCTION_PUBLIC_ACCESS_ENABLED:"false",PUBLIC_CUSTOMER_LAUNCH_APPROVED:"false",
 PRODUCTION_SANDBOX_PILOT_ENABLED:"false",HOBBY_SUBSCRIPTIONS_ENABLED:"false",
 APP_ORIGIN:"https://www.singmotion.ai",PUBLIC_SITE_ORIGIN:"https://www.singmotion.ai",
 DEMO_MODE:"true",GENERATIONS_ENABLED:"false",ADMIN_DEMO_ENABLED:"false",
 CMS_ENABLED:"true",CUSTOMER_ACCOUNTS_ENABLED:"true",PAYLOAD_SECRET:"x".repeat(40),
 STRIPE_SECRET_KEY:"sk_live_synthetic",STRIPE_WEBHOOK_SECRET:"whsec_synthetic",
 CUSTOMER_BYTEPLUS_OWNER_CONFIRMED_PRICING:"true",
 BYTEPLUS_STUDIO_RECOVERY_ENABLED:"true",BYTEPLUS_STUDIO_OPERATOR_SECRET:"s".repeat(40),
 CUSTOMER_R2_STORAGE_ENABLED:"true",BYTEPLUS_ACCESS_KEY_ID:"synthetic-id",
 BYTEPLUS_SECRET_ACCESS_KEY:"synthetic-secret",
 R2_ACCOUNT_ID:"synthetic",R2_BUCKET:"synthetic",
 R2_ACCESS_KEY_ID:"synthetic",R2_SECRET_ACCESS_KEY:"synthetic"
});

test("private production Credit video configuration is checked without imposing a video-count quota",()=>{
 const result=assessPrivateProductionCreditVideo(makeEnv());
 assert.equal(result.configurationReady,true);
 assert.ok(result.checks.every(c=>c.ready));
 assert.ok(PRODUCTION_CREDIT_VIDEO_ACCEPTANCE.length>=6);
});
test("every critical dependency fails closed, including public access and staging keys",()=>{
 const env=makeEnv();
 for(const [key,value] of [
  ["RAILWAY_ENVIRONMENT_ID","dfaeabed-03df-43ed-aa71-50f343a75041"],
  ["PRODUCTION_PRIVATE_CREDIT_TEST_ENABLED","false"],
  ["CUSTOMER_PRIVATE_LIVE_CREDIT_VIDEO_ENABLED","false"],
  ["STRIPE_SECRET_KEY","sk_test_synthetic"],
  ["STRIPE_WEBHOOK_SECRET",""],
  ["CUSTOMER_R2_STORAGE_ENABLED","false"],
  ["BYTEPLUS_ACCESS_KEY_ID",""],
  ["BYTEPLUS_SECRET_ACCESS_KEY",""],
  ["R2_SECRET_ACCESS_KEY",""],
  ["PRODUCTION_PUBLIC_ACCESS_ENABLED","true"],
  ["PUBLIC_CUSTOMER_LAUNCH_APPROVED","true"],
  ["CUSTOMER_ACCOUNTS_ENABLED","false"],
 ]){
  assert.equal(assessPrivateProductionCreditVideo({...env,[key]:value}).configurationReady,false,key);
 }
});
test("preflight does not infer real production billing or operational approvals",()=>{
 const output=assessPrivateProductionCreditVideo(makeEnv());
 assert.equal("publicReleaseApproved" in output,false);
 assert.equal("acceptanceVerified" in output,false);
});

test("private Production gate diagnostics reveal which switches differ, never their secret values",()=>{
 const e=makeEnv();
 const good=assessPrivateProductionCreditVideo(e);
 assert.equal(good.configurationReady,true);
 for(const [key,id] of [
  ["PRODUCTION_PRIVATE_CREDIT_TEST_ENABLED","PRIVATE_LIVE_CREDIT_TEST_SWITCH"],
  ["CUSTOMER_PRIVATE_LIVE_CREDIT_VIDEO_ENABLED","CUSTOMER_PRIVATE_LIVE_CREDIT_VIDEO_SWITCH"],
  ["STAGING_PASSWORD","PRIVATE_BASIC_AUTH_CONFIGURED"],
  ["APP_ORIGIN","CANONICAL_LIVE_ORIGINS"],
  ["STRIPE_SECRET_KEY","LIVE_STRIPE_CREDENTIAL_FORMAT"],
 ] as const){
  const report=assessPrivateProductionCreditVideo({...e,[key]:"false"});
  assert.ok(report.checks.some(check=>check.id===id&&!check.ready),key);
 }
 assert.ok(good.checks.every(c=>!JSON.stringify(c).includes(e.STAGING_PASSWORD)));
 assert.ok(good.checks.every(c=>!JSON.stringify(c).includes(e.STRIPE_SECRET_KEY)));
});
test("Production worker reports independent credit Studio configuration without activating payment or dispatch",()=>{
 const worker=readFileSync(new URL("../scripts/worker.ts",import.meta.url),"utf8");
 assert.match(worker,/PRIVATE_CREDIT_VIDEO_CONFIGURATION/);
 assert.match(worker,/assessPrivateProductionCreditVideo\(process\.env\)/);
 assert.match(worker,/independentlyAccepted:false/);
 assert.match(worker,/publicReleaseApproved:false/);
 assert.match(worker,/\.filter\(check=>!check\.ready\)\.map\(check=>check\.id\)/);
});
