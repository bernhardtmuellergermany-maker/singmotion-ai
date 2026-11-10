/** Isolated Production MP4 archive/range diagnostic; no customer identities,
 * orders, Stripe transactions, BytePlus calls or production release approval.
 * The random object is private and deleted even on a partial/uncertain PUT.
 */
import {createHash,randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {S3Client,PutObjectCommand,GetObjectCommand,HeadObjectCommand,DeleteObjectCommand} from "@aws-sdk/client-s3";
import {loadR2Config,r2ClientConfig} from "../lib/live/r2-config.ts";

const PRODUCTION="36adc41d-7e54-4396-ad1a-fd432ba0441d";
export type Mp4PreflightStatus="skipped"|"verified"|"blocked";
const sha=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
async function bytesFromResponse(body:unknown,limit:number):Promise<Buffer>{
 if(!body||typeof body!=="object"||!(Symbol.asyncIterator in body))
  throw Error("R2 range body missing");
 const chunks:Buffer[]=[];let n=0;
 for await(const chunk of body as AsyncIterable<Uint8Array>){
  n+=chunk.byteLength;
  if(n>limit)throw Error("R2 MP4 range exceeds requested bytes");
  chunks.push(Buffer.from(chunk));
 }
 return Buffer.concat(chunks);
}
export async function productionR2Mp4Preflight(
 env:Record<string,string|undefined>=process.env,
 clientFactory:(config:ReturnType<typeof r2ClientConfig>)=>Pick<S3Client,"send"|"destroy">=
  config=>new S3Client(config),
):Promise<Mp4PreflightStatus>{
 // Neither a release approval nor an opportunity to touch existing customer
 // objects: protected/private Production, payment and dispatch OFF.
 if(env.RAILWAY_ENVIRONMENT_ID!==PRODUCTION||
    env.PRODUCTION_R2_MP4_PREFLIGHT_ENABLED!=="true"||
    env.STAGING_AUTH_ENABLED!=="true"||
    (env.STAGING_PASSWORD?.length||0)<32||
    env.PRODUCTION_PUBLIC_ACCESS_ENABLED!=="false"||
    env.PUBLIC_CUSTOMER_LAUNCH_APPROVED!=="false"||
    env.STRIPE_LIVE_CHECKOUT_ENABLED!=="false"||
    env.CUSTOMER_PAID_WORKER_ENABLED!=="false"||
    env.CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED!=="false")
   return "skipped";
 let client:Pick<S3Client,"send"|"destroy">|undefined;
 let bucket:string|undefined,key:string|undefined;
 let verified=false,deleted=false;
 try{
  const file=path.resolve("public/media/demo.mp4");
  const video=await readFile(file);
  if(video.length<8192||video.length>256*1024*1024)throw Error("Bad MP4 canary sample");
  const digest=sha(video),config=loadR2Config(env);
  bucket=config.bucket;
  client=clientFactory(r2ClientConfig(config));
  key="singmotion-private-preflight/mp4-v1/"+randomUUID()+"/video.mp4";
  const deadline={abortSignal:AbortSignal.timeout(30000)};
  await client.send(new PutObjectCommand({
   Bucket:bucket,Key:key,Body:video,ContentLength:video.length,
   ContentType:"video/mp4",IfNoneMatch:"*",
   CacheControl:"private, no-store",
   Metadata:{"singmotion-sha256":digest},
  }),deadline);
  const h=await client.send(new HeadObjectCommand({Bucket:bucket,Key:key}),deadline);
  if(h.ContentLength!==video.length||h.Metadata?.["singmotion-sha256"]!==digest)
   throw Error("Private MP4 metadata mismatch");
  for(const [start,end] of [[100,8191],[0,video.length-1]]){
   const range=await client.send(new GetObjectCommand({
    Bucket:bucket,Key:key,Range:`bytes=${start}-${end}`,
   }),deadline);
   const expected=video.subarray(start,end+1);
   const actual=await bytesFromResponse(range.Body,expected.length);
   if(actual.length!==expected.length||!actual.equals(expected))
    throw Error("Private MP4 byte range mismatch");
  }
  verified=true;
 }catch{/* Do not log bucket, network endpoints, signed URLs or credentials. */}
 finally{
  if(client&&bucket&&key){
   try{
    const deadline={abortSignal:AbortSignal.timeout(30000)};
    await client.send(new DeleteObjectCommand({Bucket:bucket,Key:key}),deadline);
    try{
     await client.send(new HeadObjectCommand({Bucket:bucket,Key:key}),deadline);
    }catch(error){
     if((error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode===404)
      deleted=true;
    }
   }catch{/* Ambiguous cleanup is not a passing preflight. */}
  }
  client?.destroy();
 }
 return verified&&deleted?"verified":"blocked";
}
