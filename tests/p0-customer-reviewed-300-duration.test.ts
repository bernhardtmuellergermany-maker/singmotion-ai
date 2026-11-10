import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {reviewedCustomerOrderMaxSeconds} from "../lib/commerce/reviewed-customer-duration.ts";
import {ownerConfirmedBytePlusPolicy} from "../lib/commerce/owner-confirmed-provider-policy.ts";

const staging="dfaeabed-03df-43ed-aa71-50f343a75041";
const production="36adc41d-7e54-4396-ad1a-fd432ba0441d";
test("customer checkout duration remains 30s without a new independently reviewed 300s envelope",async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),"sm-duration-p0-"));
 try{
  assert.equal(await reviewedCustomerOrderMaxSeconds(dir,{RAILWAY_ENVIRONMENT_ID:staging,
    CUSTOMER_BYTEPLUS_OWNER_CONFIRMED_PRICING:"true"}),30);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test("guest and account paid preparation can reach 300s with a validated worker policy, not a UI flag",async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),"sm-reviewed-300-"));
 try{
  const policy=ownerConfirmedBytePlusPolicy();
  policy.reviewedBy="synthetic-independent-reviewer-for-offline-regression";
  policy.reviewedAt=new Date(Date.now()-3600000).toISOString();
  policy.expiresAt=new Date(Date.now()+2*86400000).toISOString();
  policy.contract.revision="synthetic-300s-reviewed-staging-fixture";
  policy.contract.generatedDurationBound={minInputSeconds:5,maxInputSeconds:300,maxAdditionalSeconds:0,
   evidence:"Offline synthetic 5 to 300 seconds contract envelope reviewed for test only"};
  policy.contract.output.maxDurationSeconds=300;
  policy.contract.output.durationToleranceSeconds=0;
  policy.contract.output.transfer={maxBytes:256_000_000,timeoutMs:180000,
   evidence:"Offline reviewed private transfer allowance for synthetic 300s fixture"};
  policy.dailyCapMicroUsd=25_000_000;
  policy.lifetimeCapMicroUsd=100_000_000;
  await writeFile(path.join(dir,"customer-byteplus-policy.json"),JSON.stringify(policy));
  assert.equal(await reviewedCustomerOrderMaxSeconds(dir,{RAILWAY_ENVIRONMENT_ID:staging}),300);
  await assert.rejects(reviewedCustomerOrderMaxSeconds(dir,{RAILWAY_ENVIRONMENT_ID:production}),
   /production customer provider policy review/i);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test("malformed overlong cost policy cannot admit charge for 300-second customer video",async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),"sm-unreviewed-300-"));
 try{
  const policy=ownerConfirmedBytePlusPolicy();
  policy.contract.generatedDurationBound!.maxInputSeconds=300;
  await writeFile(path.join(dir,"customer-byteplus-policy.json"),JSON.stringify(policy));
  await assert.rejects(reviewedCustomerOrderMaxSeconds(dir,{RAILWAY_ENVIRONMENT_ID:staging}));
 }finally{await rm(dir,{recursive:true,force:true})}
});
