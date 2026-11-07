import {test} from "node:test";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {ownerConfirmedBytePlusPolicy} from "../lib/commerce/owner-confirmed-provider-policy.ts";
import {planUpperBoundMicroUsd} from "../lib/live/contract.ts";
import assert from "node:assert/strict";
import {customerWorkerEnabled,runCustomerPaidWorkerBatch,validateCustomerWorkerPolicy,loadCustomerWorkerPolicy}
 from "../lib/commerce/customer-paid-worker.ts";

const staging="dfaeabed-03df-43ed-aa71-50f343a75041";
const fullEnv={
 RAILWAY_ENVIRONMENT_ID:staging,
 CUSTOMER_PAID_WORKER_ENABLED:"true",
 CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED:"true",
 CUSTOMER_BYTEPLUS_OWNER_CONFIRMED_PRICING:"true",
 CUSTOMER_PAID_WORKER_ACTIVATED_AT:"1",
 CUSTOMER_ACCOUNTS_ENABLED:"true",
 CUSTOMER_R2_STORAGE_ENABLED:"true",
 STRIPE_CHECKOUT_ENABLED:"true",
 STRIPE_SECRET_KEY:"sk_test_synthetic",
 STRIPE_WEBHOOK_SECRET:"whsec_synthetic",
};
const syntheticPolicy=()=>({
 reviewedBy:"offline-authorized-reviewer",
 reviewedAt:new Date(Date.now()-3600000).toISOString(),
 expiresAt:new Date(Date.now()+7*86400000).toISOString(),
 billingEvidence:"offline only fictional inclusive tax and fee review",
 outputEvidence:"offline only synthetic output media and host assessment",
 dailyCapMicroUsd:1_000_000,
 lifetimeCapMicroUsd:5_000_000,
 contract:{
  revision:"offline-only-reviewed-policy",model:"OmniHuman 2.0" as const,
  documentationUrl:"https://example.test/offline",
  maxDurationSeconds:5,promptSupported:true,inputFetchWindowSeconds:44100,
  generatedDurationBound:{minInputSeconds:4,maxInputSeconds:5,maxAdditionalSeconds:1,
   evidence:"synthetic generated output bound"},
  billing:{microUsdPerSecond:70000,minimumBillableMs:0,billingQuantumMs:1000,
   minimumChargeMicroUsd:0,fixedFeeMicroUsd:0,taxBasisPointsUpperBound:1900},
  output:{width:1280,height:720,fps:25,
   videoCodec:"h264" as const,audioCodec:"aac" as const,
   maxDurationSeconds:6,durationToleranceSeconds:1,
   transfer:{maxBytes:20000000,timeoutMs:120000,
    evidence:"offline synthetic private MP4 transfer budget"}},
  outputHosts:["example.test"],
 }
});

test("customer paid worker remains inert in Production, without secrets or any policy file",async()=>{
 assert.equal(customerWorkerEnabled({}),false);
 for(const [key,value] of Object.entries(fullEnv)){
  assert.equal(customerWorkerEnabled({...fullEnv,[key]:key==="RAILWAY_ENVIRONMENT_ID"?"production":"false"}),
   false,"must not allow missing "+key);
  assert.ok(value);
 }
 assert.equal(customerWorkerEnabled(fullEnv),true);
 assert.deepEqual(await runCustomerPaidWorkerBatch("/does/not/exist",
  {...fullEnv,RAILWAY_ENVIRONMENT_ID:"production"}),{
   status:"disabled",submitted:0,alreadyClaimed:0,uncertain:0,
   requiresReview:0,recovered:0,
 });
 assert.deepEqual(await runCustomerPaidWorkerBatch("/does/not/exist",
  {...fullEnv,CUSTOMER_PAID_WORKER_ENABLED:"false"}),{
   status:"disabled",submitted:0,alreadyClaimed:0,uncertain:0,
   requiresReview:0,recovered:0,
 });
});

test("owner-confirmed policy is usable without a duplicate vendor contract or fabricated surcharges",()=>{
 const policy=ownerConfirmedBytePlusPolicy();
 assert.equal(validateCustomerWorkerPolicy(policy).contract.billing.microUsdPerSecond,70_000);
 assert.equal(policy.contract.billing.fixedFeeMicroUsd,0);
 assert.equal(policy.contract.billing.taxBasisPointsUpperBound,0);
 assert.equal(planUpperBoundMicroUsd(5,policy.contract),490_000);
 assert.equal(planUpperBoundMicroUsd(30,policy.contract),2_240_000);
 assert.deepEqual(policy.contract.outputHosts,["v16m-default.tiktokcdn.com"]);
});
test("customer worker fails before the first claimed order if BytePlus credentials are absent",async()=>{
 await assert.rejects(runCustomerPaidWorkerBatch("/does/not/exist",fullEnv),/credentials/);
});
test("customer provider policy validates a finite reviewed total in an offline fixture",()=>{
 assert.equal(validateCustomerWorkerPolicy(syntheticPolicy()).dailyCapMicroUsd,1_000_000);
 for(const invalid of [
  {...syntheticPolicy(),dailyCapMicroUsd:0},
  {...syntheticPolicy(),dailyCapMicroUsd:6_000_000},
  {...syntheticPolicy(),billingEvidence:""},
  {...syntheticPolicy(),expiresAt:new Date(Date.now()+60*86400000).toISOString()},
  {...syntheticPolicy(),contract:{...syntheticPolicy().contract,pilotAdmission:{
    inclusiveMaxMicroUsd:499800,maxGeneratedSeconds:6,planningUpliftBasisPoints:1900 as const,
    evidence:"not customer billing proof"}}},
  {...syntheticPolicy(),contract:{...syntheticPolicy().contract,billing:{
    ...syntheticPolicy().contract.billing,taxBasisPointsUpperBound:null}}},
 ])assert.throws(()=>validateCustomerWorkerPolicy(invalid),/review|policy|contract|billing/i);
});


test("production rejects an actual copied staging pilot policy from its private volume",async()=>{
 const root=await mkdtemp(path.join(tmpdir(),"singmotion-production-policy-"));
 try{
  const stagingPolicy=ownerConfirmedBytePlusPolicy();
  await writeFile(path.join(root,"customer-byteplus-policy.json"),JSON.stringify(stagingPolicy));
  const productionEnv={RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d"};
  await assert.rejects(loadCustomerWorkerPolicy(root,productionEnv),
   /Independent production customer provider policy review required/);
  // The same reviewed, time-limited pilot is accepted for protected Staging.
  assert.equal((await loadCustomerWorkerPolicy(root,{RAILWAY_ENVIRONMENT_ID:staging})).contract.revision,
   stagingPolicy.contract.revision);
  await writeFile(path.join(root,"customer-byteplus-policy.json"),
   JSON.stringify({...stagingPolicy,reviewedBy:"independent-reviewer"}));
  await assert.rejects(loadCustomerWorkerPolicy(root,productionEnv),
   /Independent production customer provider policy review required/);
 }finally{await rm(root,{recursive:true,force:true})}
});


test("owner policy targets are identical for Staging and Production without implying verified provider dispatch",async()=>{
 const {SHARED_BYTEPLUS_TARGET_POLICY:target,baseEstimatedBytePlusMicroUsd}=await import("../lib/commerce/shared-byteplus-target-policy.ts");
 assert.equal(target.minInputSeconds,5);
 assert.equal(target.maxInputSeconds,300);
 assert.equal(target.microUsdPerGeneratedSecond,70_000);
 assert.equal(target.dailyBudgetMicroUsd,null);
 assert.equal(target.lifetimeBudgetMicroUsd,null);
 assert.equal(target.delivery,"private-validated-mp4");
 assert.equal(target.manualPerJobAuthorizationRequired,true);
 assert.equal(target.productionAndStagingIdentical,true);
 assert.equal(baseEstimatedBytePlusMicroUsd(300),21_000_000);
 assert.throws(()=>baseEstimatedBytePlusMicroUsd(301));
 // Target policy by itself must not activate a paid worker in either environment.
 for(const environmentId of [staging,"36adc41d-7e54-4396-ad1a-fd432ba0441d"]){
  assert.equal(customerWorkerEnabled({RAILWAY_ENVIRONMENT_ID:environmentId}),false);
 }
});


test("shared Studio input admission is exactly 5–300 seconds in both environments",async()=>{
 const {assertSharedBytePlusInputSeconds,SHARED_BYTEPLUS_TARGET_POLICY:target}=await import("../lib/commerce/shared-byteplus-target-policy.ts");
 assert.equal(target.productionAndStagingIdentical,true);
 for(const seconds of [5,30,59.999,299.999,300])assert.equal(assertSharedBytePlusInputSeconds(seconds),seconds);
 for(const seconds of [0,4,4.999,300.001,301,Infinity,NaN])
  assert.throws(()=>assertSharedBytePlusInputSeconds(seconds),/between 5 and 300 seconds/);
});
