/** Account source uploads use private R2; no cumulative Free/Hobby/guest quota.
 * Still track pending files so uploads can be committed atomically, and report
 * real usage to the customer. Per-file size and request-rate limits remain.
 */
import {DatabaseSync} from "node:sqlite";
import type {Asset} from "./domain.ts";
import {AppError} from "./domain.ts";
import {validCloudRecord, type CloudMediaRecord} from "./cloud-media.ts";

function ensureReservations(db:DatabaseSync){
 db.exec("CREATE TABLE IF NOT EXISTS pending_upload_storage (id TEXT PRIMARY KEY, owner TEXT NOT NULL, bytes INTEGER NOT NULL CHECK(bytes>0), created INTEGER NOT NULL)");
}
export function uploadedBytes(db:DatabaseSync,owner:string):number{
 const row=db.prepare("SELECT COALESCE(SUM(CAST(json_extract(data, '$.bytes') AS INTEGER)),0) AS total FROM assets WHERE owner=? AND json_extract(data, '$.kind') IN ('audio','image') AND json_extract(data, '$.path') LIKE '%/' || id").get(owner) as {total:number};
 return row.total;
}
/** Atomically mark an individual validated upload as pending.
 * Only per-file and request-rate limits apply; historical account totals do
 * not block new uploads. The private R2 upload must pass SHA-256 readback
 * before commitUploadedAsset can publish the source asset.
 */
/** Real-time free disk plus reserved in-flight scratch for an R2 upload.
 * The estimate is checked while holding SQLite's IMMEDIATE write lock so
 * concurrent requests cannot each claim the same remaining headroom.
 */
export type UploadScratchBudget={
 availableBytes:number;
 minimumFreeBytes:number;
 extraBytesPerUpload:number;
};
export function reserveUploadStorage(
 db:DatabaseSync,owner:string,id:string,bytes:number,now=Date.now(),
 scratch?:UploadScratchBudget,
):void{
 if(!/^[a-f0-9-]{36}$/.test(id)||!Number.isSafeInteger(bytes)||bytes<=0||
    bytes>50*1024*1024||typeof owner!=="string"||owner.length<1)
  throw new AppError("Invalid upload reservation or file size.",400);
 ensureReservations(db);
 db.exec("BEGIN IMMEDIATE");
 try{
  db.prepare("DELETE FROM pending_upload_storage WHERE created<?").run(now-3600000);
  if(scratch){
   const {availableBytes,minimumFreeBytes,extraBytesPerUpload}=scratch;
   if(![availableBytes,minimumFreeBytes,extraBytesPerUpload].every(Number.isSafeInteger)||
      availableBytes<0||minimumFreeBytes<=0||extraBytesPerUpload<0)
    throw new AppError("Upload storage capacity could not be verified.",507);
   const pending=db.prepare(
    "SELECT COALESCE(SUM(bytes),0) AS bytes,COUNT(*) AS count FROM pending_upload_storage"
   ).get() as {bytes:number;count:number};
   // Files already written to disk may be counted twice: intentionally
   // conservative while uploads and MP3 previews are in flight.
   const budget=availableBytes-minimumFreeBytes-
    pending.bytes-pending.count*extraBytesPerUpload-
    bytes-extraBytesPerUpload;
   if(budget<0)
    throw new AppError("Upload storage temporarily unavailable: server capacity is low. Existing videos and files are safe.",507);
  }
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
