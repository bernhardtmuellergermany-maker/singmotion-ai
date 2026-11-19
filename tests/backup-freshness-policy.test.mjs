import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, randomUUID } from "node:crypto";
import { evaluateBackupFreshness, WEEKLY_HIDRIVE_INTERVAL_DAYS, WEEKLY_HIDRIVE_MAX_AGE_MS } from "../lib/ops/backup-freshness-policy.mjs";

const keys=generateKeyPairSync("ed25519");
const now=Date.parse("2026-11-19T18:00:00.000Z");
function fixture(overrides={}) {
 const record={version:1,status:"COMMITTED_REMOTE_VERIFIED",run:randomUUID(),
  receiptSha256:"a".repeat(64),ciphertextObjects:690,
  coverage:{sqlite:3,postgres:1,r2:true,local:true},
  completedAt:new Date(now-60*60*1000).toISOString(),
  verifiedAt:new Date(now-30*60*1000).toISOString(),...overrides};
 const payload=JSON.stringify(record);
 return {payload,signature:sign(null,Buffer.from(payload),keys.privateKey).toString("base64"),
  verifierPublicKey:keys.publicKey,now};
}
test("valid signed, recent remote-verified completed snapshot passes",()=>{
 const result=evaluateBackupFreshness(fixture());
 assert.equal(result.ok,true);
 assert.equal(result.ageHours,1);
});
test("rejects unsigned, tampered and untrusted proof",()=>{
 const f=fixture();
 for(const bad of [{...f,signature:"AA=="},{...f,payload:f.payload+" "},
    {...f,verifierPublicKey:generateKeyPairSync("ed25519").publicKey}])
 assert.throws(()=>evaluateBackupFreshness(bad));
});
test("rejects stale, future and missing-store snapshots",()=>{
 for (const changes of [
  {completedAt:new Date(now-9*24*3600000).toISOString()},
  {verifiedAt:new Date(now-9*24*3600000).toISOString()},
  {completedAt:new Date(now+300000).toISOString()},
  {status:"RECEIVER_STARTED"},{coverage:{sqlite:3,postgres:1,r2:false,local:true}},
  {ciphertextObjects:0},{receiptSha256:"not-a-hash"}])
 assert.throws(()=>evaluateBackupFreshness(fixture(changes)));
});

test("weekly cadence has seven days, with one retry day grace",()=>{
 assert.equal(WEEKLY_HIDRIVE_INTERVAL_DAYS,7);
 assert.equal(WEEKLY_HIDRIVE_MAX_AGE_MS,8*24*60*60*1000);
 const recent=evaluateBackupFreshness(fixture({
  completedAt:new Date(now-7*24*3600000).toISOString(),
  verifiedAt:new Date(now-6*24*3600000).toISOString(),
 }));
 assert.equal(recent.schedule,"WEEKLY_HIDRIVE");
 assert.equal(recent.ageHours,168);
 assert.throws(()=>evaluateBackupFreshness(fixture({
  completedAt:new Date(now-8*24*3600000-1000).toISOString(),
  verifiedAt:new Date(now-8*24*3600000-1000).toISOString(),
 })),/BACKUP_STALE/);
});
