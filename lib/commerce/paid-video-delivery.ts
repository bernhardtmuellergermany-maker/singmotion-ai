import {mkdir,lstat,realpath,stat,unlink,rename} from "node:fs/promises";
import {createHash} from "node:crypto";
import path from "node:path";
import {CommerceStore} from "./store.ts";
import {downloadValidatedOutput,validateOutput,outputTransferLimits,type OutputValidationContract} from "../live/output.ts";
import type {OutputTransport} from "../live/output-transport.ts";
import {restoreTempoOutput,validateRestored} from "../live/tempo.ts";
import {verifyPrivatePaidMediaSnapshot} from "./verify-paid-media.ts";
import {asset,db,putAsset} from "../db.ts";
import {mirrorPrivatePaidVideo,paidR2ByteRange} from "../cloud-paid-video.ts";

/** Public customer video metadata describes the *delivered* timeline, not
 * the slowed provider input charged at Checkout. Legacy (no-tempo) orders
 * remain unchanged; corrupt tempo metadata fails closed before registration.
 * This does not modify a historical delivery or the provider cost basis.
 */
export function deliveredPaidVideoDurationSeconds(media:{durationSeconds:number;tempo?:{rate:number;originalDuration:number}}):number{
 const seconds=media.tempo?.originalDuration??media.durationSeconds;
 if(!Number.isFinite(seconds)||seconds<5||seconds>300)
  throw Error("Invalid restored customer video duration");
 if(media.tempo && (media.tempo.rate!==0.9||
    !Number.isFinite(media.durationSeconds)||media.durationSeconds<5||
    media.durationSeconds>300||
    Math.abs(media.durationSeconds*0.9-seconds)>0.2))
  throw Error("Customer tempo duration differs from reviewed original");
 return seconds;
}

export type PaidDeliveryStage = "source"|"provider-download"|"provider-validation"|"tempo-restoration"|"private-archive";
export type PaidDeliveryDiagnosticStage = PaidDeliveryStage |
 "provider-host"|"provider-dns"|"provider-network"|"provider-http"|
 "provider-headers"|"provider-private-file"|"provider-media"|
 "provider-media-format"|"provider-media-codec"|"provider-media-dimensions"|
 "provider-media-duration"|"provider-media-framerate"|"provider-media-normalization";
export function classifyPaidDeliveryFailure(stage:PaidDeliveryStage,error:unknown):PaidDeliveryDiagnosticStage {
 if(stage!=="provider-download" || !(error instanceof Error))return stage;
 // Only fixed codes reach logs. Never log a provider URL, task ID,
 // signed query string, private path, status body or exception message.
 switch(error.message){
  case "Provider output URL is invalid.":
  case "Provider output URL is not an approved HTTPS download destination.":
   return "provider-host";
  case "Provider output DNS resolution failed or timed out.":
  case "Provider output DNS destination is not public.":
   return "provider-dns";
  case "Provider output connection failed or timed out.":
  case "Provider output transfer failed or timed out.":
   return "provider-network";
  case "Provider output HTTP status rejected; redirects are forbidden.":
  case "Provider download did not return a complete file.":
   return "provider-http";
  case "Provider output length/encoding is invalid or too large.":
  case "Provider output length did not match.":
   return "provider-headers";
  case "Cannot create private provider output file.":
   return "provider-private-file";
  default:
   // Only recognized constant validation codes; no ffprobe or FFmpeg stderr,
   // output paths, signed URLs or customer filenames are disclosed.
   if(error.message==="OUTPUT_FORMAT_INVALID")return "provider-media-format";
   if(error.message==="OUTPUT_CODEC_MISMATCH"||error.message==="OUTPUT_STREAM_MISSING")return "provider-media-codec";
   if(error.message==="OUTPUT_FRAMERATE_MISMATCH")return "provider-media-framerate";
   if(error.message==="OUTPUT_DURATION_MISMATCH")return "provider-media-duration";
   if(error.message==="OUTPUT_NORMALIZATION_POLICY_REJECTED"||
      error.message==="OUTPUT_NORMALIZATION_TIMING_FAILED"||
      error.message==="OUTPUT_NORMALIZATION_AUDIO_CHANGED")return "provider-media-normalization";
   if(error.message==="OUTPUT_DIMENSIONS_MISMATCH"||
      /^OUTPUT_DIMENSIONS_MISMATCH_ACTUAL_\d+x\d+_EXPECTED_(?:\d+x\d+|720P)$/.test(error.message))
    return "provider-media-dimensions";
   // Unknown failures remain a generic fixed category.
   return "provider-media";
 }
}
export class PaidDeliveryStageError extends Error {
 readonly stage:PaidDeliveryDiagnosticStage;
 constructor(stage:PaidDeliveryDiagnosticStage) {
  super("Private paid delivery stage failed");
  this.stage=stage;
 }
}
async function deliveryStage<T>(stage:PaidDeliveryStage, action:()=>Promise<T>):Promise<T>{
 try{return await action();}catch(error){throw new PaidDeliveryStageError(classifyPaidDeliveryFailure(stage,error));}
}

/** Trusted worker only; never call from a browser route.
 * A completed BytePlus task is still not a customer delivery until the private
 * MP4 has passed validation, ownership is recorded and fulfillment is committed. */
export async function deliverReviewedPaidVideo(
 store:CommerceStore,
 orderId:string,
 providerUrl:string,
 dataDir:string,
 contract:OutputValidationContract,
 transport?:OutputTransport,
):Promise<"delivered"|"already-delivered">{
 if(!/^[a-f0-9-]{36}$/.test(orderId))throw Error("Invalid paid order reference");
 const order=store.db.prepare("SELECT account_id,status,guest_hash FROM customer_orders WHERE id=?").get(orderId) as
   {account_id:string|null;status:string;guest_hash:string|null}|undefined;
 const guestOwner=!order?.account_id?store.guestMediaOwner(orderId):null;
 if(!order||order.status!=="paid"||(!order.account_id&&(!order.guest_hash||!guestOwner)))
  throw Error("Paid customer order required");
 const queue=store.db.prepare("SELECT state FROM customer_fulfillment_queue WHERE order_id=?").get(orderId) as {state:string}|undefined;
 if(queue?.state==="delivered")return "already-delivered";
 if(queue?.state!=="processing"||store.paidProviderJob(orderId)?.provider!=="byteplus")
  throw Error("Acknowledged, claimed BytePlus job required");
 const media=store.paidPreparedMedia(orderId);
 // The final format is an immutable, server-reviewed property of THIS paid
 // order, not a global BytePlus policy or a client query parameter.
 const output =
  media.outputFormat==="9:16" ? {width:720,height:1280} :
  media.outputFormat==="16:9" ? {width:1280,height:720} :
  media.outputFormat==="custom" && media.customOutput &&
   Number.isInteger(media.customOutput.width) &&
   Number.isInteger(media.customOutput.height) &&
   Math.min(media.customOutput.width,media.customOutput.height)===720 &&
   Math.max(media.customOutput.width,media.customOutput.height)<=1280 &&
   media.customOutput.width%2===0 && media.customOutput.height%2===0
   ? media.customOutput : null;
 if (media.outputFormat==="custom"&&!output)
   throw Error("Custom order lacks server-reviewed export dimensions");
 if(output)contract={...contract,output:{...contract.output,...output}};
 const root=path.join(dataDir,"media");
 await mkdir(root,{recursive:true,mode:0o700});
 const file=path.join(root,`paid-${orderId}.mp4`);
 const limits=outputTransferLimits(contract);
 const hasDelivery=!!store.db.prepare("SELECT 1 FROM customer_video_deliveries WHERE order_id=?").get(orderId);
 let existing=false;
 try{
  const info=await lstat(file);
  // An interrupted worker may leave a fully validated output. Do not overwrite
  // it or trust it blindly: reject links, misplaced files and out-of-policy sizes.
  if(!info.isFile()||info.nlink!==1||(info.mode & 0o077)!==0||
     info.size<1||info.size>limits.maxBytes||
     await realpath(file)!==file)
   throw Error("Existing output requires operator reconciliation");
  existing=true;
 }catch(error){
  if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;
 }
 if(existing){
  // Recovery of a validated final output must never submit another paid job.
  if(media.tempo){
   await deliveryStage("source",()=>verifyPrivatePaidMediaSnapshot(media));
   await deliveryStage("tempo-restoration",()=>validateRestored(file,media,contract));
  }else await deliveryStage("provider-validation",()=>validateOutput(file,media.durationSeconds,contract));
 }else{
  if(hasDelivery)throw Error("Previously recorded delivery is missing its private file");
  if(media.tempo){
   await deliveryStage("source",()=>verifyPrivatePaidMediaSnapshot(media));
   // Retain an already downloaded and validated provider response on failure:
   // restoration can then recover without a new signed URL or paid task.
   const providerFile=path.join(root,`paid-${orderId}.provider-source.mp4`);
   const restored=path.join(root,`paid-${orderId}.restoring.mp4`);
   try{
    const info=await lstat(providerFile);
    if(!info.isFile()||info.nlink!==1||(info.mode&0o077)!==0||
       info.size<1||info.size>limits.maxBytes||
       await realpath(providerFile)!==providerFile)
      throw Error("Existing customer provider capture requires operator review");
    await deliveryStage("provider-validation",()=>validateOutput(providerFile,media.durationSeconds,contract));
   }catch(error){
    if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;
    await deliveryStage("provider-download",()=>downloadValidatedOutput(providerUrl,providerFile,media.durationSeconds,contract,transport));
   }
   // All frames are retimed, original MP3 packets copied unchanged, and both
   // streams fully validated BEFORE the deliverable file becomes visible.
   await deliveryStage("tempo-restoration",()=>restoreTempoOutput(providerFile,restored,media,contract));
   await rename(restored,file);
   await unlink(providerFile).catch(()=>{});
  }else await deliveryStage("provider-download",()=>downloadValidatedOutput(providerUrl,file,media.durationSeconds,contract,transport));
 }
 const details=await stat(file);
 const assetId=`customer-video-${orderId}`;
 const owner=order.account_id?`customer-${order.account_id}`:guestOwner!;
 const prior=db.prepare("SELECT 1 FROM assets WHERE id=?").get(assetId);
 if(prior){
  const stored=asset(assetId,owner);
  if(stored.path!==file||stored.kind!=="video"||stored.mime!=="video/mp4"||
     stored.bytes!==details.size)
   throw Error("Existing private media reference requires operator reconciliation");
 }else{
  putAsset({id:assetId,owner,kind:"video",
   name:"singmotion.mp4",path:file,mime:"video/mp4",bytes:details.size,
   duration:deliveredPaidVideoDurationSeconds(media),width:null,height:null,created:Date.now()});
 }
 // The R2 copy is strictly optional outside protected staging; when enabled,
 // a delivered receipt must never point at an unverified remote archive.
 const accountId=order.account_id??orderId;
 const cloud=await deliveryStage("private-archive",()=>mirrorPrivatePaidVideo(accountId,orderId,file,details.size));
 if(cloud){
  // The output is not downloadable until we have reread and SHA-256 verified
  // the full private R2 object. HEAD metadata alone is insufficient.
  const body=await paidR2ByteRange(accountId,orderId,cloud,0,cloud.bytes-1);
  const reader=body.getReader();
  const digest=createHash("sha256");
  let size=0;
  try{
   while(true){
    const result=await reader.read();
    if(result.done)break;
    size+=result.value.byteLength;
    if(size>cloud.bytes)throw Error("Cloud paid output exceeded validated size");
    digest.update(result.value);
   }
  }finally{reader.releaseLock()}
  if(size!==cloud.bytes||digest.digest("hex")!==cloud.sha256)
   throw Error("Cloud paid video content verification failed");
  store.db.exec("CREATE TABLE IF NOT EXISTS cloud_paid_videos(order_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,key TEXT UNIQUE NOT NULL,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,created INTEGER NOT NULL)");
  const previous=store.db.prepare("SELECT key,sha256,bytes FROM cloud_paid_videos WHERE order_id=? AND account_id=?").get(orderId,accountId) as {key:string;sha256:string;bytes:number}|undefined;
  if(previous && (previous.key!==cloud.key||previous.sha256!==cloud.sha256||previous.bytes!==cloud.bytes))
   throw Error("Paid R2 archive requires operator reconciliation");
  if(!previous)store.db.prepare("INSERT INTO cloud_paid_videos(order_id,account_id,key,sha256,bytes,created) VALUES(?,?,?,?,?,?)").run(orderId,accountId,cloud.key,cloud.sha256,cloud.bytes,Date.now());
 }
 const evidence=`private-validated-byteplus-output:${orderId}:${details.size}`;
 store.recordPaidVideoDelivery(orderId,assetId,evidence);
 if(!store.finalizePaidFulfillment(orderId,{state:"delivered",deliveryEvidence:evidence}))
  throw Error("Paid fulfillment transition unavailable");
 if(cloud){
  // The local MP4 is only a temporary post-validation artifact. All customer
  // playback is owner-verified and can stream a private range from R2.
  await unlink(file).catch(()=>{});
 }
 return "delivered";
}
