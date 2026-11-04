/** Explicit, repeatable staging-only migration of ALL private test media.
 * Run on a mounted volume before the web server starts. Does not submit any
 * provider task, issue payments, delete local files, or change ownership.
 * Stops at the first uncertainty; a rerun verifies existing remote objects.
 */
import {existsSync} from "node:fs";
import {realpath,stat} from "node:fs/promises";
import path from "node:path";
import {db,dataDir} from "../lib/db.ts";
import type {Asset} from "../lib/domain.ts";
import {customerR2Enabled,mirrorPrivateSource,readMirroredPrivateSource,validCloudRecord,sourceAssetLimit,type CloudMediaRecord} from "../lib/cloud-media.ts";
import {mirrorPrivatePaidVideo,validPaidCloudRecord,paidR2ByteRange,type CloudPaidVideoRecord} from "../lib/cloud-paid-video.ts";
import {CommerceStore} from "../lib/commerce/store.ts";
import {createHash} from "node:crypto";

const STAGING_ENV="dfaeabed-03df-43ed-aa71-50f343a75041";
const PRODUCTION_ENV="36adc41d-7e54-4396-ad1a-fd432ba0441d";
/** Migration is a separate, explicit operator act. Launch approval by itself
 * never initiates migration, and no Staging approval carries into Production.
 */
export function allowPrivateMediaMigration(env:Record<string,string|undefined>):boolean{
 const id=env.RAILWAY_ENVIRONMENT_ID;
 const staging=id===STAGING_ENV;
 const production=id===PRODUCTION_ENV;
 return env.R2_MIGRATE_TEST_DATA==="true" &&
   env.CUSTOMER_R2_STORAGE_ENABLED==="true" &&
   (staging || (production &&
      env.CUSTOMER_R2_PRODUCTION_RELEASE_APPROVED==="true" &&
      env.PRODUCTION_R2_MIGRATION_APPROVED==="true"));
}
export async function migrateTestAssetsToR2():Promise<{
 assets:number;sourceAssets:number;paidVideos:number;verifiedBytes:number;
}>{
 if(!allowPrivateMediaMigration(process.env)||!customerR2Enabled()||
   path.resolve(dataDir)!=="/app/.data"||
   !existsSync(path.join(dataDir,"demo.sqlite")))
  throw Error("Media migration requires explicit target-environment R2 approval and mounted data");
 const root=await realpath(path.join(dataDir,"media"));
 db.exec("CREATE TABLE IF NOT EXISTS cloud_source_media(asset_id TEXT PRIMARY KEY,owner TEXT NOT NULL,key TEXT UNIQUE NOT NULL,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,created INTEGER NOT NULL)");
 const commerceFile=path.join(dataDir,"commerce.sqlite");
 const commerce=existsSync(commerceFile)?new CommerceStore(commerceFile):null;
 try{
  const rows=db.prepare("SELECT data FROM assets ORDER BY rowid ASC").all() as {data:string}[];
  let sourceAssets=0,paidVideos=0,verifiedBytes=0;
  for(const row of rows){
   const asset=JSON.parse(row.data) as Asset;
   if(!asset.id||!asset.owner||!Number.isSafeInteger(asset.bytes)||asset.bytes<1)
    throw Error("Malformed private media record: operator inspection required");
   const filename=path.resolve(asset.path);
   const staticSample=path.resolve("public/media/demo.mp4");
   if((!filename.startsWith(root+path.sep)||path.dirname(filename)!==root)&&
      !(asset.kind==="video"&&filename===staticSample))
    throw Error("Media path outside the permitted private store");
   const isPaid=asset.kind==="video"&&asset.id.startsWith("customer-video-");
   let present=true;
   try{
    const info=await stat(filename);
    if(!info.isFile()||info.size!==asset.bytes)throw Error("Local media size mismatch");
    if(!((await realpath(filename))===filename))throw Error("Local media must not be a symlink");
   }catch(e){
    if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;
    present=false;
   }
   if(isPaid){
    if(!commerce)throw Error("Paid test records exist without commerce ledger");
    const orderId=asset.id.slice("customer-video-".length);
    const accountId=asset.owner.startsWith("customer-")?asset.owner.slice(9):"";
    // Revoked/disputed test videos are still private evidence worth
    // preserving. Their customer download rights remain revoked by the
    // existing order-status gate; migration never restores entitlements.
    const order=commerce.db.prepare("SELECT account_id FROM customer_orders WHERE id=?").get(orderId) as {account_id:string|null}|undefined;
    const delivery=commerce.db.prepare("SELECT asset_id FROM customer_video_deliveries WHERE order_id=?").get(orderId) as {asset_id:string}|undefined;
    if(!accountId||order?.account_id!==accountId||delivery?.asset_id!==asset.id)
     throw Error("Paid test archive is not bound to an owned historical delivery");
    commerce.db.exec("CREATE TABLE IF NOT EXISTS cloud_paid_videos(order_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,key TEXT UNIQUE NOT NULL,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,created INTEGER NOT NULL)");
    let record:CloudPaidVideoRecord|undefined=commerce.db.prepare("SELECT key,sha256,bytes FROM cloud_paid_videos WHERE order_id=? AND account_id=?").get(orderId,accountId) as CloudPaidVideoRecord|undefined;
    if(present){
     const result=await mirrorPrivatePaidVideo(accountId,orderId,filename,asset.bytes);
     if(!result)throw Error("Private paid video archive not enabled");
     if(record&&(record.key!==result.key||record.bytes!==result.bytes||record.sha256!==result.sha256))
      throw Error("Paid R2 manifest conflicts with existing delivery");
     if(!record)commerce.db.prepare("INSERT INTO cloud_paid_videos VALUES(?,?,?,?,?,?)").run(orderId,accountId,result.key,result.sha256,result.bytes,Date.now());
     record=result;
    }
    if(!record||!validPaidCloudRecord(accountId,orderId,record)||record.bytes!==asset.bytes)
     throw Error("Paid R2 archive is missing or mismatched");
    // Read the entire signed and owner-bound object, not just its metadata.
    const stream=await paidR2ByteRange(accountId,orderId,record,0,record.bytes-1);
    const digest=createHash("sha256"),reader=stream.getReader();let count=0;
    try{
     while(true){const chunk=await reader.read();if(chunk.done)break;
      count+=chunk.value.byteLength;
      if(count>record.bytes)throw Error("Paid R2 archive exceeded recorded bytes");
      digest.update(chunk.value);
     }
    }finally{reader.releaseLock()}
    if(count!==record.bytes||digest.digest("hex")!==record.sha256)throw Error("Paid R2 archive digest failed");
    paidVideos++;
   }else{
    let record=db.prepare("SELECT key,sha256,bytes FROM cloud_source_media WHERE asset_id=? AND owner=?").get(asset.id,asset.owner) as CloudMediaRecord|undefined;
    if(present){
     const result=await mirrorPrivateSource(asset);
     if(!result)throw Error("Private source mirroring is disabled");
     if(record&&(record.key!==result.key||record.sha256!==result.sha256||record.bytes!==result.bytes))
      throw Error("Cloud migration manifest mismatch");
     if(!record)db.prepare("INSERT INTO cloud_source_media VALUES(?,?,?,?,?,?)").run(asset.id,asset.owner,result.key,result.sha256,result.bytes,Date.now());
     record=result;
    }
    if(!record||!validCloudRecord(asset.owner,asset.id,record)||record.bytes!==asset.bytes)
     throw Error("Test media unavailable in both local and remote stores");
    await readMirroredPrivateSource(asset.owner,asset.id,record,sourceAssetLimit(asset.kind));
    sourceAssets++;
   }
   verifiedBytes+=asset.bytes;
   if((sourceAssets+paidVideos)%20===0)
    console.log(JSON.stringify({r2MigrationProgress:{verified:sourceAssets+paidVideos,total:rows.length}}));
  }
  return {assets:rows.length,sourceAssets,paidVideos,verifiedBytes};
 }finally{commerce?.close()}
}

if(process.argv[1]?.endsWith("/migrate-test-assets-to-r2.ts")){
 migrateTestAssetsToR2().then(result=>{
  console.log("R2_MIGRATION_VERIFIED "+JSON.stringify(result));
 }).catch(e=>{
  console.error("R2_MIGRATION_FAILED "+(e instanceof Error?e.message:"unknown"));
  process.exitCode=1;
 });
}
