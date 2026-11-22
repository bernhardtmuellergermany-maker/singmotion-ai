import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {existsSync,mkdtempSync,rmSync} from "node:fs";
import path from "node:path";
import {tmpdir} from "node:os";
import {randomUUID} from "node:crypto";
import {CommerceStore} from "../lib/commerce/store.ts";
import {CreditWallet} from "../lib/commerce/credit-wallet.ts";
import {SupportCases} from "../lib/commerce/support-cases.ts";
import {automaticCreditRecoveryPolicy,recoverVideoCredits} from "../lib/commerce/automatic-credit-recovery.ts";

const env={RAILWAY_ENVIRONMENT_ID:"dfaeabed-03df-43ed-aa71-50f343a75041",
 AUTO_VIDEO_CREDIT_RECOVERY_ENABLED:"true",AUTO_VIDEO_CREDIT_RECOVERY_TIMEOUT_MINUTES:"120"};
const HOUR=60*60*1000;
function fixture(){
 const root=mkdtempSync(path.join(tmpdir(),"automatic-video-credit-"));
 const store=new CommerceStore(path.join(root,"commerce.sqlite"),env);
 const live=new DatabaseSync(path.join(root,"live-test.sqlite"));
 live.exec("CREATE TABLE live_attempts(id TEXT PRIMARY KEY,data TEXT NOT NULL)");
 const wallet=new CreditWallet(store.db);
 new SupportCases(store.db);
 return {root,store,live,wallet,close(){live.close();store.close();rmSync(root,{recursive:true,force:true})}};
}
function seed(f:ReturnType<typeof fixture>,input:{
 state?:string;code?:string|null;owner?:string;ageHours?:number;settled?:boolean;providerJobId?:string|null;
 outputPath?:string|null;subject?:string
}={},now=Date.now()){
 const id=randomUUID(),customer=randomUUID(),subject=input.subject??"customer:"+customer;
 f.store.db.prepare("INSERT INTO customer_accounts VALUES(?,?,?,?)")
  .run(customer,"auto@example.test","test-password-hash",now-4*HOUR);
 f.store.db.prepare("INSERT INTO credit_wallet_ledger VALUES(?,?,?,?,?,?)")
  .run("initial-"+id,subject,500,"topup","initial-"+id,now-4*HOUR);
 f.wallet.reserveVideo(id,subject,45);
 const started=now-(input.ageHours??3)*HOUR;
 f.store.db.prepare("UPDATE credit_video_reservations SET created=?,updated=? WHERE project_id=?")
  .run(started,started,id);
 if(input.settled)f.wallet.reconcileVideo(id,"completed");
 f.live.prepare("INSERT INTO live_attempts VALUES(?,?)").run(id,JSON.stringify({
  state:input.state??"uncertain",failureCode:input.code===undefined?"SUBMISSION_OUTCOME_UNKNOWN":input.code,
  outputPath:input.outputPath===undefined?null:input.outputPath,
  providerJobId:input.providerJobId===undefined?null:input.providerJobId,
  createdAt:started,updatedAt:started,media:{owner:input.owner??"customer-"+customer}
 }));
 return {id,subject,customer};
}
test("automatic compensation is fail-closed on disabled, unknown or unsafe configuration",()=>{
 assert.equal(automaticCreditRecoveryPolicy({}).enabled,false);
 assert.equal(automaticCreditRecoveryPolicy({...env,RAILWAY_ENVIRONMENT_ID:"unknown"}).enabled,false);
 assert.equal(automaticCreditRecoveryPolicy({...env,AUTO_VIDEO_CREDIT_RECOVERY_TIMEOUT_MINUTES:"15"}).enabled,false);
 assert.equal(automaticCreditRecoveryPolicy({...env,AUTO_VIDEO_CREDIT_RECOVERY_TIMEOUT_MINUTES:"not-a-number"}).enabled,false);
 assert.equal(automaticCreditRecoveryPolicy(env).timeoutMs,2*HOUR);
});
test("old unknown submission releases held Credits exactly once, logs audit and queues customer notification",()=>{
 const f=fixture();try{
  const now=Date.now(),{id,subject}=seed(f,{},now);
  assert.equal(f.wallet.available(subject),455);
  const first=recoverVideoCredits(f.root,{env,now});
  assert.equal(first.returned,1);
  assert.equal(first.uncertain,1);
  assert.equal(f.wallet.available(subject),500);
  assert.equal(f.wallet.videoReservation(id)?.state,"released");
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM credit_wallet_ledger WHERE kind='auto-video-credit-return'").get()!.n,1);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM support_case_events WHERE event_key=?")
    .get("auto-video-return:"+id)!.n,1);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM support_case_mail_outbox WHERE reference=?").get(id)!.n,1);
  const again=recoverVideoCredits(f.root,{env,now:now+60000});
  assert.equal(again.returned,0);
  assert.equal(f.wallet.available(subject),500);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM credit_wallet_ledger WHERE kind='auto-video-credit-return'").get()!.n,1);
 }finally{f.close()}
});
test("only terminal failed videos are returned; active and still-processing tasks stay reserved",()=>{
 const f=fixture();try{
  const now=Date.now();
  const failed=seed(f,{state:"failed",code:"PROVIDER_JOB_FAILED",ageHours:0.25},now);
  const running=seed(f,{state:"processing",code:null,ageHours:10,providerJobId:"provider_123"},now);
  const submitted=seed(f,{state:"submitted",code:null,ageHours:10,providerJobId:"provider_456"},now);
  const observed=seed(f,{state:"output_observed",code:null,ageHours:10,providerJobId:"provider_789"},now);
  const result=recoverVideoCredits(f.root,{env,now});
  assert.equal(result.returned,1);
  assert.equal(f.wallet.videoReservation(failed.id)?.state,"released");
  for(const x of [running,submitted,observed])assert.equal(f.wallet.videoReservation(x.id)?.state,"reserved");
 }finally{f.close()}
});
test("do not refund unknown submission before timeout, with provider ID, or with delivered output",()=>{
 const f=fixture();try{
  const now=Date.now();
  const young=seed(f,{ageHours:1},now);
  const provider=seed(f,{providerJobId:"provider_task",ageHours:10},now);
  const ready=seed(f,{state:"completed",code:null,outputPath:"/tmp/output.mp4"},now);
  const result=recoverVideoCredits(f.root,{env,now});
  assert.equal(result.returned,0);
  for(const x of [young,provider,ready])assert.equal(f.wallet.videoReservation(x.id)?.state,"reserved");
 }finally{f.close()}
});
test("invalid provider owner, staff wallets and missing evidence are never compensated",()=>{
 const f=fixture();try{
  const now=Date.now();
  const wrong=seed(f,{owner:"customer-not-the-real-owner"},now);
  const staff=seed(f,{subject:"super-admin:123"},now);
  const missing=seed(f,{},now);
  f.live.prepare("DELETE FROM live_attempts WHERE id=?").run(missing.id);
  const r=recoverVideoCredits(f.root,{env,now});
  assert.equal(r.returned,0);
  for(const x of [wrong,staff,missing])assert.equal(f.wallet.videoReservation(x.id)?.state,"reserved");
 }finally{f.close()}
});
test("settled debit is reversed only once when terminal provider error is verified",()=>{
 const f=fixture();try{
  const now=Date.now(),{id,subject}=seed(f,{state:"failed",code:"PROVIDER_JOB_FAILED",settled:true},now);
  assert.equal(f.wallet.available(subject),455);
  const first=recoverVideoCredits(f.root,{env,now});
  assert.equal(first.returned,1);
  assert.equal(f.wallet.available(subject),500);
  assert.equal(f.wallet.videoReservation(id)?.state,"released");
  assert.equal(recoverVideoCredits(f.root,{env,now:now+60000}).returned,0);
  assert.equal(f.wallet.available(subject),500);
 }finally{f.close()}
});
test("disabled automatic recovery does not change any financial state",()=>{
 const f=fixture();try{
  const {id,subject}=seed(f);
  assert.equal(recoverVideoCredits(f.root,{env:{...env,AUTO_VIDEO_CREDIT_RECOVERY_ENABLED:"false"}}).returned,0);
  assert.equal(f.wallet.videoReservation(id)?.state,"reserved");
  assert.equal(f.wallet.available(subject),455);
 }finally{f.close()}
});
test("never creates databases when there is no original evidence",()=>{
 const root=mkdtempSync(path.join(tmpdir(),"auto-credit-missing-"));
 try{
  assert.equal(recoverVideoCredits(root,{env}).returned,0);
  assert.equal(existsSync(path.join(root,"commerce.sqlite")),false);
 }finally{rmSync(root,{recursive:true,force:true})}
});
