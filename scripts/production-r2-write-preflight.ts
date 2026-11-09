/** Explicit Production-only R2 read/write/delete canary.
 * Never accesses customer assets, Stripe, BytePlus or stored media.
 * Every key is a new random identity under an exclusive preflight prefix.
 * Failure remains blocked; this is evidence, not release approval.
 */
import {randomBytes,randomUUID,createHash} from "node:crypto";
import {S3Client,PutObjectCommand,GetObjectCommand,HeadObjectCommand,DeleteObjectCommand} from "@aws-sdk/client-s3";
import {loadR2Config,r2ClientConfig} from "../lib/live/r2-config.ts";

const PRODUCTION="36adc41d-7e54-4396-ad1a-fd432ba0441d";
export type R2WritePreflightStatus="skipped"|"verified"|"blocked";
export async function productionR2WritePreflight(
 env:Record<string,string|undefined>=process.env,
 clientFactory:(config:ReturnType<typeof r2ClientConfig>)=>Pick<S3Client,"send"|"destroy">=
  config=>new S3Client(config),
):Promise<R2WritePreflightStatus>{
 if(env.RAILWAY_ENVIRONMENT_ID!==PRODUCTION||
    env.PRODUCTION_R2_WRITE_PREFLIGHT_ENABLED!=="true"||
    env.STAGING_AUTH_ENABLED!=="true"||
    (env.STAGING_PASSWORD?.length||0)<32||
    env.PRODUCTION_PUBLIC_ACCESS_ENABLED!=="false"||
    env.PUBLIC_CUSTOMER_LAUNCH_APPROVED!=="false"||
    env.STRIPE_LIVE_CHECKOUT_ENABLED!=="false"||
    env.CUSTOMER_PAID_WORKER_ENABLED!=="false"||
    env.CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED!=="false")
   return "skipped";
 let client:Pick<S3Client,"send"|"destroy">|undefined;
 let key:string|undefined;
 let bucket:string|undefined;
 let verified=false,deleted=false;
 try{
  const cfg=loadR2Config(env);
  bucket=cfg.bucket;
  client=clientFactory(r2ClientConfig(cfg));
  key="singmotion-private-preflight/v1/"+randomUUID()+"/canary.bin";
  const bytes=randomBytes(1024),sha256=createHash("sha256").update(bytes).digest("hex");
  const commandOpts={abortSignal:AbortSignal.timeout(12000)};
  await client.send(new PutObjectCommand({
   Bucket:bucket,Key:key,Body:bytes,ContentLength:bytes.length,
   ContentType:"application/octet-stream",IfNoneMatch:"*",
   CacheControl:"private, no-store",
   Metadata:{"singmotion-sha256":sha256},
  }),commandOpts);
  const head=await client.send(new HeadObjectCommand({Bucket:bucket,Key:key}),commandOpts);
  if(head.ContentLength!==bytes.length||head.Metadata?.["singmotion-sha256"]!==sha256)
   throw Error("Canary metadata mismatch");
  const object=await client.send(new GetObjectCommand({Bucket:bucket,Key:key}),commandOpts);
  if(!object.Body||object.ContentLength!==bytes.length)throw Error("Canary read unavailable");
  const chunks:Buffer[]=[];let length=0;
  for await(const chunk of object.Body as AsyncIterable<Uint8Array>){
   length+=chunk.length;
   if(length>bytes.length)throw Error("Canary exceeds expected size");
   chunks.push(Buffer.from(chunk));
  }
  const received=Buffer.concat(chunks);
  if(length!==bytes.length||!received.equals(bytes))throw Error("Canary readback mismatch");
  verified=true;
 }catch{/* Never log credentials, bucket, endpoints or provider error bodies. */}
 finally{
  if(client&&key&&bucket){
   try{
    await client.send(new DeleteObjectCommand({Bucket:bucket,Key:key}),{abortSignal:AbortSignal.timeout(12000)});
    try{
     await client.send(new HeadObjectCommand({Bucket:bucket,Key:key}),{abortSignal:AbortSignal.timeout(12000)});
    }catch(error){
     if((error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode===404)
      deleted=true;
    }
   }catch{/* An ambiguous deletion must never be reported as verified. */}
  }
  client?.destroy();
 }
 return verified&&deleted?"verified":"blocked";
}
