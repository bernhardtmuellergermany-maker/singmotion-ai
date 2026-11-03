/** Explicit private R2 staging canary. Never creates customer orders, charges,
 * invokes AI providers or exposes public object URLs. All object names are
 * random one-use non-customer identities and are deleted after verification.
 */
import path from "node:path";
import {readFile} from "node:fs/promises";
import {randomUUID,createHash} from "node:crypto";
import {S3Client,DeleteObjectCommand,HeadObjectCommand} from "@aws-sdk/client-s3";
import {loadR2Config,r2ClientConfig} from "../lib/live/r2-config.ts";
import {customerR2Enabled,mirrorPrivateSource,readMirroredPrivateSource,deleteMirroredPrivateSource} from "../lib/cloud-media.ts";
import {mirrorPrivatePaidVideo,paidR2ByteRange,privatePaidVideoKey,type CloudPaidVideoRecord} from "../lib/cloud-paid-video.ts";
import type {Asset} from "../lib/domain.ts";

const digest=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
async function canary(){
 if(!customerR2Enabled()||process.env.RAILWAY_ENVIRONMENT_ID!=="dfaeabed-03df-43ed-aa71-50f343a75041"||
  !process.argv.includes("--confirm-staging-private-r2-canary"))
  throw Error("Explicit Staging R2 canary confirmation required");
 const file=path.resolve("public/media/demo.mp4");
 const original=await readFile(file);
 if(original.byteLength<512||original.byteLength>256*1024*1024)
  throw Error("Invalid public fixed sample for private R2 canary");
 const owner=randomUUID(),id=randomUUID(),accountId=randomUUID(),orderId=randomUUID();
 const a:Asset={id,owner,kind:"video",name:"canary.mp4",path:file,mime:"video/mp4",
  bytes:original.byteLength,duration:10,width:null,height:null,created:Date.now()};
 const recordKey=privatePaidVideoKey(accountId,orderId,digest(original));
 const cfg=loadR2Config(),client=new S3Client(r2ClientConfig(cfg));
 let source:Awaited<ReturnType<typeof mirrorPrivateSource>>=null;
 let paid:CloudPaidVideoRecord|undefined;
 let error:unknown;
 try{
  source=await mirrorPrivateSource(a);
  if(!source)throw Error("Private source storage not active");
  const restored=await readMirroredPrivateSource(owner,id,source,256*1024*1024);
  if(digest(restored)!==digest(original)||!restored.equals(original))
   throw Error("R2 full original is not byte-for-byte identical");
  paid=await mirrorPrivatePaidVideo(accountId,orderId,file,original.byteLength)??undefined;
  if(!paid)throw Error("Private paid R2 archive not active");
  // A 206 response must contain exactly the server-owned requested bytes;
  // test both a short seek and full secure playback, not just HEAD metadata.
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
 // Cleanup exact deterministic random canary keys even if PUT was ambiguous.
 try{
  await client.send(new DeleteObjectCommand({Bucket:cfg.bucket,Key:recordKey}));
  try{await client.send(new HeadObjectCommand({Bucket:cfg.bucket,Key:recordKey}));
   throw Error("Paid R2 canary deletion not confirmed");
  }catch(e){if((e as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode!==404)throw e}
 }catch(e){error??=e}
 try{if(source)await deleteMirroredPrivateSource(owner,id,source)}catch(e){error??=e}
 client.destroy();
 if(error)throw Error("Private R2 canary failed or cleanup could not be confirmed");
}
await canary().catch(e=>{console.error(e instanceof Error?e.message:"R2 canary error");process.exitCode=1});
