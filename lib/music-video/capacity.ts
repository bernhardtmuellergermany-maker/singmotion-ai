import {PROJECT_VIDEO_MAX_MIB} from "./media-limits.ts";
import type {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";
import {statfsSync} from "node:fs";

const MiB=1024*1024;
export type OperationKind="song"|"video"|"export";
export class ProjectCapacityError extends Error {
 readonly status:number;
 constructor(message:string,status=429){super(message);this.status=status;}
}
function setting(env:Record<string,string|undefined>,key:string,fallback:number,max:number){
 const raw=env[key];if(raw===undefined||raw==="")return fallback;
 if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<1||Number(raw)>max)throw new ProjectCapacityError("Projects limits are incorrectly configured.",503);
 return Number(raw);
}
export function projectLimits(env:Record<string,string|undefined>=process.env){
 const n=(key:string,def:number,max:number)=>setting(env,"PROJECTS_"+key,def,max);
 return {customerBytes:n("CUSTOMER_STORAGE_MIB",5120,1048576)*MiB,
  projects:n("MAX_PROJECTS",20,1000),audioBytes:n("AUDIO_UPLOAD_MIB",70,70)*MiB,
  videoBytes:n("VIDEO_UPLOAD_MIB",PROJECT_VIDEO_MAX_MIB,PROJECT_VIDEO_MAX_MIB)*MiB,uploadsPerOwner:n("UPLOADS_PER_OWNER",2,20),
  uploadsGlobal:n("UPLOADS_GLOBAL",4,64),exportsPerOwner:n("EXPORTS_PER_OWNER",1,10),
  exportsGlobal:n("EXPORTS_GLOBAL",2,16),tempBytes:n("TEMP_RESERVATION_MIB",4096,65536)*MiB,
  exportClaim:n("EXPORT_RESERVATION_MIB",1536,32768)*MiB,
  minFreeBytes:n("MIN_FREE_MIB",512,32768)*MiB};
}
export type ProjectLimits=ReturnType<typeof projectLimits>;
/** Shared SQLite admission, not a filesystem quota. A lease lasts until the operation's
 * finally block releases it. Stale leases expire only after 24h; no short expiry
 * that permits a second operation while an ordinary render is still running.
 * All workers must share this same SQLite database/volume. */
export function reserveProjectOperation(db:DatabaseSync,root:string,owner:string,kind:OperationKind,mediaBytes:number,limits=projectLimits(),now=Date.now()){
 if(!Number.isSafeInteger(mediaBytes)||mediaBytes<0||(kind!=="export"&&mediaBytes<1))throw new ProjectCapacityError("Invalid reservation.",400);
 if((kind==="song"&&mediaBytes>limits.audioBytes)||(kind==="video"&&mediaBytes>limits.videoBytes))throw new ProjectCapacityError("File too large.",413);
 const cloudBytes=kind==="song"?mediaBytes+128*MiB:kind==="video"?mediaBytes:0;
 const tempBytes=kind==="export"?limits.exportClaim:mediaBytes*2+(kind==="song"?128:16)*MiB;
 const id=randomUUID();
 db.exec("CREATE TABLE IF NOT EXISTS music_operation_leases (id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,kind TEXT NOT NULL,cloud_bytes INTEGER NOT NULL,temp_bytes INTEGER NOT NULL,expires_at INTEGER NOT NULL)");
 db.exec("CREATE INDEX IF NOT EXISTS music_operation_leases_owner ON music_operation_leases(owner_id,kind)");
 db.exec("BEGIN IMMEDIATE");
 try{
  db.prepare("DELETE FROM music_operation_leases WHERE expires_at<=?").run(now);
  const totals=db.prepare("SELECT COALESCE(SUM(temp_bytes),0) AS temp,COALESCE(SUM(CASE WHEN kind='export' THEN 1 ELSE 0 END),0) AS exports,COALESCE(SUM(CASE WHEN kind!='export' THEN 1 ELSE 0 END),0) AS uploads FROM music_operation_leases").get() as {temp:number;exports:number;uploads:number};
  const own=db.prepare("SELECT COALESCE(SUM(cloud_bytes),0) AS cloud,COALESCE(SUM(CASE WHEN kind='song' THEN 1 ELSE 0 END),0) AS songs,COALESCE(SUM(CASE WHEN kind='export' THEN 1 ELSE 0 END),0) AS exports,COALESCE(SUM(CASE WHEN kind!='export' THEN 1 ELSE 0 END),0) AS uploads FROM music_operation_leases WHERE owner_id=?").get(owner) as {cloud:number;songs:number;exports:number;uploads:number};
  if(kind==="export"?totals.exports>=limits.exportsGlobal||own.exports>=limits.exportsPerOwner:totals.uploads>=limits.uploadsGlobal||own.uploads>=limits.uploadsPerOwner)throw new ProjectCapacityError("Too many concurrent Projects operations. Try again later.");
  if(kind==="song"&&owner.startsWith("customer:")){
   const count=db.prepare("SELECT COUNT(*) AS n FROM music_projects WHERE owner_id=?").get(owner) as {n:number};
   if(count.n+own.songs>=limits.projects)throw new ProjectCapacityError("Project limit reached.",409);
  }
  if(kind!=="export"&&owner.startsWith("customer:")){
   // Include pending deletes until cloud deletion succeeds. Existing unregistered
   // legacy files are not counted here; migrate them before customer rollout.
   const used=db.prepare("SELECT COALESCE(SUM(bytes),0) AS n FROM music_asset_cloud WHERE owner_id=?").get(owner) as {n:number};
   if(used.n+own.cloud+cloudBytes>limits.customerBytes)throw new ProjectCapacityError("Projects storage quota reached.",507);
  }
  const fs=statfsSync(root);
  if(totals.temp+tempBytes>limits.tempBytes||fs.bavail*fs.bsize-totals.temp-tempBytes<limits.minFreeBytes)throw new ProjectCapacityError("Temporary storage capacity low.",507);
  db.prepare("INSERT INTO music_operation_leases VALUES(?,?,?,?,?,?)").run(id,owner,kind,cloudBytes,tempBytes,now+24*60*60*1000);
  db.exec("COMMIT");
 }catch(e){db.exec("ROLLBACK");throw e;}
 let released=false;
 return ()=>{if(!released){db.prepare("DELETE FROM music_operation_leases WHERE id=?").run(id);released=true;}};
}
