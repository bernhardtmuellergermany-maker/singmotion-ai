import test from "node:test";
import assert from "node:assert/strict";
import { createTestPKI } from "../scripts/backup-network-certificates.mjs";
import { runApprovedWeeklyHiDriveOnce } from "../lib/ops/weekly-hidrive-sender.mjs";
import { weeklyBackupSlot } from "../lib/ops/weekly-hidrive-schedule.mjs";
import { X509Certificate } from "node:crypto";
import { gzipSync } from "node:zlib";
import { parseWeeklyPkiBundle } from "../lib/ops/weekly-hidrive-schedule.mjs";

const t=Date.UTC(2026,10,22,3,10);
async function fixture(){
  const pki=await createTestPKI("singmotion-backup.railway.internal");
  return {
    BACKUP_WEEKLY_HIDRIVE_APPROVED:"YES",
    BACKUP_WEEKLY_HIDRIVE_MAX_BYTES:"2147483648",
    PRODUCTION_WEEKLY_HIDRIVE_ENABLED:"YES",
    RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d",
    RAILWAY_SERVICE_NAME:"singmotion-ai",
    DATA_DIR:"/app/.data",
    WEEKLY_BACKUP_PKI_BUNDLE_GZ_B64:gzipSync(Buffer.from(JSON.stringify({
      "ca.crt":pki.BACKUP_TEST_CA_B64,
      "writer.crt":pki.BACKUP_TEST_WRITER_CERT_B64,
      "writer.key":pki.BACKUP_TEST_WRITER_KEY_B64,
    }))).toString("base64"),
  };
}
test("off by default and outside weekly time, performs no filesystem claim or network",async()=>{
  const base=await fixture();
  let calls=0;
  const claim=async()=>{calls++;};
  const sender=async()=>{calls++;};
  assert.equal((await runApprovedWeeklyHiDriveOnce(
    {...base,PRODUCTION_WEEKLY_HIDRIVE_ENABLED:"NO"},{now:()=>t,claim,sender}
  )).status,"refused");
  assert.equal((await runApprovedWeeklyHiDriveOnce(
    {...base,BACKUP_WEEKLY_HIDRIVE_APPROVED:"NO"},{now:()=>t,claim,sender}
  )).status,"disabled");
  assert.equal((await runApprovedWeeklyHiDriveOnce(
    base,{now:()=>Date.UTC(2026,10,19,20),claim,sender}
  )).status,"not-due");
  assert.equal(calls,0);
});
test("Sunday exact run and expiresAt sent to existing encrypted multistore sender",async()=>{
  const base=await fixture();
  const fingerprint=new X509Certificate(Buffer.from(parseWeeklyPkiBundle(base.WEEKLY_BACKUP_PKI_BUNDLE_GZ_B64,"app")["writer.crt"],"base64")).fingerprint256;
  const slot=weeklyBackupSlot(t,fingerprint);
  const calls=[],logs=[];
  const result=await runApprovedWeeklyHiDriveOnce(base,{
    now:()=>t,
    claim:async file=>calls.push(["claim",file]),
    log:marker=>logs.push(marker),
    sender:async (env,callbacks)=>{
      calls.push(["sender",env.PRODUCTION_OFFSITE_BACKUP_RUN_ID]);
      assert.equal(env.BACKUP_WEEKLY_EXECUTION_CONTEXT,"YES");
      assert.equal(env.PRODUCTION_OFFSITE_BACKUP_APPROVED,"YES");
      assert.equal(env.PRODUCTION_OFFSITE_BACKUP_EXPIRES_AT,new Date(slot.expiresAt).toISOString());
      assert.equal(env.PRODUCTION_OFFSITE_BACKUP_PG_ONLY,"");
      callbacks.log("PRODUCTION_OFFSITE_BACKUP_STAGE","REMOTE_COMMITTED");
      return {status:"committed",summary:{run:slot.run,remoteReceiptCommitted:true}};
    },
  });
  assert.equal(result.status,"committed");
  assert.equal(result.run,slot.run);
  assert.deepEqual(calls,[
    ["claim","/app/.data/.weekly-hidrive-2026-11-22.attempt"],
    ["sender",slot.run],
  ]);
  assert.deepEqual(logs,["WEEKLY_HIDRIVE_EXPORT_START","WEEKLY_HIDRIVE_REMOTE_COMMITTED","WEEKLY_HIDRIVE_EXPORT_PASS"]);
});
test("durable attempt claim blocks duplicate after restart and no false pass on failed receipt",async()=>{
 const base=await fixture();
 let calls=0;
 const duplicate=await runApprovedWeeklyHiDriveOnce(base,{
   now:()=>t,
   claim:async()=>{throw Object.assign(new Error("exists"),{code:"EEXIST"})},
   sender:async()=>{calls++},
 });
 assert.equal(duplicate.status,"already-attempted");
 assert.equal(calls,0);
 const warnings=[];
 const failed=await runApprovedWeeklyHiDriveOnce(base,{
   now:()=>t,claim:async()=>{},
   sender:async()=>({status:"committed",summary:{run:"wrong",remoteReceiptCommitted:true}}),
   warn:marker=>warnings.push(marker),
 });
 assert.equal(failed.status,"failed");
 assert.deepEqual(warnings,["WEEKLY_HIDRIVE_EXPORT_FAILED"]);
});
