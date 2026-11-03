/** Verified local scratch hydration from owner-scoped R2 manifests.
 * The asset database remains authoritative for ownership and the exact local
 * private media destination; user-supplied paths/keys are never accepted.
 */
import {randomUUID} from "node:crypto";
import {constants} from "node:fs";
import {realpath,stat,writeFile,link,unlink,open} from "node:fs/promises";
import path from "node:path";
import type {Asset} from "./domain.ts";
import {db,dataDir} from "./db.ts";
import {customerR2Enabled,readMirroredPrivateSource,sourceAssetLimit,validCloudRecord,type CloudMediaRecord} from "./cloud-media.ts";

export async function ensureLocalAsset(asset:Asset):Promise<string>{
 const root=await realpath(path.join(dataDir,"media"));
 const destination=path.resolve(asset.path);
 if(!destination.startsWith(root+path.sep)||path.dirname(destination)!==root||
    !Number.isSafeInteger(asset.bytes)||asset.bytes<=0)
  throw Error("Invalid private local media path");
 try{
  const handle=await open(destination,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
   const info=await handle.stat();
   if(!info.isFile()||info.size!==asset.bytes)throw Error("Existing media failed size verification");
   return destination;
  }finally{await handle.close()}
 }catch(error){
  if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;
 }
 if(!customerR2Enabled())throw Error("Missing private media and cloud recovery disabled");
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cloud_source_media'").get())
  throw Error("No cloud asset manifest");
 const record=db.prepare("SELECT key,sha256,bytes FROM cloud_source_media WHERE asset_id=? AND owner=?").get(asset.id,asset.owner) as CloudMediaRecord|undefined;
 if(!record||!validCloudRecord(asset.owner,asset.id,record)||record.bytes!==asset.bytes)
  throw Error("Private cloud asset does not match owner or size");
 const bytes=await readMirroredPrivateSource(asset.owner,asset.id,record,sourceAssetLimit(asset.kind));
 const temporary=path.join(root,`.r2-hydrate-${randomUUID()}`);
 try{
  await writeFile(temporary,bytes,{mode:0o600,flag:"wx"});
  // No-overwrite hydration: on another worker's successful recovery,
  // verify that file rather than replacing it.
  try{
   await link(temporary,destination);
  }catch(e){
   if((e as NodeJS.ErrnoException).code!=="EEXIST")throw e;
  }
 }finally{await unlink(temporary).catch(()=>{})}
 const restored=await stat(destination);
 if(!restored.isFile()||restored.size!==record.bytes)
  throw Error("Hydrated private media has invalid size");
 return destination;
}
export async function ensureLocalMediaPath(owner:string,filename:string):Promise<void>{
 // Already present? The normal immutability checks validate the content.
 try{await stat(filename);return}catch(e){
  if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;
 }
 if(!customerR2Enabled())return;
 const root=path.resolve(dataDir,"media");
 const target=path.resolve(filename);
 if(path.dirname(target)!==root)throw Error("Private media path outside scratch");
 const rows=db.prepare("SELECT data FROM assets WHERE owner=?").all(owner) as {data:string}[];
 const asset=rows.map(r=>JSON.parse(r.data) as Asset).find(a=>path.resolve(a.path)===target);
 if(!asset)throw Error("No owner-scoped cloud record for missing media");
 await ensureLocalAsset(asset);
}
