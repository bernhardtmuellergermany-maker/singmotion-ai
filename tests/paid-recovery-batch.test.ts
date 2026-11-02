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
