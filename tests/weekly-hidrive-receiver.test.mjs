import test from "node:test";
import assert from "node:assert/strict";
import { createTestPKI } from "../scripts/backup-network-certificates.mjs";
import { weeklyBackupSlot } from "../lib/ops/weekly-hidrive-schedule.mjs";
import { runProductionCiphertextReceiver } from "../scripts/hidrive-production-receiver.mjs";

const sunday=Date.UTC(2026,10,22,3,0);
async function fixture(){
 const pki=await createTestPKI("singmotion-backup.railway.internal");
 return {
   RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d",
   RAILWAY_SERVICE_NAME:"singmotion-backup",
   BACKUP_MODE:"PRODUCTION_WEEKLY_CIPHERTEXT_RECEIVER",
   BACKUP_ENABLED:"false", BACKUP_PROVIDER:"STRATO_HIDRIVE",
   BACKUP_DATA_CLASS:"PRODUCTION_ENCRYPTED_ONLY",
   BACKUP_WEEKLY_HIDRIVE_APPROVED:"YES",
   BACKUP_WEEKLY_HIDRIVE_MAX_BYTES:"2147483648",
   HIDRIVE_CLIENT_ID:"fixture-client",HIDRIVE_CLIENT_SECRET:"synthetic-do-not-use",
   HIDRIVE_BACKUP_FOLDER:"safe-fixture",
   BACKUP_RECEIVER_CA_B64:pki.BACKUP_TEST_CA_B64,
   BACKUP_RECEIVER_CERT_B64:pki.BACKUP_TEST_SERVER_CERT_B64,
   BACKUP_RECEIVER_KEY_B64:pki.BACKUP_TEST_SERVER_KEY_B64,
   BACKUP_RECEIVER_WRITER_FP:pki.BACKUP_TEST_WRITER_FP,
   BACKUP_RECEIVER_READER_FP:pki.BACKUP_TEST_READER_FP,
 };
}
test("weekly receiver computes exact authorized Sunday run before any OAuth",async()=>{
  const env=await fixture();
  const slot=weeklyBackupSlot(sunday,env.BACKUP_RECEIVER_WRITER_FP);
  assert.equal(slot.receiverOpen,true);
  assert.match(slot.run,/^[a-f0-9-]{36}$/);
  let contacts=0, phases=[];
  await assert.rejects(
    runProductionCiphertextReceiver(env,{
      now:()=>sunday,
      interfaces:()=>({all:[{address:"127.0.0.1",internal:false}]}),
      sessionFactory:async()=>{contacts++;throw Error("FORBIDDEN_OAUTH_CONTACT");},
      onPhase:p=>phases.push(p),
    }),
    /RECEIVER_PRIVATE_ADDRESS_UNAVAILABLE/,
  );
  assert.equal(contacts,0);
  assert.deepEqual(phases,["HIDRIVE_RECEIVER_CONFIG_VALIDATED"]);
});
test("weekly receiver refuses weekday, missing consent and over-cap before OAuth",async()=>{
 const env=await fixture();
 const scenarios=[
   [Date.UTC(2026,10,19,3,0),env,"RECEIVER_WEEKLY_WINDOW_CLOSED"],
   [sunday,{...env,BACKUP_WEEKLY_HIDRIVE_APPROVED:"NO"},"RECEIVER_WEEKLY_APPROVAL_REQUIRED"],
   [sunday,{...env,BACKUP_WEEKLY_HIDRIVE_MAX_BYTES:"9999"},"WEEKLY_TRANSFER_BUDGET_REQUIRED"],
 ];
 for(const [now,config,code] of scenarios){
   let contacts=0;
   await assert.rejects(runProductionCiphertextReceiver(config,{
     now:()=>now,sessionFactory:async()=>{contacts++},
     interfaces:()=>({all:[]}),
   }),new RegExp(code));
   assert.equal(contacts,0);
 }
});
