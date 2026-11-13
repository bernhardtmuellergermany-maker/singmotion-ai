/** Staging/approved-Production, one-shot private R2 input lease for one paid customer order.
 * A created manifest is an irreversible upload-attempt record: after an ambiguous
 * S3 outcome it must be reconciled, never silently resubmitted.
 */
import {constants} from "node:fs";
import {open,realpath} from "node:fs/promises";
import {createHash,randomUUID} from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import {S3Client,PutObjectCommand,GetObjectCommand} from "@aws-sdk/client-s3";
import {getSignedUrl} from "@aws-sdk/s3-request-presigner";
import {CommerceStore} from "./store.ts";
import {productionCustomerReleaseApproved} from "./customer-live-config.ts";
import {assessProductionSandboxPilot} from "./customer-sandbox-pilot-policy.ts";
import {protectedProductionLivePilotApproved} from "./protected-production-live-pilot.ts";
import {loadR2Config,r2ClientConfig,type R2Config} from "../live/r2-config.ts";
import {assertInputLifetime,inputDeliveryPolicy} from "../live/input-policy.ts";
import type {PrivateInputDelivery,InputLease} from "../live/byteplus.ts";
import type {PreparedMedia} from "../live/store.ts";

const sha=(data:Buffer|string)=>createHash("sha256").update(data).digest("hex");
async function readImmutable(file:string,root:string,expected:string,maxBytes:number){
 const mediaRoot=await realpath(path.join(root,"media"));
 const resolved=await realpath(file);
 if(!resolved.startsWith(mediaRoot+path.sep)||path.dirname(resolved)!==mediaRoot)
  throw Error("Customer input must be a private immutable snapshot");
 const handle=await open(resolved,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const info=await handle.stat();
  if(!info.isFile()||info.nlink!==1||info.size<=0||info.size>=maxBytes||
     (info.mode&0o077)!==0)throw Error("Untrusted private input file");
  const buffer=Buffer.alloc(info.size);
  let offset=0;
  while(offset<buffer.length){
   const result=await handle.read(buffer,offset,buffer.length-offset,offset);
   if(result.bytesRead===0)throw Error("Incomplete private input");
   offset+=result.bytesRead;
  }
  if(sha(buffer)!==expected)throw Error("Customer input hash changed");
  return buffer;
 }finally{await handle.close()}
}
export class CustomerR2PrivateInputDelivery implements PrivateInputDelivery{
 readonly client:S3Client;
 readonly inputHosts:readonly string[];
 private readonly config:R2Config;
 private readonly store:CommerceStore;
 private readonly orderId:string;
 private readonly dataDir:string;
 constructor(
  store:CommerceStore,
  orderId:string,
  dataDir:string,
  env:Record<string,string|undefined>=process.env,
  client?:S3Client,
 ){
  this.store=store;
  this.orderId=orderId;
  this.dataDir=dataDir;
  if(env.RAILWAY_ENVIRONMENT_ID!=="dfaeabed-03df-43ed-aa71-50f343a75041" &&
     !productionCustomerReleaseApproved(env) && !assessProductionSandboxPilot(env).ready &&
     !protectedProductionLivePilotApproved(env))
   throw Error("Customer input leasing requires protected staging or approved production");
  if(!/^[a-f0-9-]{36}$/.test(orderId))throw Error("Invalid paid order reference");
  this.config=loadR2Config(env);
  this.client=client??new S3Client(r2ClientConfig(this.config));
  this.inputHosts=[`${this.config.accountId}.r2.cloudflarestorage.com`];
 }
 async issue(media:PreparedMedia,signal:AbortSignal):Promise<InputLease>{
  signal.throwIfAborted();
  const audio=await readImmutable(media.audioPath,this.dataDir,media.audioSha256,15_000_000);
  const image=await readImmutable(media.imagePath,this.dataDir,media.imageSha256,30_000_000);
  const format=(await sharp(image,{limitInputPixels:4096*4096,failOn:"error"}).metadata()).format;
  if(format!=="jpeg"&&format!=="png")throw Error("Unsupported reference image");
  if(typeof media.prompt!=="string"||media.prompt.length>1500)throw Error("Invalid user prompt");
  const now=Date.now();
  const signingDate=new Date(Math.floor(now/1000)*1000);
  const expiresAt=signingDate.getTime()+inputDeliveryPolicy.leaseSeconds*1000;
  assertInputLifetime(expiresAt);
  const nonce=randomUUID();
  const prefix=`customer-byteplus-inputs/v1/${sha(media.owner)}/${this.orderId}/${nonce}`;
  const audioKey=`${prefix}/${media.audioSha256}.mp3`;
  const imageKey=`${prefix}/${media.imageSha256}.${format==="jpeg"?"jpg":"png"}`;
  // Durable ownership and nonretryable manifest before the first external R2 call.
  const inserted=this.store.db.prepare(`
   INSERT OR IGNORE INTO customer_provider_input_leases
    (order_id,account_id,audio_key,image_key,expires_at,state)
   SELECT o.id,COALESCE(o.account_id,o.id),?,?,?,'uploading'
   FROM customer_orders o
   JOIN customer_fulfillment_queue q ON q.order_id=o.id AND q.state='processing'
   JOIN customer_provider_submissions p ON p.order_id=o.id
    AND p.provider='byteplus' AND p.state='submitted_or_unknown'
   JOIN customer_provider_cost_reservations c ON c.order_id=o.id
   LEFT JOIN customer_guest_media_owners g ON g.order_id=o.id
   WHERE o.id=? AND o.status='paid'
     AND ((o.account_id IS NOT NULL AND ? = 'customer-' || o.account_id)
       OR (o.account_id IS NULL AND o.guest_hash IS NOT NULL AND ? = g.media_owner))
  `).run(audioKey,imageKey,expiresAt,this.orderId,media.owner,media.owner);
  if(inserted.changes!==1)throw Error("Paid customer input lease already attempted or unauthorized");
  try{
   const put=async(key:string,bytes:Buffer,contentType:string)=>{
    signal.throwIfAborted();
    await this.client.send(new PutObjectCommand({
     Bucket:this.config.bucket,Key:key,Body:bytes,ContentLength:bytes.length,
     ContentType:contentType,ContentMD5:createHash("md5").update(bytes).digest("base64"),
     CacheControl:"private, no-store",IfNoneMatch:"*",
    }),{abortSignal:signal});
   };
   await put(audioKey,audio,"audio/mpeg");
   await put(imageKey,image,`image/${format}`);
   const sign=(key:string)=>getSignedUrl(this.client,new GetObjectCommand({
    Bucket:this.config.bucket,Key:key,
   }),{expiresIn:inputDeliveryPolicy.leaseSeconds,signingDate});
   const [audioUrl,imageUrl]=await Promise.all([sign(audioKey),sign(imageKey)]);
   for(const [raw,key] of [[audioUrl,audioKey],[imageUrl,imageKey]]){
    const u=new URL(raw);
    if(u.origin!==`https://${this.inputHosts[0]}`||u.username||u.password||u.hash||
       decodeURIComponent(u.pathname)!==`/${this.config.bucket}/${key}`||
       u.searchParams.get("X-Amz-Expires")!==String(inputDeliveryPolicy.leaseSeconds)||
       !u.searchParams.get("X-Amz-Signature"))
     throw Error("Invalid scoped private input URL");
   }
   signal.throwIfAborted();
   assertInputLifetime(expiresAt);
   this.store.db.prepare("UPDATE customer_provider_input_leases SET state='ready' WHERE order_id=? AND state='uploading'")
    .run(this.orderId);
   return {owner:media.owner,audioSha256:media.audioSha256,imageSha256:media.imageSha256,
    audioUrl,imageUrl,expiresAt};
  }catch{
   this.store.db.prepare("UPDATE customer_provider_input_leases SET state='requires-review' WHERE order_id=? AND state='uploading'")
    .run(this.orderId);
   throw Error("Private customer input delivery uncertain; reconcile original manifest without retry");
  }
 }
 close(){this.client.destroy()}
}
