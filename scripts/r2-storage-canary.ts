/** Explicit private R2 staging canary. Never creates customer orders, charges,
 * invokes AI providers or exposes public object URLs. All object names are
 * random one-use non-customer identities and are deleted after verification.
 */
import path from "node:path";
import {readFile,writeFile,unlink} from "node:fs/promises";
import {ensureLocalAsset} from "../lib/cloud-hydration.ts";
import {randomUUID,createHash} from "node:crypto";
import {S3Client,DeleteObjectCommand,HeadObjectCommand} from "@aws-sdk/client-s3";
import {loadR2Config,r2ClientConfig} from "../lib/live/r2-config.ts";
import {customerR2Enabled,mirrorPrivateSource,readMirroredPrivateSource,deleteMirroredPrivateSource,privateSourceKey} from "../lib/cloud-media.ts";
import {mirrorPrivatePaidVideo,paidR2ByteRange,privatePaidVideoKey,type CloudPaidVideoRecord} from "../lib/cloud-paid-video.ts";
import type {Asset} from "../lib/domain.ts";

const digest=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
async function canary(){
 const staging=process.env.RAILWAY_ENVIRONMENT_ID==="dfaeabed-03df-43ed-aa71-50f343a75041";
 const production=process.env.RAILWAY_ENVIRONMENT_ID==="36adc41d-7e54-4396-ad1a-fd432ba0441d";
 if(!customerR2Enabled()||
    !(staging&&process.argv.includes("--confirm-staging-private-r2-canary"))&&
    !(production&&process.env.CUSTOMER_R2_PRODUCTION_RELEASE_APPROVED==="true"&&
      process.argv.includes("--confirm-production-private-r2-canary")))
   throw Error("Explicit environment-specific private R2 canary approval required");
 const file=path.resolve("public/media/demo.mp4");
 const original=await readFile(file);
 if(original.byteLength<512||original.byteLength>256*1024*1024)
  throw Error("Invalid public fixed sample for private R2 canary");
 const owner=randomUUID(),id=randomUUID(),accountId=randomUUID(),orderId=randomUUID();
 const a:Asset={id,owner,kind:"video",name:"canary.mp4",path:file,mime:"video/mp4",
  bytes:original.byteLength,duration:10,width:null,height:null,created:Date.now()};
 const recordKey=privatePaidVideoKey(accountId,orderId,digest(original));
 const sourceKey=privateSourceKey(owner,id,digest(original));
 const cfg=loadR2Config(),client=new S3Client(r2ClientConfig(cfg));
 let source:Awaited<ReturnType<typeof mirrorPrivateSource>>=null;
 let paid:CloudPaidVideoRecord|undefined;
 let error:unknown;
 let cleanupHydration:(()=>Promise<void>)|undefined;
 let stage="source upload";
 try{
  source=await mirrorPrivateSource(a);
  if(!source)throw Error("Private source storage not active");
  stage="source readback";
  const restored=await readMirroredPrivateSource(owner,id,source,256*1024*1024);
  if(digest(restored)!==digest(original)||!restored.equals(original))
   throw Error("R2 full original is not byte-for-byte identical");
  if(staging){
   stage="private cloud-only scratch hydration";
   const {db,dataDir}=await import("../lib/db.ts");
   const local=path.join(dataDir,"media",`.r2-recovery-${id}.mp4`);
   cleanupHydration=async()=>{
    db.prepare("DELETE FROM cloud_source_media WHERE asset_id=? AND owner=?").run(id,owner);
    db.prepare("DELETE FROM assets WHERE id=? AND owner=?").run(id,owner);
    await unlink(local).catch(()=>{});
   };
   await writeFile(local,original,{flag:"wx",mode:0o600});
   a.path=local;
   db.exec("BEGIN IMMEDIATE");
   try{
    db.exec("CREATE TABLE IF NOT EXISTS cloud_source_media(asset_id TEXT PRIMARY KEY,owner TEXT NOT NULL,key TEXT UNIQUE NOT NULL,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,created INTEGER NOT NULL)");
    db.prepare("INSERT INTO assets VALUES(?,?,?)").run(id,owner,JSON.stringify(a));
    db.prepare("INSERT INTO cloud_source_media VALUES(?,?,?,?,?,?)").run(id,owner,source.key,source.sha256,source.bytes,Date.now());
    db.exec("COMMIT");
   }catch(e){db.exec("ROLLBACK");throw e}
   await unlink(local);
   const hydrated=await ensureLocalAsset(a);
   if(hydrated!==local||!(await readFile(hydrated)).equals(original))
    throw Error("Private R2 hydration differs from evicted local original");
   await unlink(local);
   console.log("R2_CLOUD_HYDRATION_CANARY_VERIFIED "+JSON.stringify({bytes:original.length,ownerScoped:true,localEvicted:true}));
  }
  stage="paid archive";
  paid=await mirrorPrivatePaidVideo(accountId,orderId,file,original.byteLength)??undefined;
  if(!paid)throw Error("Private paid R2 archive not active");
  // A 206 response must contain exactly the server-owned requested bytes;
  // test both a short seek and full secure playback, not just HEAD metadata.
  stage="paid range stream";
  for(const [start,end] of [[100,Math.min(8191,original.length-1)],[0,original.length-1]]){
   const response=await paidR2ByteRange(accountId,orderId,paid,start,end);
   const reader=response.getReader();const chunks:Uint8Array[]=[];let total=0;
   try{
    while(true){
     const chunk=await reader.read();
     if(chunk.done)break;
     total+=chunk.value.byteLength;
     if(total>end-start+1)throw Error("R2 byte-range exceeded bound");
     chunks.push(chunk.value);
    }
   }finally{reader.releaseLock()}
   const bytes=Buffer.concat(chunks.map(c=>Buffer.from(c)));
   if(bytes.length!==end-start+1||!bytes.equals(original.subarray(start,end+1)))
    throw Error("Private MP4 R2 byte-range differs from source");
  }
  console.log("R2_PRIVATE_MP4_CANARY_VERIFIED "+JSON.stringify({bytes:original.length,ranges:2,sourceSha256:digest(original).slice(0,12)}));
 }catch(e){error=e}
 if(cleanupHydration){try{await cleanupHydration()}catch(e){error??=e}}
 // Cleanup exact deterministic random canary keys even if PUT was ambiguous.
 try{
  await client.send(new DeleteObjectCommand({Bucket:cfg.bucket,Key:recordKey}));
  try{await client.send(new HeadObjectCommand({Bucket:cfg.bucket,Key:recordKey}));
   throw Error("Paid R2 canary deletion not confirmed");
  }catch(e){if((e as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode!==404)throw e}
 }catch(e){error??=e}
 try{
  if(source)await deleteMirroredPrivateSource(owner,id,source);
  else{
   // A failed/uncertain source PUT may still have created an object.
   await client.send(new DeleteObjectCommand({Bucket:cfg.bucket,Key:sourceKey}));
   try{await client.send(new HeadObjectCommand({Bucket:cfg.bucket,Key:sourceKey}));
    throw Error("Source R2 canary deletion not confirmed");
   }catch(e){if((e as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode!==404)throw e}
  }
 }catch(e){error??=e}
 client.destroy();
 if(error)throw Error("Private R2 canary failed in "+stage+" or cleanup could not be confirmed");
}
await canary().catch(e=>{console.error(e instanceof Error?e.message:"R2 canary error");process.exitCode=1});
