import {test} from "node:test";
import assert from "node:assert/strict";
import {CommerceStore} from "../lib/commerce/store.ts";
import {recoveryPreflight} from "../scripts/paid-recovery-preflight.ts";
test("recovery preflight makes no paid dispatch and reports only counts",()=>{
 const store=new CommerceStore(":memory:");
 try {
  const before=store.db.prepare("SELECT COUNT(*) AS n FROM commerce_audit").get()?.n;
  assert.deepEqual(recoveryPreflight(store),{
   acknowledgedRecovery:0,pendingNotDispatched:0,dispatchEnabled:false,networkRequests:0
  });
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM commerce_audit").get()?.n,before);
 }finally{store.close()}
});

import {reviewedPolicy,runPaidRecoveryCommand} from "../scripts/paid-recovery-worker.ts";

test("recovery execution refuses production before reading review files or contacting a provider",async()=>{
 await assert.rejects(runPaidRecoveryCommand([
  "--once","--review-file","/never-read","--confirm-sha256","a".repeat(64)
 ],{RAILWAY_ENVIRONMENT_ID:"production"}),/staging environment/);
});

test("recovery policy requires final reviewed 720p, safe hosts and bounded transfer",()=>{
 const valid={
  outputHosts:["video.example.com"],
  output:{width:720,height:1280,fps:25,maxDurationSeconds:300,
   durationToleranceSeconds:0.1,videoCodec:"h264",audioCodec:"aac",
   transfer:{maxBytes:100000000,timeoutMs:120000,evidence:"operator-reviewed private MP4 transfer policy"}}
 };
 assert.equal(reviewedPolicy(valid).output.width,720);
 assert.equal(reviewedPolicy({...valid,output:{...valid.output,width:1280,height:720}}).output.height,720);
 for(const policy of [
  {...valid,discover720p:true},
  {...valid,output:{...valid.output,width:786,height:1178}},
  {...valid,outputHosts:["127.0.0.1"]},
  {...valid,outputHosts:["localhost"]},
  {...valid,output:{...valid.output,transfer:{...valid.output.transfer,evidence:""}}}
 ])assert.throws(()=>reviewedPolicy(policy));
});
