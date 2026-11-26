import {DatabaseSync} from "node:sqlite";
import {existsSync,lstatSync,realpathSync} from "node:fs";
import path from "node:path";
import {deleteProjectVideo,projectR2Enabled,validProjectCloudRecord,type ProjectCloudRecord} from "./project-r2.ts";
type Row={owner_id:string;project_id:string;asset_id:string;object_key:string;sha256:string;bytes:number};
/** Only process explicit, durable user-authorized deletion manifests.
 * No bucket-wide deletion or filesystem traversal. An absent/inconsistent
 * ownership or reference state is retained for operator review. */
export async function retryProjectDeletes(root:string,options:{remove?:typeof deleteProjectVideo;env?:Record<string,string|undefined>;now?:number;owner?:string}={}){
 const env=options.env??process.env,summary={checked:0,deleted:0,deferred:0};
 if(!projectR2Enabled(env))return summary;
 const file=path.join(realpathSync(root),"music-video.sqlite");
 if(!existsSync(file))return summary;
 const info=lstatSync(file);
 if(!info.isFile()||info.isSymbolicLink()||realpathSync(file)!==file)throw Error("Invalid Projects database");
 const db=new DatabaseSync(file);
 try{
  db.exec("PRAGMA busy_timeout=5000");
  const has=(name:string)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  if(!has("music_asset_cloud")||!has("music_projects")||!has("music_assets")||!has("music_clips"))return summary;
  const leases=has("music_operation_leases")?" AND NOT EXISTS(SELECT 1 FROM music_operation_leases l WHERE l.owner_id=c.owner_id AND l.expires_at>?)":"";
  const sql="SELECT c.* FROM music_asset_cloud c WHERE c.pending_delete=1 AND NOT EXISTS(SELECT 1 FROM music_asset_cloud live WHERE live.object_key=c.object_key AND live.pending_delete=0) AND NOT EXISTS(SELECT 1 FROM music_assets a WHERE a.id=c.asset_id) AND NOT EXISTS(SELECT 1 FROM music_clips t WHERE t.asset_id=c.asset_id) AND NOT EXISTS(SELECT 1 FROM music_projects p WHERE p.id=c.project_id AND (p.owner_id!=c.owner_id OR c.asset_id LIKE '%:song%'))"+(options.owner===undefined?"":" AND c.owner_id=?")+leases+" ORDER BY c.asset_id LIMIT 2";
  const statement=db.prepare(sql);
  const params:(string|number)[]=[];if(options.owner!==undefined)params.push(options.owner);if(leases)params.push(options.now??Date.now());
  const rows=statement.all(...params) as Row[];
  for(const row of rows){
   summary.checked++;
   const record:ProjectCloudRecord={key:row.object_key,sha256:row.sha256,bytes:row.bytes};
   try{
    if(!validProjectCloudRecord(row.owner_id,row.project_id,row.asset_id,record,env))throw Error("Invalid deletion manifest");
    await (options.remove??deleteProjectVideo)(row.owner_id,row.project_id,row.asset_id,record);
    const deleted=db.prepare("DELETE FROM music_asset_cloud WHERE asset_id=? AND owner_id=? AND project_id=? AND object_key=? AND pending_delete=1").run(row.asset_id,row.owner_id,row.project_id,row.object_key);
    if(deleted.changes)summary.deleted++;
   }catch{summary.deferred++;}
  }
  return summary;
 }finally{db.close();}
}
