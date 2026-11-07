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
  for(const invalid of [NaN,Infinity,-1,1.5,101]){
   await assert.rejects(runPaidRecoveryBatch(store,"/missing",{} as OutputValidationContract,
     request,request,new AbortController().signal,invalid),/Invalid recovery batch size/);
  }
  assert.deepEqual(await runPaidRecoveryBatch(store,"/missing",{} as OutputValidationContract,
    request,request,new AbortController().signal,100),[]);
  const controller=new AbortController();controller.abort();
  assert.deepEqual(await runPaidRecoveryBatch(store,"/missing",{} as OutputValidationContract,
    request,request,controller.signal,10),[]);
  assert.equal(calls,0);
 }finally{store.close()}
});

test("paid download diagnosis separates exact safe failures without exposing URL or credentials",async()=>{
 const {classifyPaidDeliveryFailure,PaidDeliveryStageError}=await import("../lib/commerce/paid-video-delivery.ts");
 for(const [message,expected] of [
  ["Provider output URL is not an approved HTTPS download destination.","provider-host"],
  ["Provider output DNS resolution failed or timed out.","provider-dns"],
  ["Provider output connection failed or timed out.","provider-network"],
  ["Provider output HTTP status rejected; redirects are forbidden.","provider-http"],
  ["Provider output length/encoding is invalid or too large.","provider-headers"],
  ["Cannot create private provider output file.","provider-private-file"],
  ["Provider output is not a decodable MP4.","provider-media"],
  ["OUTPUT_CODEC_MISMATCH","provider-media-codec"],
  ["OUTPUT_FORMAT_INVALID","provider-media-format"],
  ["OUTPUT_DIMENSIONS_MISMATCH_ACTUAL_786x1178_EXPECTED_720x1280","provider-media-dimensions"],
  ["OUTPUT_DURATION_MISMATCH","provider-media-duration"],
  ["OUTPUT_FRAMERATE_MISMATCH","provider-media-framerate"],
  ["OUTPUT_NORMALIZATION_POLICY_REJECTED","provider-media-normalization"],
 ] as const){
  const error=new Error(message);
  assert.equal(classifyPaidDeliveryFailure("provider-download",error),expected);
  const result=new PaidDeliveryStageError(expected);
  assert.equal(result.message,"Private paid delivery stage failed");
  assert.doesNotMatch(result.message,/https|token|url/i);
 }
 assert.equal(classifyPaidDeliveryFailure("source",new Error("private path")), "source");
});
