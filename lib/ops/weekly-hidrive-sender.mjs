/**
 * Production app-volume owner's weekly ciphertext exporter.
 * Always OFF unless explicitly permitted. No public route or cron on web service.
 * A durable O_EXCL weekly claim prevents duplicate runs after a restart.
 */
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { X509Certificate } from "node:crypto";
import { weeklyBackupSlot, weeklyBackupEnabled } from "./weekly-hidrive-schedule.mjs";
import { runProductionOffsiteOnce } from "./production-offsite-backup-sender.mjs";

const PROD = "36adc41d-7e54-4396-ad1a-fd432ba0441d";

export async function runApprovedWeeklyHiDriveOnce(env, {
  now=Date.now, sender=runProductionOffsiteOnce,
  claim=async filename=>writeFile(filename,"WEEKLY_HIDRIVE_ATTEMPT\n",{flag:"wx",mode:0o600}),
  log=(_marker)=>{}, warn=(_marker)=>{},
}={}) {
  let allowed;
  try { allowed=weeklyBackupEnabled(env); }
  catch { warn("WEEKLY_HIDRIVE_APPROVAL_REFUSED"); return {status:"refused"}; }
  if (!allowed) return {status:"disabled"};
  if (env.RAILWAY_ENVIRONMENT_ID!==PROD ||
      env.RAILWAY_SERVICE_NAME!=="singmotion-ai" ||
      env.DATA_DIR!=="/app/.data" ||
      env.BACKUP_RECOVERY_PRIVATE_KEY_B64 ||
      env.HIDRIVE_CLIENT_SECRET)
    return {status:"refused"};
  let fingerprint;
  try {
    const raw=Buffer.from(env.BACKUP_MTLS_WRITER_CERT_B64||"","base64");
    if(raw.length<100||raw.length>20000)throw Error("CERT_INVALID");
    fingerprint=new X509Certificate(raw).fingerprint256;
  }catch{warn("WEEKLY_HIDRIVE_CERT_INVALID");return {status:"refused"};}
  const slot=weeklyBackupSlot(now(),fingerprint);
  if (!slot.senderOpen) return {status:"not-due"};
  const claimFile=path.join(env.DATA_DIR,".weekly-hidrive-"+slot.sunday+".attempt");
  try { await claim(claimFile); }
  catch(e) {
    if(e?.code==="EEXIST")return {status:"already-attempted"};
    warn("WEEKLY_HIDRIVE_CLAIM_FAILED");
    return {status:"refused"};
  }
  log("WEEKLY_HIDRIVE_EXPORT_START");
  const effective={
    ...env,
    BACKUP_WEEKLY_EXECUTION_CONTEXT:"YES",
    PRODUCTION_OFFSITE_BACKUP_MODE:"SINGLE_ENCRYPTED_UPLOAD_V1",
    PRODUCTION_OFFSITE_BACKUP_APPROVED:"YES",
    PRODUCTION_OFFSITE_BACKUP_PG_ONLY:"",
    PRODUCTION_OFFSITE_BACKUP_RUN_ID:slot.run,
    PRODUCTION_OFFSITE_BACKUP_EXPIRES_AT:new Date(slot.expiresAt).toISOString(),
  };
  let result;
  try {
    result=await sender(effective,{
      log:(marker,summary)=>{
        if(marker==="PRODUCTION_OFFSITE_BACKUP_STAGE") {
          if(typeof summary==="string" && /^[A-Z_]{3,32}$/.test(summary))
            log("WEEKLY_HIDRIVE_"+summary);
        } else if (marker==="PRODUCTION_OFFSITE_BACKUP_COMMITTED") {
          log("WEEKLY_HIDRIVE_REMOTE_COMMITTED");
        }
      },
      warn:()=>warn("WEEKLY_HIDRIVE_EXPORT_FAILED"),
    });
  }catch{warn("WEEKLY_HIDRIVE_EXPORT_FAILED");return {status:"failed"};}
  if(result?.status!=="committed" ||
      result.summary?.run!==slot.run ||
      result.summary?.remoteReceiptCommitted!==true) {
    warn("WEEKLY_HIDRIVE_EXPORT_FAILED");
    return {status:"failed"};
  }
  log("WEEKLY_HIDRIVE_EXPORT_PASS");
  return {status:"committed", run:slot.run};
}
