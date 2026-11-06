import {test} from "node:test";
import assert from "node:assert/strict";
import {CommerceStore} from "../lib/commerce/store.ts";
import {recoverReviewedPaidOutput,paidRecoveryFailureCategory} from "../lib/commerce/paid-output-recovery.ts";
import {BytePlusError,BytePlusProtocol} from "../lib/live/byteplus.ts";

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

test("recovery discovery skips pending and ambiguous paid submissions",async()=>{
 const store=new CommerceStore(":memory:");
 try{
  const mk=(project:string,key:string)=>store.order({account:"11111111-1111-4111-8111-111111111111",email:"buyer@example.test",
   project,cents:1250,quoteEvidence:"verified-recovery-discovery-evidence",key}).id;
  const known=mk("known-project","known-recovery-test");
  const unknown=mk("unknown-project","unknown-recovery-test");
  const pending=mk("pending-project","pending-recovery-test");
  for(const [id,session] of [[known,"cs_test_known_recovery"],[unknown,"cs_test_unknown_recovery"],[pending,"cs_test_pending_recovery"]] as const){
   store.bindStripeCheckout(id,session);
   await store.webhook(new Uint8Array(),"signed",{async verify(){return {
    provider:"stripe",eventId:"evt_"+session,orderId:id,cents:1250,currency:"EUR" as const,evidence:session
   }}});
  }
  assert.equal(store.claimPaidFulfillment(known),true);
  assert.equal(store.beginPaidProviderSubmission(known),true);
  store.recordPaidProviderJob(known,"byteplus","task_known_recovery");
  assert.equal(store.claimPaidFulfillment(unknown),true);
  assert.equal(store.beginPaidProviderSubmission(unknown),true);
  assert.deepEqual(store.acknowledgedPaidRecovery(),[known]);
  assert.deepEqual(store.acknowledgedPaidRecovery(1),[known]);
  assert.throws(()=>store.acknowledgedPaidRecovery(0),/Invalid recovery batch size/);
  // Only status reads are permitted. Ambiguous, expired and cancelled provider
  // outcomes must not cause downloads, queue transitions or new submissions.
  let statusReads=0,downloads=0;
  for(const [providerState,expected] of [
    ["in_queue","pending"],["generating","pending"],
    ["not_found","unverified"],["expired","unverified"],
    ["canceled","unverified"]
  ] as const){
    const reasons:string[]=[];
    const actual=await recoverReviewedPaidOutput(store,known,async request=>{
      assert.match(request.url,/Action=CVSync2AsyncGetResult/);
      statusReads++;
      return {status:200,body:{code:10000,data:{status:providerState}}};
    },new AbortController().signal,async()=>{downloads++;return "delivered"},reason=>reasons.push(reason));
    assert.equal(actual,expected);
    assert.deepEqual(reasons,expected==="unverified"?["provider_noncompletion"]:[]);
  }
  assert.equal(statusReads,5);
  assert.equal(downloads,0);
  const failures:string[]=[];
  const unreachable=await recoverReviewedPaidOutput(store,known,async()=>{
   throw Error("private provider response must not leak");
  },new AbortController().signal,async()=>{downloads++;return "delivered"},reason=>failures.push(reason));
  assert.equal(unreachable,"unverified");
  assert.deepEqual(failures,["provider_transient"]);
  assert.equal(downloads,0);
  assert.equal(store.db.prepare("SELECT state FROM customer_fulfillment_queue WHERE order_id=?").get(known)?.state,"processing");
  assert.deepEqual(store.acknowledgedPaidRecovery(),[known]);

  // Documented permanent content pre-filter rejection is final, evidence-
  // bound, and must never turn the paid claim into another provider submit.
  let rejectionReads=0;
  const diagnostics:string[]=[];
  const rejected=await recoverReviewedPaidOutput(store,known,async request=>{
   assert.match(request.url,/Action=CVSync2AsyncGetResult/);
   rejectionReads++;
   return {status:500,body:{code:50510,data:null,message:"provider message never displayed"}};
  },new AbortController().signal,async()=>{downloads++;return "delivered"},reason=>diagnostics.push(reason));
  assert.equal(rejected,"unverified");
  assert.deepEqual(diagnostics,["provider_prefilter"]);
  assert.equal(rejectionReads,1);
  assert.equal(downloads,0);
  assert.equal(store.db.prepare("SELECT state FROM customer_fulfillment_queue WHERE order_id=?").get(known)?.state,"failed");
  assert.deepEqual(store.acknowledgedPaidRecovery(),[]);
  const noRetry=await recoverReviewedPaidOutput(store,known,async()=>{
   rejectionReads++;throw Error("must never repoll a permanently rejected job");
  },new AbortController().signal,async()=>{downloads++;return "delivered"});
  assert.equal(noRetry,"awaiting-job");
  assert.equal(rejectionReads,1);
  assert.equal(downloads,0);

 }finally{store.close()}
});

test("read-only status diagnostics distinguish missing provider data and corrupt completion payload",async()=>{
 const signal=new AbortController().signal;
 const cases=[
  [{code:10000,data:null},"MISSING_TASK_STATUS_DATA","provider_missing_task_data"],
  [{code:10000,data:{status:"done",resp_data:"not-json"}},"INVALID_OUTPUT_PAYLOAD_JSON","provider_invalid_output_json"],
  [{code:10000,data:{status:"done",resp_data:"[]"}},"INVALID_OUTPUT_PAYLOAD_OBJECT","provider_invalid_output_object"],
  [{code:10000,data:{status:"done",resp_data:"x".repeat(262145)}},"OUTPUT_PAYLOAD_TOO_LARGE","provider_output_payload_too_large"],
 ] as const;
 for(const [body,code,category] of cases){
  let reads=0;
  await assert.rejects(new BytePlusProtocol(async request=>{
   assert.match(request.url,/Action=CVSync2AsyncGetResult/);
   reads++;
   return {status:200,body};
  }).status("task-read-only",signal),(error:unknown)=>{
   assert.ok(error instanceof BytePlusError);
   assert.equal(error.diagnostic.code,code);
   assert.equal(paidRecoveryFailureCategory(error),category);
   return true;
  });
  assert.equal(reads,1);
 }
});

test("paid recovery reports safe BytePlus error categories without sensitive response details",()=>{
 for(const [code,expected] of [
  ["TRANSPORT_AUTHENTICATION","provider_authentication"],
  ["TRANSPORT_THROTTLED","provider_throttled"],
  ["TRANSPORT_TRANSIENT","provider_transient"],
  ["TRANSPORT_PROTOCOL","provider_protocol"],
  ["PROVIDER_REJECTED","provider_rejected"],
  ["UNSUPPORTED_TASK_STATUS","provider_unsupported_status"],
  ["COMPLETED_WITHOUT_VIDEO_URL","provider_completed_without_url"],
  ["INVALID_PROVIDER_RESPONSE","provider_status_unavailable"],
 ] as const){
  const error=new BytePlusError(false,{code});
  assert.equal(paidRecoveryFailureCategory(error),expected);
 }
 assert.equal(paidRecoveryFailureCategory(new BytePlusError(false,{code:"PROVIDER_REJECTED",providerCode:50400})),"provider_denied");
 assert.equal(paidRecoveryFailureCategory(new BytePlusError(false,{code:"PROVIDER_REJECTED",providerCode:50510})),"provider_prefilter");
 assert.equal(paidRecoveryFailureCategory(new Error("sensitive private response")),"provider_status_unavailable");
});
