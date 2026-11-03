/** Private, staging-gated R2 source-media replication.
 * Local originals remain the verified provider-working copy until all workers
 * and delivery paths can recover from R2; never silently delete originals.
 * No public bucket ACL, object URLs, or browser credentials.
 */
import {createHash} from "node:crypto";
import {readFile,stat} from "node:fs/promises";
import {S3Client,PutObjectCommand,HeadObjectCommand,GetObjectCommand} from "@aws-sdk/client-s3";
import {loadR2Config,r2ClientConfig} from "./live/r2-config.ts";
import type {Asset} from "./domain.ts";

export interface CloudMediaRecord {
 key:string; sha256:string; bytes:number;
}
const sha=(data:Buffer|string)=>createHash("sha256").update(data).digest("hex");
const validId=(s:string)=>/^[a-f0-9-]{36}$/.test(s);
export const customerR2Enabled=()=>process.env.RAILWAY_ENVIRONMENT_ID==="dfaeabed-03df-43ed-aa71-50f343a75041"&&process.env.CUSTOMER_R2_STORAGE_ENABLED==="true";
export function privateSourceKey(owner:string,id:string,digest:string):string{
 if(!/^customer-[a-f0-9-]{36}$/.test(owner)||!validId(id)||!/^[a-f0-9]{64}$/.test(digest))
  throw Error("Invalid private R2 source identity");
 return `customer-sources/v1/${sha(owner)}/${id}/${digest}`;
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
 if(!customerR2Enabled()||!asset.owner.startsWith("customer-"))return null;
 if(asset.kind!=="audio"&&asset.kind!=="image")throw Error("Only customer source assets may be mirrored");
 const config=loadR2Config();
 const client=new S3Client(r2ClientConfig(config));
 try{
  const info=await stat(asset.path);
  if(!info.isFile()||info.size!==asset.bytes||info.size<=0||info.size>50*1024*1024)
   throw Error("Private source size mismatch");
  const bytes=await readFile(asset.path);
  const digest=sha(bytes),key=privateSourceKey(asset.owner,asset.id,digest);
  const record={key,sha256:digest,bytes:bytes.length};
  await client.send(new PutObjectCommand({
   Bucket:config.bucket,Key:key,Body:bytes,ContentLength:bytes.length,
   ContentType:asset.mime,ContentMD5:createHash("md5").update(bytes).digest("base64"),
   CacheControl:"private, no-store",IfNoneMatch:"*",
   Metadata:{"singmotion-sha256":digest},
  }));
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
