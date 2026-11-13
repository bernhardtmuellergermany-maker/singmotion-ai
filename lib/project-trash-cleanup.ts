/** Fail-closed physical cleanup of expired customer-owned draft and private Studio media.
 * Deleting a UI project never deletes Stripe, invoices, payment/credit ledgers,
 * provider task evidence or another project's shared assets. This job executes
 * on the persistent volume, in small bounded batches, from the same app worker.
 */
import {DatabaseSync} from "node:sqlite";
import {existsSync} from "node:fs";
import {lstat,realpath,unlink,readdir} from "node:fs/promises";
import path from "node:path";
import {deleteMirroredPrivateSource,type CloudMediaRecord} from "./cloud-media.ts";
import {ensureDraftTrash,ensureLiveTrash,PROJECT_TRASH_MS} from "./project-trash.ts";
import type {Asset} from "./domain.ts";

type Candidate={id:string;owner:string;selection:string;deleted_at:number;kind:"draft"|"live"};
type Options={now?:number;limit?:number;deleteCloud?:(owner:string,id:string,row:CloudMediaRecord)=>Promise<void>};
const validId=(v:string)=>/^[A-Za-z0-9_-]{1,180}$/.test(v);
const table=(db:DatabaseSync|null,name:string)=>!!db?.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
const referenced=(db:DatabaseSync,sql:string,...args:(string|number)[])=>
 !!db.prepare(sql).get(...args);
const selectionAssetIds=(json:string):string[]=>{
 const v=JSON.parse(json) as {songId?:unknown;imageId?:unknown;sourceImageId?:unknown;editedImageId?:unknown};
 return [...new Set([v.songId,v.imageId,v.sourceImageId,v.editedImageId]
   .filter((id):id is string=>typeof id==="string"&&validId(id)))];
};
async function removeOwnedLocal(root:string,filename:string,base:string){
 const dir=await realpath(path.join(root,base)).catch(()=>null);
 if(!dir)throw Error("Storage directory unavailable");
 const expected=path.join(dir,filename);
 const resolved=path.resolve(expected);
 if(path.dirname(resolved)!==dir)throw Error("Unexpected media path");
 const info=await lstat(resolved).catch((e:NodeJS.ErrnoException)=>{
  if(e.code==="ENOENT")return null;throw e;
 });
 if(!info)return;
 if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)
   throw Error("Unverified media file; manual reconciliation needed");
 await unlink(resolved);
}
function otherReference(demo:DatabaseSync,live:DatabaseSync|null,commerce:DatabaseSync|null,
 owner:string,id:string,excluding:Candidate):boolean{
 const like="%"+id+"%";
 if(referenced(demo,"SELECT 1 FROM studio_drafts WHERE owner=? AND id<>? AND selection LIKE ? LIMIT 1",
   owner,excluding.kind==="draft"?excluding.id:"",like))return true;
 if(table(demo,"jobs")&&referenced(demo,"SELECT 1 FROM jobs WHERE owner=? AND data LIKE ? LIMIT 1",owner,like))return true;
 if(table(demo,"artists")&&referenced(demo,"SELECT 1 FROM artists WHERE owner=? AND data LIKE ? LIMIT 1",owner,like))return true;
 if(live&&table(live,"live_studio_projects")&&referenced(live,
   "SELECT 1 FROM live_studio_projects WHERE owner=? AND attempt_id<>? AND selection_json LIKE ? LIMIT 1",
   owner,excluding.kind==="live"?excluding.id:"",like))return true;
 // An unresolved provider attempt may need its inputs even when removed from
 // the gallery. Terminal audited attempts are retained without holding raw files.
 if(live&&table(live,"live_attempts")&&referenced(live,
   "SELECT 1 FROM live_attempts WHERE id<>? AND data LIKE ? AND (json_extract(data,'$.state') IS NULL OR json_extract(data,'$.state') NOT IN ('completed','failed','prepared')) LIMIT 1",
   excluding.kind==="live"?excluding.id:"",like))return true;
 // Never garbage-collect input data linked to a paid customer order, even
 // if that order is hidden. Financial/legal retention has a separate policy.
 if(owner.startsWith("customer-")&&!commerce)return true;
 if(commerce){
  if(table(commerce,"customer_prepared_media")&&referenced(commerce,
    "SELECT 1 FROM customer_prepared_media WHERE media_json LIKE ? LIMIT 1",like))return true;
  if(table(commerce,"customer_video_deliveries")&&referenced(commerce,
    "SELECT 1 FROM customer_video_deliveries WHERE asset_id=? LIMIT 1",id))return true;
  if(excluding.kind==="draft"&&table(commerce,"customer_orders")&&referenced(commerce,
    "SELECT 1 FROM customer_orders WHERE project_id=? LIMIT 1",excluding.id))return true;
 }
 return false;
}
/** Returns only aggregate counts; no filenames/IDs or R2 keys in logs. */
export async function runProjectTrashCleanup(root:string,options:Options={}){
 const now=options.now??Date.now();
 const bound=Math.min(Math.max(1,options.limit??8),25);
 const result={draftsPurged:0,studioPurged:0,assetsDeleted:0,bytesFreed:0,held:0};
 const demoFile=path.join(root,"demo.sqlite"),liveFile=path.join(root,"live-test.sqlite"),
  commerceFile=path.join(root,"commerce.sqlite");
 if(!existsSync(demoFile))return result;
 const demo=new DatabaseSync(demoFile);
 const live=existsSync(liveFile)?new DatabaseSync(liveFile):null;
 const commerce=existsSync(commerceFile)?new DatabaseSync(commerceFile,{readOnly:true}):null;
 try{
  demo.exec("PRAGMA busy_timeout=5000");
  ensureDraftTrash(demo);
  if(live)ensureLiveTrash(live);
  const draftRows=demo.prepare("SELECT id,owner,selection,deleted_at FROM studio_drafts WHERE deleted_at IS NOT NULL AND deleted_at<=? ORDER BY deleted_at ASC LIMIT ?")
    .all(now-PROJECT_TRASH_MS,bound) as Array<{id:string;owner:string;selection:string;deleted_at:number}>;
  const liveRows=live&&table(live,"live_studio_projects")?
   live.prepare("SELECT attempt_id AS id,owner,selection_json AS selection,deleted_at FROM live_studio_projects WHERE deleted_at IS NOT NULL AND deleted_at<=? ORDER BY deleted_at ASC LIMIT ?")
    .all(now-PROJECT_TRASH_MS,bound) as Array<{id:string;owner:string;selection:string;deleted_at:number}>:[];
  const candidates:Candidate[]=[
   ...draftRows.map(row=>({...row,kind:"draft" as const})),
   ...liveRows.map(row=>({...row,kind:"live" as const}))].slice(0,bound);
  const deleteCloud=options.deleteCloud??deleteMirroredPrivateSource;
  for(const candidate of candidates){
   try{
    if(!candidate.owner||!validId(candidate.id))throw Error("Invalid tombstone");
    if(candidate.kind==="live"){
     const attempt=live?.prepare("SELECT data FROM live_attempts WHERE id=?").get(candidate.id) as {data:string}|undefined;
     if(!attempt)throw Error("Missing provider evidence");
     const record=JSON.parse(attempt.data) as {state:string;outputPath?:string|null};
     if(!["prepared","completed","failed"].includes(record.state))
       throw Error("Provider still active or unknown");
     // BytePlus private R2 input objects are separate from uploaded source
     // media. Purge only exact, owner-bound manifest keys after both TTL and
     // grace; missing credentials or ambiguous delivery leaves the tombstone
     // for retry without removing the original media or financial evidence.
     if(table(live,"live_input_deliveries")){
       const delivery=live!.prepare("SELECT state FROM live_input_deliveries WHERE attempt_id=?")
         .get(candidate.id) as {state:string}|undefined;
       if(delivery&&delivery.state!=="cleaned"){
         const {LiveTestStore}=await import("./live/store.ts");
         const {R2PrivateInputDelivery}=await import("./live/r2.ts");
         const store=new LiveTestStore(liveFile);
         try{
           const r2=new R2PrivateInputDelivery(store,root);
           try{await r2.cleanupExpired(candidate.id,new AbortController().signal)}
           finally{r2.close()}
         }finally{store.close()}
       }
     }
     if(record.outputPath){
      const liveDir=await realpath(path.join(root,"live-output")).catch(()=>null);
      if(!liveDir||path.dirname(path.resolve(record.outputPath))!==liveDir)
       throw Error("Output path outside private output directory");
      const filename=path.basename(record.outputPath);
      if(!filename.endsWith(".mp4"))throw Error("Unexpected output file");
      await removeOwnedLocal(root,filename,"live-output");
     }
     // A completed tempo-restoration can also retain an intermediate provider
     // MP4. Stale lease-bound partials may remain after an interrupted worker.
     // Only exact files belonging to this expired, terminal project qualify.
     const outputFolder=path.join(root,"live-output");
     const leftovers=await readdir(outputFolder).catch((e:NodeJS.ErrnoException)=>{
       if(e.code==="ENOENT")return [] as string[];
       throw e;
     });
     if(leftovers.length)
       await removeOwnedLocal(root,candidate.id+".provider-source.mp4","live-output");
     for(const filename of leftovers){
       const prefix=candidate.id+".";
       if(filename.startsWith(prefix)&&filename.endsWith(".partial.mp4")&&
          /^[A-Za-z0-9_-]{8,128}$/.test(filename.slice(prefix.length,-".partial.mp4".length)))
         await removeOwnedLocal(root,filename,"live-output");
     }
    }
    const ids=selectionAssetIds(candidate.selection);
    for(const id of ids){
     const row=demo.prepare("SELECT data FROM assets WHERE id=? AND owner=?").get(id,candidate.owner) as {data:string}|undefined;
     if(!row||otherReference(demo,live,commerce,candidate.owner,id,candidate))continue;
     const asset=JSON.parse(row.data) as Asset;
     if(asset.id!==id||asset.owner!==candidate.owner||!["audio","image"].includes(asset.kind)||
        asset.path!==path.join(root,"media",id)||!Number.isSafeInteger(asset.bytes))
       throw Error("Unverified media asset path or type");
     const cloud=table(demo,"cloud_source_media")?
      demo.prepare("SELECT key,sha256,bytes FROM cloud_source_media WHERE asset_id=? AND owner=?").get(id,candidate.owner) as CloudMediaRecord|undefined:undefined;
     if(cloud)await deleteCloud(candidate.owner,id,cloud);
     await removeOwnedLocal(root,id,"media");
     await removeOwnedLocal(root,id+".preview.mp3","media");
     demo.exec("BEGIN IMMEDIATE");
     try{
      if(cloud)demo.prepare("DELETE FROM cloud_source_media WHERE asset_id=? AND owner=?").run(id,candidate.owner);
      demo.prepare("DELETE FROM assets WHERE id=? AND owner=?").run(id,candidate.owner);
      demo.exec("COMMIT");
     }catch(e){demo.exec("ROLLBACK");throw e}
     result.assetsDeleted++;
     result.bytesFreed+=asset.bytes;
    }
    if(candidate.kind==="draft"){
     const removed=demo.prepare("DELETE FROM studio_drafts WHERE id=? AND owner=? AND deleted_at=?")
       .run(candidate.id,candidate.owner,candidate.deleted_at);
     if(Number(removed.changes)===1)result.draftsPurged++;
    }else{
     const removed=live!.prepare("DELETE FROM live_studio_projects WHERE attempt_id=? AND owner=? AND deleted_at=?")
       .run(candidate.id,candidate.owner,candidate.deleted_at);
     if(Number(removed.changes)===1)result.studioPurged++;
    }
   }catch{result.held++}
  }
  return result;
 }finally{demo.close();live?.close();commerce?.close()}
}
