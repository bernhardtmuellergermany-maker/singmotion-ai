import {test} from "node:test";
import assert from "node:assert/strict";
import {CommerceStore} from "../lib/commerce/store.ts";
import {recoverAndDeliverPaidCustomerVideo} from "../lib/commerce/paid-customer-recovery.ts";
import type {OutputValidationContract} from "../lib/live/output.ts";

test("composed customer recovery never contacts BytePlus or downloads without a claimed paid job",async()=>{
 const store=new CommerceStore(":memory:");
 try{
  let providerCalls=0,downloadCalls=0;
  const result=await recoverAndDeliverPaidCustomerVideo(store,
   "11111111-1111-4111-8111-111111111111","/nonexistent",
   {} as OutputValidationContract,
   async()=>{providerCalls++;throw Error("Unexpected BytePlus call")},
   async()=>{downloadCalls++;throw Error("Unexpected MP4 download")},
   new AbortController().signal);
  assert.equal(result,"awaiting-job");
  assert.equal(providerCalls,0);
  assert.equal(downloadCalls,0);
 }finally{store.close()}
});
