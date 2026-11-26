/** Read-only storage accounting. No object listing, data deletion or cloud migration. */
import {DatabaseSync} from "node:sqlite";
import {existsSync,lstatSync,realpathSync,readdirSync,statfsSync} from "node:fs";
import path from "node:path";
const MiB=1024*1024;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export type ProjectStorage={audioBytes:number;videoBytes:number;otherBytes:number;totalBytes:number;projects:number;partial:boolean;cloudVideoBytes:number;cloudVideoObjects:number};
export type StorageOverview={projects:ProjectStorage;disk:{totalBytes:number;availableBytes:number};cloud:{sourceBytes:number;videoBytes:number;sourceObjects:number;videoObjects:number};trashPurgeEnabled:boolean};
const empty=():ProjectStorage=>({audioBytes:0,videoBytes:0,otherBytes:0,totalBytes:0,projects:0,partial:false,cloudVideoBytes:0,cloudVideoObjects:0});
function safeDirectory(folder:string):boolean{
 try{const s=lstatSync(folder);return s.isDirectory()&&!s.isSymbolicLink()&&realpathSync(folder)===folder;}catch{return false;}
}
function readOnly(root:string,name:string):DatabaseSync|null{
 const file=path.join(root,name);
 if(!existsSync(file))return null;
 const s=lstatSync(file);
 if(!s.isFile()||s.isSymbolicLink()||realpathSync(file)!==file)throw Error("Storage database unavailable");
 const db=new DatabaseSync(file,{readOnly:true});db.exec("PRAGMA busy_timeout=1000; PRAGMA query_only=ON;");return db;
}
export function projectStorage(root:string,owner?:string):ProjectStorage{
 root=realpathSync(root);const result=empty(),db=readOnly(root,"music-video.sqlite");
 if(!db)return result;
 const folder=path.join(root,"music-video");
 try{
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='music_asset_cloud'").get()){
   const q="SELECT COALESCE(SUM(bytes),0) AS bytes,COUNT(*) AS count FROM music_asset_cloud WHERE pending_delete=0"+(owner===undefined?"":" AND owner_id=?");
   const row=(owner===undefined?db.prepare(q).get():db.prepare(q).get(owner)) as {bytes:number;count:number};
   result.cloudVideoBytes=row.bytes;result.cloudVideoObjects=row.count;
  }
  const query=owner===undefined?"SELECT id FROM music_projects ORDER BY id LIMIT 1001":"SELECT id FROM music_projects WHERE owner_id=? ORDER BY id LIMIT 1001";
  const ids=(owner===undefined?db.prepare(query).all():db.prepare(query).all(owner)) as {id:string}[];
  result.projects=ids.length;result.partial=ids.length>1000;
  if(!safeDirectory(folder)){result.partial=result.partial||ids.length>0;return result;}
  let remaining=10000;
  for(const {id} of ids.slice(0,1000)){
   if(!uuid.test(id)){result.partial=true;continue;}
   const dir=path.join(folder,id);
   if(!safeDirectory(dir)){result.partial=true;continue;}
   try{
    for(const entry of readdirSync(dir,{withFileTypes:true})){
     if(--remaining<0){result.partial=true;break;}
     if(!entry.isFile()||entry.isSymbolicLink()){result.partial=true;continue;}
     const name=entry.name,s=lstatSync(path.join(dir,name));
     if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||!Number.isSafeInteger(s.size)){result.partial=true;continue;}
     if(/^song(?:-original)?\.(?:mp3|wav|m4a)$/i.test(name))result.audioBytes+=s.size;
     else if(/^[a-f0-9-]{36}\.(?:mp4|webm)$/i.test(name))result.videoBytes+=s.size;
     else result.otherBytes+=s.size;
    }
   }catch{result.partial=true;}
   if(remaining<0)break;
  }
  result.totalBytes=result.audioBytes+result.videoBytes+result.otherBytes;return result;
 }finally{db.close();}
}
export function storageCapacity(root:string){
 const fs=statfsSync(root);
 const totalBytes=fs.blocks*fs.bsize,availableBytes=fs.bavail*fs.bsize;
 if(!Number.isSafeInteger(totalBytes)||!Number.isSafeInteger(availableBytes)||totalBytes<=0||availableBytes<0||availableBytes>totalBytes)throw Error("Capacity unavailable");
 return {totalBytes,availableBytes};
}
function manifests(root:string,file:string,table:"cloud_source_media"|"cloud_paid_videos"){
 const db=readOnly(root,file);if(!db)return {bytes:0,count:0};
 try{
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))return {bytes:0,count:0};
  const row=db.prepare("SELECT COALESCE(SUM(bytes),0) AS bytes,COUNT(*) AS count FROM "+table+" WHERE typeof(bytes)='integer' AND bytes>0").get() as {bytes:number;count:number};
  return row;
 }finally{db.close();}
}
export function storageOverview(root:string):StorageOverview{
 root=realpathSync(root);
 const sources=manifests(root,"demo.sqlite","cloud_source_media"),videos=manifests(root,"commerce.sqlite","cloud_paid_videos");
 return {projects:projectStorage(root),disk:storageCapacity(root),cloud:{sourceBytes:sources.bytes,sourceObjects:sources.count,videoBytes:videos.bytes,videoObjects:videos.count},trashPurgeEnabled:process.env.PROJECT_TRASH_PURGE_ENABLED==="true"};
}
// Conservative process-local reservations. Other workers may also use the volume;
// this is a guardrail, not a filesystem quota or a guarantee of available space.
let reserved=0;
export function reserveProjectUpload(root:string,bytes:number,kind:"audio"|"video"){
 if(!Number.isSafeInteger(bytes)||bytes<=0)throw Error("Invalid upload size");
 const claim=bytes*2+(kind==="audio"?128:16)*MiB;
 if(storageCapacity(root).availableBytes-reserved-claim<512*MiB)throw Error("Storage capacity low");
 reserved+=claim;let released=false;
 return ()=>{if(!released){released=true;reserved-=claim;}};
}
