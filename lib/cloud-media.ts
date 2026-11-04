/** Private, staging-gated R2 source-media replication.
 * Local originals remain the verified provider-working copy until all workers
 * and delivery paths can recover from R2; never silently delete originals.
 * No public bucket ACL, object URLs, or browser credentials.
 */
import {createHash} from "node:crypto";
import {readFile,stat} from "node:fs/promises";
import {S3Client,PutObjectCommand,HeadObjectCommand,GetObjectCommand,DeleteObjectCommand} from "@aws-sdk/client-s3";
import {loadR2Config,r2ClientConfig} from "./live/r2-config.ts";
import type {Asset} from "./domain.ts";

export interface CloudMediaRecord {
 key:string; sha256:string; bytes:number;
}
const sha=(data:Buffer|string)=>createHash("sha256").update(data).digest("hex");
const validId=(s:string)=>/^[a-zA-Z0-9_-]{1,180}$/.test(s);
const validOwner=(s:string)=>/^(?:[a-f0-9-]{36}|customer-[a-f0-9-]{36}|cms-staff-[a-zA-Z0-9_-]{1,100})$/.test(s);
const idComponent=(id:string)=>/^[a-f0-9-]{36}$/.test(id)?id:sha(id);
export function sourceAssetLimit(kind:Asset["kind"]):number{
 return kind==="video"?256*1024*1024:50*1024*1024;
}
export const customerR2Enabled=()=>{
 if(process.env.CUSTOMER_R2_STORAGE_ENABLED!=="true")return false;
 const env=process.env.RAILWAY_ENVIRONMENT_ID;
 if(env==="dfaeabed-03df-43ed-aa71-50f343a75041")return true;
 // Public launch requires its OWN verified production R2 credentials and a
 // second, explicit release approval. Never inherit Staging's opt-in.
 return env==="36adc41d-7e54-4396-ad1a-fd432ba0441d"&&
  process.env.CUSTOMER_R2_PRODUCTION_RELEASE_APPROVED==="true";
};
export function privateSourceKey(owner:string,id:string,digest:string):string{
 if(!validOwner(owner)||!validId(id)||!/^[a-f0-9]{64}$/.test(digest))
  throw Error("Invalid private R2 source identity");
 return `customer-sources/v1/${sha(owner)}/${idComponent(id)}/${digest}`;
}
export function validCloudRecord(owner:string,id:string,record:CloudMediaRecord):boolean{
 return Number.isSafeInteger(record.bytes)&&record.bytes>0&&
  record.key===privateSourceKey(owner,id,record.sha256);
}
/** Returns a verified private record only after R2 confirms the exact bytes.
 * An uncertain PUT is never blindly retried or deleted; operator reconciliation
 * may be necessary, with the local original retained.
 */
export async function mirrorPrivateSource(asset:Asset):Promise<CloudMediaRecord|null>{
 if(!customerR2Enabled())return null;
 if(!validOwner(asset.owner)||!validId(asset.id))throw Error("Invalid private asset identity");
 const config=loadR2Config();
 const client=new S3Client(r2ClientConfig(config));
 try{
  const info=await stat(asset.path);
  if(!info.isFile()||info.size!==asset.bytes||info.size<=0||info.size>sourceAssetLimit(asset.kind))
   throw Error("Private source size mismatch");
  const bytes=await readFile(asset.path);
  const digest=sha(bytes),key=privateSourceKey(asset.owner,asset.id,digest);
  const record={key,sha256:digest,bytes:bytes.length};
  // Idempotent migration: accept an existing object only if its immutable
  // key, exact size and digest metadata match this verified local original.
  let existing=false;
  try{
   const h=await client.send(new HeadObjectCommand({Bucket:config.bucket,Key:key}));
   if(h.ContentLength!==bytes.length||h.Metadata?.["singmotion-sha256"]!==digest)
    throw Error("Cloud object differs from local source; manual reconciliation required");
   existing=true;
  }catch(e){if((e as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode!==404)throw e}
  if(!existing){
   try{
    await client.send(new PutObjectCommand({
     Bucket:config.bucket,Key:key,Body:bytes,ContentLength:bytes.length,
     ContentType:asset.mime,ContentMD5:createHash("md5").update(bytes).digest("base64"),
     CacheControl:"private, no-store",IfNoneMatch:"*",
     Metadata:{"singmotion-sha256":digest},
    }));
   }catch(e){if((e as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode!==412)throw e}
  }
  const head=await client.send(new HeadObjectCommand({Bucket:config.bucket,Key:key}));
  if(head.ContentLength!==bytes.length||head.Metadata?.["singmotion-sha256"]!==digest)
   throw Error("Private R2 readback metadata mismatch");
  return record;
 }finally{client.destroy()}
}
/** Read only a server-recorded owner-bound object, never client-provided keys.
 * This helper is for recovery; callers must authorize ownership first.
 */
export async function readMirroredPrivateSource(owner:string,id:string,record:CloudMediaRecord,maxBytes:number):Promise<Buffer>{
 if(!customerR2Enabled()||!validCloudRecord(owner,id,record)||
    !Number.isSafeInteger(maxBytes)||record.bytes>maxBytes)throw Error("R2 private source unavailable");
 const config=loadR2Config(),client=new S3Client(r2ClientConfig(config));
 try{
  const response=await client.send(new GetObjectCommand({Bucket:config.bucket,Key:record.key}));
  if(!response.Body||response.ContentLength!==record.bytes)throw Error("Cloud object size mismatch");
  const chunks:Buffer[]=[];let total=0;
  for await(const chunk of response.Body as AsyncIterable<Uint8Array>){
   total+=chunk.length;
   if(total>record.bytes||total>maxBytes)throw Error("Cloud object exceeds bound");
   chunks.push(Buffer.from(chunk));
  }
  const body=Buffer.concat(chunks);
  if(body.length!==record.bytes||sha(body)!==record.sha256)
   throw Error("Cloud object digest mismatch");
  return body;
 }finally{client.destroy()}
}

/** Explicit deletion only after a separately authorized unused-upload check.
 * Never use prefix/list operations, and do not remove a manifest if a remote
 * delete cannot be independently confirmed.
 */
export async function deleteMirroredPrivateSource(owner:string,id:string,record:CloudMediaRecord):Promise<void>{
 if(!customerR2Enabled()||!validCloudRecord(owner,id,record))
  throw Error("Private R2 cleanup is not available");
 const config=loadR2Config(),client=new S3Client(r2ClientConfig(config));
 try{
  await client.send(new DeleteObjectCommand({Bucket:config.bucket,Key:record.key}));
  try{
   await client.send(new HeadObjectCommand({Bucket:config.bucket,Key:record.key}));
   throw Error("Private cloud deletion was not confirmed");
  }catch(e){
   const status=(e as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode;
   if(status!==404)throw e;
  }
 }finally{client.destroy()}
}
