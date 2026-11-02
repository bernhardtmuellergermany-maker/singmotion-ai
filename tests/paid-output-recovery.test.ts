import {test} from "node:test";
import assert from "node:assert/strict";
import {CommerceStore} from "../lib/commerce/store.ts";
import {recoverReviewedPaidOutput} from "../lib/commerce/paid-output-recovery.ts";

test("recovery never touches provider or download for an unacknowledged order",async()=>{
 const store=new CommerceStore(":memory:");
 try{
  let calls=0,downloads=0;
  const result=await recoverReviewedPaidOutput(store,"11111111-1111-4111-8111-111111111111",async()=>{calls++;throw Error("network should not run")},new AbortController().signal,async()=>{downloads++;return "delivered"});
  assert.equal(result,"awaiting-job");
  assert.equal(calls,0);
  assert.equal(downloads,0);
 }finally{store.close()}
});
