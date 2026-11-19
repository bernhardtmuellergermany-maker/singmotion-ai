import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, randomUUID } from "node:crypto";
import { evaluateBackupFreshness } from "../lib/ops/backup-freshness-policy.mjs";

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
  {completedAt:new Date(now-37*3600000).toISOString()},
  {verifiedAt:new Date(now-37*3600000).toISOString()},
  {completedAt:new Date(now+300000).toISOString()},
  {status:"RECEIVER_STARTED"},{coverage:{sqlite:3,postgres:1,r2:false,local:true}},
  {ciphertextObjects:0},{receiptSha256:"not-a-hash"}])
 assert.throws(()=>evaluateBackupFreshness(fixture(changes)));
});
