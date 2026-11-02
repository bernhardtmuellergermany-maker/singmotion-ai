import {test} from "node:test";
import assert from "node:assert/strict";
import {CommerceStore} from "../lib/commerce/store.ts";
import {runPaidRecoveryBatch} from "../lib/commerce/paid-recovery-batch.ts";
import type {OutputValidationContract} from "../lib/live/output.ts";
test("recovery batch remains offline with no acknowledged paid tasks",async()=>{
 const store=new CommerceStore(":memory:");
 try{
  let calls=0;
  const result=await runPaidRecoveryBatch(store,"/missing",{} as OutputValidationContract,
   async()=>{calls++;throw Error("Unexpected status network")},
   async()=>{calls++;throw Error("Unexpected download")},
   new AbortController().signal,10);
  assert.deepEqual(result,[]);
  assert.equal(calls,0);
 }finally{store.close()}
});

test("recovery batch validates bounded size and respects an already aborted signal",async()=>{
 const store=new CommerceStore(":memory:");
 try{
  let calls=0;
  const request=async()=>{calls++;throw Error("Network must stay idle")};
  await assert.rejects(runPaidRecoveryBatch(store,"/missing",{} as OutputValidationContract,
    request,request,new AbortController().signal,0),/Invalid recovery batch size/);
  await assert.rejects(runPaidRecoveryBatch(store,"/missing",{} as OutputValidationContract,
    request,request,new AbortController().signal,101),/Invalid recovery batch size/);
  const controller=new AbortController();controller.abort();
  assert.deepEqual(await runPaidRecoveryBatch(store,"/missing",{} as OutputValidationContract,
    request,request,controller.signal,10),[]);
  assert.equal(calls,0);
 }finally{store.close()}
});
