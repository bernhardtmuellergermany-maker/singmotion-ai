import {mkdir,lstat,realpath,stat} from "node:fs/promises";
import path from "node:path";
import {CommerceStore} from "./store.ts";
import {downloadValidatedOutput,validateOutput,outputTransferLimits,type OutputValidationContract} from "../live/output.ts";
import type {OutputTransport} from "../live/output-transport.ts";
import {asset,db,putAsset} from "../db.ts";

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
 const order=store.db.prepare("SELECT account_id,status FROM customer_orders WHERE id=?").get(orderId) as
   {account_id:string|null;status:string}|undefined;
 if(!order?.account_id||order.status!=="paid")throw Error("Paid customer order required");
 const queue=store.db.prepare("SELECT state FROM customer_fulfillment_queue WHERE order_id=?").get(orderId) as {state:string}|undefined;
 if(queue?.state==="delivered")return "already-delivered";
 if(queue?.state!=="processing"||store.paidProviderJob(orderId)?.provider!=="byteplus")
  throw Error("Acknowledged, claimed BytePlus job required");
 const media=store.paidPreparedMedia(orderId);
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
  // Validation decodes the entire private file again before any DB state change.
  // This enables crash recovery without re-downloading a paid provider output.
  await validateOutput(file,media.durationSeconds,contract);
 }else{
  if(hasDelivery)throw Error("Previously recorded delivery is missing its private file");
  await downloadValidatedOutput(providerUrl,file,media.durationSeconds,contract,transport);
 }
 const details=await stat(file);
 const assetId=`customer-video-${orderId}`;
 const owner=`customer-${order.account_id}`;
 const prior=db.prepare("SELECT 1 FROM assets WHERE id=?").get(assetId);
 if(prior){
  const stored=asset(assetId,owner);
  if(stored.path!==file||stored.kind!=="video"||stored.mime!=="video/mp4"||
     stored.bytes!==details.size)
   throw Error("Existing private media reference requires operator reconciliation");
 }else{
  putAsset({id:assetId,owner,kind:"video",
   name:"singmotion.mp4",path:file,mime:"video/mp4",bytes:details.size,
   duration:media.durationSeconds,width:null,height:null,created:Date.now()});
 }
 const evidence=`private-validated-byteplus-output:${orderId}:${details.size}`;
 store.recordPaidVideoDelivery(orderId,assetId,evidence);
 if(!store.finalizePaidFulfillment(orderId,{state:"delivered",deliveryEvidence:evidence}))
  throw Error("Paid fulfillment transition unavailable");
 return "delivered";
}
