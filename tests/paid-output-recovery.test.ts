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
 }finally{store.close()}
});
