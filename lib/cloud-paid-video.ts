/** Staging-only R2 archive for paid, owner-authenticated MP4 deliveries.
 * Recording a cloud copy never manufactures payment evidence or authorizes a
 * provider task. It supplements the validated local delivery until all legacy
 * records are migrated and tested. No direct public bucket URLs are exposed.
 */
import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {stat} from "node:fs/promises";
import {S3Client,PutObjectCommand,HeadObjectCommand,GetObjectCommand} from "@aws-sdk/client-s3";
import {loadR2Config,r2ClientConfig} from "./live/r2-config.ts";
import {customerR2Enabled} from "./cloud-media.ts";

export interface CloudPaidVideoRecord {key:string;sha256:string;bytes:number}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const sha=(text:string)=>createHash("sha256").update(text).digest("hex");
export function privatePaidVideoKey(accountId:string,orderId:string,digest:string):string{
 if(!uuid.test(accountId)||!uuid.test(orderId)||!/^[a-f0-9]{64}$/.test(digest))
  throw Error("Invalid paid cloud-video identity");
 return `customer-videos/v1/${sha("customer-"+accountId)}/${orderId}/${digest}.mp4`;
}
export function validPaidCloudRecord(accountId:string,orderId:string,record:CloudPaidVideoRecord):boolean{
 if(!record||!Number.isSafeInteger(record.bytes)||record.bytes<1||!record.sha256||!record.key)return false;
 try{return record.key===privatePaidVideoKey(accountId,orderId,record.sha256)}catch{return false}
}
async function digests(filename:string):Promise<{sha256:string;md5:string}>{
 const sha256=createHash("sha256"),md5=createHash("md5");
 for await(const chunk of createReadStream(filename)){sha256.update(chunk);md5.update(chunk)}
 return {sha256:sha256.digest("hex"),md5:md5.digest("base64")};
}
export async function mirrorPrivatePaidVideo(accountId:string,orderId:string,file:string,expectedBytes:number):Promise<CloudPaidVideoRecord|null>{
 if(!customerR2Enabled())return null;
 if(!uuid.test(accountId)||!uuid.test(orderId)||!Number.isSafeInteger(expectedBytes)||expectedBytes<1||expectedBytes>256*1024*1024)
  throw Error("Invalid paid video R2 request");
 const info=await stat(file);
 if(!info.isFile()||info.size!==expectedBytes)throw Error("Validated paid video changed");
 const digest=await digests(file);
 const record={key:privatePaidVideoKey(accountId,orderId,digest.sha256),sha256:digest.sha256,bytes:expectedBytes};
 const config=loadR2Config(),client=new S3Client(r2ClientConfig(config));
 try{
  let already=false;
  try{
   const existing=await client.send(new HeadObjectCommand({Bucket:config.bucket,Key:record.key}));
   if(existing.ContentLength!==expectedBytes||existing.Metadata?.["singmotion-sha256"]!==digest.sha256)
    throw Error("Existing paid archive differs from validated MP4");
   already=true;
  }catch(e){if((e as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode!==404)throw e}
  if(!already){
   try{
    await client.send(new PutObjectCommand({
     Bucket:config.bucket,Key:record.key,Body:createReadStream(file),
     ContentLength:expectedBytes,ContentType:"video/mp4",ContentMD5:digest.md5,
     CacheControl:"private, no-store",IfNoneMatch:"*",
     Metadata:{"singmotion-sha256":digest.sha256},
    }));
   }catch(e){if((e as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode!==412)throw e}
  }
  const head=await client.send(new HeadObjectCommand({Bucket:config.bucket,Key:record.key}));
  if(head.ContentLength!==expectedBytes||head.Metadata?.["singmotion-sha256"]!==digest.sha256)
   throw Error("Paid R2 object verification failed");
  return record;
 }finally{client.destroy()}
}

/** Authorized handler supplies a manifest already bound to a verified paid
 * delivery and a customer session. Stream only the exact requested byte range
 * with backpressure, and close the R2 connection on completion/cancellation.
 */
export async function paidR2ByteRange(
 accountId:string,orderId:string,record:CloudPaidVideoRecord,
 start:number,end:number,signal?:AbortSignal,
):Promise<ReadableStream<Uint8Array>>{
 if(!customerR2Enabled()||!validPaidCloudRecord(accountId,orderId,record)||
  !Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>=record.bytes)
  throw Error("Private paid R2 range invalid");
 const config=loadR2Config(),client=new S3Client(r2ClientConfig(config));
 try{
  const response=await client.send(new GetObjectCommand({
   Bucket:config.bucket,Key:record.key,Range:`bytes=${start}-${end}`,
  }),{abortSignal:signal});
  if(!response.Body||response.ContentLength!==end-start+1||
     response.ContentRange!==`bytes ${start}-${end}/${record.bytes}`)
   throw Error("Private paid R2 response range mismatch");
  const iterator=(response.Body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
  let remaining=end-start+1;
  return new ReadableStream<Uint8Array>({
   async pull(controller){
    try{
     const item=await iterator.next();
     if(item.done){
      if(remaining!==0)throw Error("Private paid R2 stream truncated");
      controller.close();client.destroy();return;
     }
     remaining-=item.value.byteLength;
     if(remaining<0)throw Error("Private paid R2 stream exceeded requested range");
     controller.enqueue(new Uint8Array(item.value));
    }catch(e){controller.error(e);client.destroy()}
   },
   async cancel(){
    try{await iterator.return?.()}finally{client.destroy()}
   },
  });
 }catch(e){client.destroy();throw e}
}
