import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTestPKI } from "../scripts/backup-network-certificates.mjs";
import {
  productionReceiverConfig,runProductionCiphertextReceiver,
} from "../scripts/hidrive-production-receiver.mjs";

const now=Date.parse("2026-11-17T09:00:00Z");
async function config() {
  const keys=await createTestPKI("singmotion-backup.railway.internal");
  return {
    RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d",
    RAILWAY_SERVICE_NAME:"singmotion-backup",
    BACKUP_MODE:"PRODUCTION_CIPHERTEXT_ONLY_RECEIVER",
    BACKUP_ENABLED:"false",
    BACKUP_PROVIDER:"STRATO_HIDRIVE",
    BACKUP_REAL_TRANSFER_APPROVED:"YES",
    BACKUP_DATA_CLASS:"PRODUCTION_ENCRYPTED_ONLY",
    BACKUP_RUN_ID:randomUUID(),
    BACKUP_RECEIVER_EXPIRES_AT:new Date(now+60*60*1000).toISOString(),
    HIDRIVE_CLIENT_ID:"fixture-client",
    HIDRIVE_CLIENT_SECRET:"synthetic-do-not-use",
    HIDRIVE_BACKUP_FOLDER:"safe-fixture",
    BACKUP_RECEIVER_CA_B64:keys.BACKUP_TEST_CA_B64,
    BACKUP_RECEIVER_CERT_B64:keys.BACKUP_TEST_SERVER_CERT_B64,
    BACKUP_RECEIVER_KEY_B64:keys.BACKUP_TEST_SERVER_KEY_B64,
    BACKUP_RECEIVER_WRITER_FP:keys.BACKUP_TEST_WRITER_FP,
    BACKUP_RECEIVER_READER_FP:keys.BACKUP_TEST_READER_FP,
    _testKeys:keys,
  };
}
test("guarded Production receiver accepts exact approved service/run, validated TLS identities, bounded expiry",async()=>{
  const { _testKeys,...env}=await config();
  const result=productionReceiverConfig(env,now);
  assert.equal(result.run,env.BACKUP_RUN_ID);
  assert.equal(result.expiry,now+60*60*1000);
  assert.equal(result.clientFingerprint,env.BACKUP_RECEIVER_WRITER_FP);
  assert.ok(result.tls.ca.length>100);
  assert.equal(result.tls.cert.includes(Buffer.from("synthetic-do-not-use")),false);
  assert.equal(JSON.stringify(result).includes("HIDRIVE_CLIENT_SECRET"),false);
});
test("receiver refuses wrong runtime, transfer approval, expired or unbounded mode before OAuth",async()=>{
  const {_testKeys,...env}=await config();
  const differences=[
    {RAILWAY_ENVIRONMENT_ID:"staging"},
    {RAILWAY_SERVICE_NAME:"singmotion-ai"},
    {BACKUP_MODE:"SETUP_ONLY_NO_DATA_TRANSFER"},
    {BACKUP_ENABLED:"true"},
    {BACKUP_PROVIDER:"wrong"},
    {BACKUP_REAL_TRANSFER_APPROVED:""},
    {BACKUP_DATA_CLASS:"SYNTHETIC_ONLY"},
    {BACKUP_RUN_ID:"not-a-uuid"},
    {BACKUP_RECEIVER_EXPIRES_AT:new Date(now-3000).toISOString()},
    {BACKUP_RECEIVER_EXPIRES_AT:new Date(now+3*60*60*1000).toISOString()},
    {HIDRIVE_CLIENT_SECRET:""},
    {HIDRIVE_AUTH_CODE:"never-reauthorize"},
  ];
  for(const patch of differences)
    assert.throws(()=>productionReceiverConfig({...env,...patch},now));
});
test("receiver refuses inherited app/R2/payment/recovery/signing secrets and wrong certificate identities",async()=>{
  const {_testKeys:keys,...env}=await config();
  const forbidden=[
    {DATA_DIR:"/app/.data"},
    {CMS_DATABASE_URL:"postgres://secret"},
    {R2_ACCESS_KEY_ID:"secret"},
    {STRIPE_SECRET_KEY:"secret"},
    {BYTEPLUS_SECRET_ACCESS_KEY:"secret"},
    {BACKUP_RECOVERY_PRIVATE_KEY_B64:"secret"},
    {BACKUP_SIGNING_PRIVATE_KEY_B64:"secret"},
    {PGPASSWORD:"secret"},
    {BACKUP_RECEIVER_WRITER_FP:"not-a-fingerprint"},
    {BACKUP_RECEIVER_KEY_B64:keys.BACKUP_TEST_READER_KEY_B64},
    {BACKUP_RECEIVER_CERT_B64:keys.BACKUP_TEST_READER_CERT_B64},
    {BACKUP_RECEIVER_CA_B64:keys.BACKUP_TEST_WRONG_CA_B64},
    {BACKUP_RECEIVER_CERT_B64:"bad"},
  ];
  for(const patch of forbidden)
    assert.throws(()=>productionReceiverConfig({...env,...patch},now));
});
test("production receiver cannot contact HiDrive without approved private network bind",async()=>{
  const {_testKeys,...env}=await config();
  let contacts=0;
  await assert.rejects(
    runProductionCiphertextReceiver(env,{
      now:()=>now,
      interfaces:()=>({all:[{address:"127.0.0.1",internal:false}]}),
      sessionFactory:async()=>{contacts++;throw Error("FORBIDDEN_OAUTH_CONTACT");},
    }),
    /RECEIVER_PRIVATE_ADDRESS_UNAVAILABLE/,
  );
  assert.equal(contacts,0);
});
