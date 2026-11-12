/** Limits uploaded source assets, not the number of video projects or purchases.
 * Paid output files are excluded and must be retained under the delivery policy.
 */
import {DatabaseSync} from "node:sqlite";
import type {Asset} from "./domain.ts";
import {AppError} from "./domain.ts";
import {PLAN_RULES, type PlanCode} from "./commerce/plans.ts";
import {validCloudRecord, type CloudMediaRecord} from "./cloud-media.ts";

export const GUEST_UPLOAD_STORAGE_BYTES=250*1024*1024;
export function uploadStorageLimit(plan:PlanCode|"guest"):number{
 return plan==="guest"?GUEST_UPLOAD_STORAGE_BYTES:PLAN_RULES[plan].uploadStorageBytes;
}
function ensureReservations(db:DatabaseSync){
 db.exec("CREATE TABLE IF NOT EXISTS pending_upload_storage (id TEXT PRIMARY KEY, owner TEXT NOT NULL, bytes INTEGER NOT NULL CHECK(bytes>0), created INTEGER NOT NULL)");
}
export function uploadedBytes(db:DatabaseSync,owner:string):number{
 const row=db.prepare("SELECT COALESCE(SUM(CAST(json_extract(data, '$.bytes') AS INTEGER)),0) AS total FROM assets WHERE owner=? AND json_extract(data, '$.kind') IN ('audio','image') AND json_extract(data, '$.path') LIKE '%/' || id").get(owner) as {total:number};
 return row.total;
}
/** Take a brief SQLite write lock to avoid parallel uploads passing the same budget. */
export function reserveUploadStorage(db:DatabaseSync,owner:string,id:string,bytes:number,limitBytes:number,now=Date.now()):void{
 if(!/^[a-f0-9-]{36}$/.test(id)||!Number.isSafeInteger(bytes)||bytes<=0||
    !Number.isSafeInteger(limitBytes)||limitBytes<=0)throw new AppError("Invalid upload reservation.",400);
 ensureReservations(db);
 db.exec("BEGIN IMMEDIATE");
 try{
  // Incomplete uploads older than one hour cannot permanently occupy quota;
  // UUIDs and write-file wx mode prevent stale attempts from being reused.
  db.prepare("DELETE FROM pending_upload_storage WHERE created<?").run(now-3600000);
  const pending=db.prepare("SELECT COALESCE(SUM(bytes),0) AS total FROM pending_upload_storage WHERE owner=?").get(owner) as {total:number};
  if(uploadedBytes(db,owner)+pending.total+bytes>limitBytes)
   throw new AppError(`Upload limit reached for your audio and photos (${Math.round(limitBytes/(1024*1024))} MB). Cloudflare storage does not remove this account limit. Existing videos remain available. Contact support to review storage or unused uploads.`,413);
  db.prepare("INSERT INTO pending_upload_storage(id,owner,bytes,created) VALUES(?,?,?,?)").run(id,owner,bytes,now);
  db.exec("COMMIT");
 }catch(e){db.exec("ROLLBACK");throw e;}
}
export function commitUploadedAsset(db:DatabaseSync,a:Asset,cloud:CloudMediaRecord|null=null):void{
 ensureReservations(db);
 db.exec("BEGIN IMMEDIATE");
 try{
  const reservation=db.prepare("SELECT bytes FROM pending_upload_storage WHERE id=? AND owner=?").get(a.id,a.owner) as {bytes:number}|undefined;
  if(!reservation||reservation.bytes!==a.bytes)throw new AppError("Upload reservation missing or expired.",409);
  if(cloud){
   if(!validCloudRecord(a.owner,a.id,cloud)||cloud.bytes!==a.bytes)
    throw new AppError("Cloud storage manifest mismatch.",409);
   db.exec("CREATE TABLE IF NOT EXISTS cloud_source_media(asset_id TEXT PRIMARY KEY,owner TEXT NOT NULL,key TEXT UNIQUE NOT NULL,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,created INTEGER NOT NULL)");
   db.prepare("INSERT INTO cloud_source_media(asset_id,owner,key,sha256,bytes,created) VALUES(?,?,?,?,?,?)").run(a.id,a.owner,cloud.key,cloud.sha256,cloud.bytes,Date.now());
  }
  db.prepare("INSERT INTO assets VALUES(?,?,?)").run(a.id,a.owner,JSON.stringify(a));
  db.prepare("DELETE FROM pending_upload_storage WHERE id=? AND owner=?").run(a.id,a.owner);
  db.exec("COMMIT");
 }catch(e){db.exec("ROLLBACK");throw e}
}
export function releaseUploadStorage(db:DatabaseSync,owner:string,id:string):void{
 ensureReservations(db);
 db.prepare("DELETE FROM pending_upload_storage WHERE id=? AND owner=?").run(id,owner);
}
