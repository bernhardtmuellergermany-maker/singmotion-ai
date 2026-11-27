/** Frozen-account cleanup for the separately stored experimental Projects library.
 * Only exact owner-scoped manifests are deleted. Keep durable rows until R2 and
 * local removal succeed, so an interrupted erasure can safely retry.
 */
import {DatabaseSync} from "node:sqlite";
import {existsSync,lstatSync,realpathSync} from "node:fs";
import {rm} from "node:fs/promises";
import path from "node:path";
import {deleteProjectVideo,validProjectCloudRecord,projectR2Enabled} from "./project-r2.ts";
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Row={project_id:string;asset_id:string;owner_id:string;object_key:string;sha256:string;bytes:number};
function ownerFor(id:string){if(!uuid.test(id))throw Error("Invalid Projects account");return "customer:"+id}
function openProjects(root:string,readOnly=false){
 const base=realpathSync(root),file=path.join(base,"music-video.sqlite");
 if(!existsSync(file))return null;
 const info=lstatSync(file);
 if(!info.isFile()||info.isSymbolicLink()||realpathSync(file)!==file)throw Error("Invalid Projects database");
 const db=new DatabaseSync(file,{readOnly});
 db.exec("PRAGMA busy_timeout=5000");
 return db;
}
function inventory(db:DatabaseSync,owner:string){
 const projects=(db.prepare("SELECT id FROM music_projects WHERE owner_id=?").all(owner) as {id:string}[]).map(row=>row.id);
 const objects=db.prepare("SELECT * FROM music_asset_cloud WHERE owner_id=?").all(owner) as Row[];
 const ids=[...new Set([...projects,...objects.map(o=>o.project_id)])];
 for(const id of ids){
  if(!uuid.test(id))throw Error("Invalid Projects ID");
  const other=db.prepare("SELECT owner_id FROM music_projects WHERE id=?").get(id) as {owner_id:string}|undefined;
  if(other&&other.owner_id!==owner)throw Error("Projects ownership mismatch");
  if(db.prepare("SELECT 1 FROM music_asset_cloud WHERE project_id=? AND owner_id<>? LIMIT 1").get(id,owner))throw Error("Projects manifest ownership mismatch");
 }
 const leases=!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='music_operation_leases'").get()&&
  !!db.prepare("SELECT 1 FROM music_operation_leases WHERE owner_id=? AND expires_at>? LIMIT 1").get(owner,Date.now());
 return {projects,objects,ids,leases};
}
export function customerProjectsErasureInventory(root:string,id:string){
 const owner=ownerFor(id),db=openProjects(root,true);
 if(!db)return {musicProjects:0,musicProjectCloudObjects:0};
 try{const v=inventory(db,owner);return {musicProjects:v.projects.length,musicProjectCloudObjects:v.objects.length};}
 finally{db.close()}
}
export async function eraseCustomerProjects(root:string,id:string,options:{env?:Record<string,string|undefined>;remove?:typeof deleteProjectVideo}={}){
 const owner=ownerFor(id),db=openProjects(root);
 if(!db)return;
 try{
  const v=inventory(db,owner),env=options.env??process.env;
  if(v.leases)throw Error("ACTIVE_PROJECT_OPERATION");
  if(v.objects.length&&!projectR2Enabled(env))throw Error("Projects cloud cleanup unavailable");
  for(const row of v.objects)if(!validProjectCloudRecord(owner,row.project_id,row.asset_id,{key:row.object_key,sha256:row.sha256,bytes:row.bytes},env))
   throw Error("Unverified Projects manifest");
  const base=path.join(realpathSync(root),"music-video");
  const dirs:string[]=[];
  if(existsSync(base)){
   if(!lstatSync(base).isDirectory()||realpathSync(base)!==base)throw Error("Invalid Projects folder");
   for(const project of v.ids){const folder=path.join(base,project);
    if(existsSync(folder)){if(!lstatSync(folder).isDirectory()||realpathSync(folder)!==folder)throw Error("Invalid Projects owner folder");dirs.push(folder);}
   }
  }
  for(const row of v.objects)await (options.remove??deleteProjectVideo)(owner,row.project_id,row.asset_id,{key:row.object_key,sha256:row.sha256,bytes:row.bytes});
  for(const folder of dirs)await rm(folder,{recursive:true,force:true});
  db.exec("BEGIN IMMEDIATE");
  try{
   const current=inventory(db,owner);
   if(current.leases||JSON.stringify(current.projects.sort())!==JSON.stringify(v.projects.sort())||
      JSON.stringify(current.objects.map(o=>o.object_key).sort())!==JSON.stringify(v.objects.map(o=>o.object_key).sort()))throw Error("Projects changed during erasure");
   for(const project of v.projects){
    db.prepare("DELETE FROM music_clips WHERE project_id=?").run(project);
    db.prepare("DELETE FROM music_assets WHERE project_id=?").run(project);
    db.prepare("DELETE FROM music_projects WHERE id=? AND owner_id=?").run(project,owner);
   }
   db.prepare("DELETE FROM music_asset_cloud WHERE owner_id=?").run(owner);
   if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='music_operation_leases'").get())db.prepare("DELETE FROM music_operation_leases WHERE owner_id=?").run(owner);
   db.exec("COMMIT");
  }catch(e){db.exec("ROLLBACK");throw e;}
 }finally{db.close();}
}
