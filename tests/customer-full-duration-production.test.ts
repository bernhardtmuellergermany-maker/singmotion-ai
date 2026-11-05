import test from "node:test";
import assert from "node:assert/strict";
import {assertCustomerFullDurationCoverage,validateCustomerWorkerPolicy} from "../lib/commerce/customer-paid-worker.ts";
import {ownerConfirmedBytePlusPolicy} from "../lib/commerce/owner-confirmed-provider-policy.ts";

test("owner-attested 30s pilot is not sufficient for public 300s orders",()=>{
 const policy=validateCustomerWorkerPolicy(ownerConfirmedBytePlusPolicy());
 assert.throws(()=>assertCustomerFullDurationCoverage(policy),/5–300 second/);
});

test("full-duration policy requires a budget that covers a real 300s quote",()=>{
 const pilot=ownerConfirmedBytePlusPolicy();
 const policy={
  ...pilot,
  contract:{
   ...pilot.contract,
   generatedDurationBound:{...pilot.contract.generatedDurationBound!,maxInputSeconds:300},
   output:{...pilot.contract.output,maxDurationSeconds:300},
  },
 };
 assert.throws(()=>assertCustomerFullDurationCoverage(policy),/budget/);
});

test("approved 5–300s bounds and sufficient spending caps pass duration preflight",()=>{
 const pilot=ownerConfirmedBytePlusPolicy();
 const policy={
  ...pilot,
  dailyCapMicroUsd:25_000_000,
  lifetimeCapMicroUsd:100_000_000,
  contract:{
   ...pilot.contract,
   generatedDurationBound:{...pilot.contract.generatedDurationBound!,maxInputSeconds:300},
   output:{...pilot.contract.output,maxDurationSeconds:300},
  },
 };
 assert.doesNotThrow(()=>assertCustomerFullDurationCoverage(policy));
});
