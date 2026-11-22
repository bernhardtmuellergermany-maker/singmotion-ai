import test from "node:test";
import assert from "node:assert/strict";
import {
  WEEKLY_RECEIVER_CRON_UTC, WEEKLY_HIDRIVE_MAX_PLAINTEXT,
  weeklyBackupSlot, weeklyBackupEnabled,
} from "../lib/ops/weekly-hidrive-schedule.mjs";
const fingerprint=Array.from({length:32},()=> "AB").join(":");
const t=(day,hour,minute)=> Date.UTC(2026,10,day,hour,minute);

test("both workers independently bind exact same UTC Sunday and RFC UUID",()=>{
  const receiver=weeklyBackupSlot(t(22,3,0),fingerprint);
  const sender=weeklyBackupSlot(t(22,3,10),fingerprint);
  assert.equal(receiver.run,sender.run);
  assert.match(receiver.run,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(receiver.receiverOpen,true);
  assert.equal(receiver.senderOpen,false);
  assert.equal(sender.receiverOpen,true);
  assert.equal(sender.senderOpen,true);
  assert.equal(sender.sunday,"2026-11-22");
  assert.equal(new Date(sender.expiresAt).toISOString(),"2026-11-22T05:00:00.000Z");
});

test("strict Sunday window and weekly rollover",()=>{
  assert.equal(weeklyBackupSlot(t(22,2,59),fingerprint).receiverOpen,false);
  assert.equal(weeklyBackupSlot(t(22,3,9),fingerprint).senderOpen,false);
  assert.equal(weeklyBackupSlot(t(22,3,19),fingerprint).senderOpen,true);
  assert.equal(weeklyBackupSlot(t(22,3,20),fingerprint).senderOpen,false);
  assert.equal(weeklyBackupSlot(t(22,5,0),fingerprint).receiverOpen,false);
  assert.equal(weeklyBackupSlot(t(23,3,10),fingerprint).senderOpen,false);
  assert.notEqual(weeklyBackupSlot(t(22,3,10),fingerprint).run,
     weeklyBackupSlot(t(29,3,10),fingerprint).run);
});

test("every weekly transfer requires explicit opt-in and hard 2 GiB cap",()=>{
  assert.equal(WEEKLY_RECEIVER_CRON_UTC,"0 3 * * 0");
  assert.equal(WEEKLY_HIDRIVE_MAX_PLAINTEXT,2147483648);
  const env={BACKUP_WEEKLY_HIDRIVE_APPROVED:"YES",BACKUP_WEEKLY_HIDRIVE_MAX_BYTES:"2147483648",
    BACKUP_MODE:"PRODUCTION_WEEKLY_CIPHERTEXT_RECEIVER",
    PRODUCTION_WEEKLY_HIDRIVE_ENABLED:"YES"};
  assert.equal(weeklyBackupEnabled(env),true);
  assert.equal(weeklyBackupEnabled(env,true),true);
  assert.equal(weeklyBackupEnabled({...env,BACKUP_WEEKLY_HIDRIVE_APPROVED:"NO"}),false);
  assert.throws(()=>weeklyBackupEnabled({...env,BACKUP_WEEKLY_HIDRIVE_MAX_BYTES:"99999999"}),/WEEKLY_TRANSFER_BUDGET_REQUIRED/);
  assert.throws(()=>weeklyBackupEnabled({...env,BACKUP_MODE:"SETUP_ONLY_NO_DATA_TRANSFER"},true),/WEEKLY_RECEIVER_MODE_REFUSED/);
});

test("reject malformed fingerprints before any transfer",()=>{
  assert.throws(()=>weeklyBackupSlot(t(22,3,10),"not a valid fingerprint"),/WEEKLY_BACKUP_SLOT_INVALID/);
  assert.throws(()=>weeklyBackupSlot(NaN,fingerprint),/WEEKLY_BACKUP_SLOT_INVALID/);
});
