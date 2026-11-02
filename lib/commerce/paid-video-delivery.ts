import {mkdir,stat} from "node:fs/promises";
import path from "node:path";
import {CommerceStore} from "./store.ts";
import {downloadValidatedOutput,type OutputValidationContract} from "../live/output.ts";
import type {OutputTransport} from "../live/output-transport.ts";
import {putAsset} from "../db.ts";

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
 // A verified local file may remain after a crash between download and DB commit.
 // Never overwrite or trust it without revalidation; retain for operator review.
 // Exclusive create in downloadValidatedOutput prevents silent replacement.
 await downloadValidatedOutput(providerUrl,file,media.durationSeconds,contract,transport);
 const details=await stat(file);
 const assetId=`customer-video-${orderId}`;
 const existing=store.db.prepare("SELECT 1 FROM customer_video_deliveries WHERE order_id=?").get(orderId);
 if(existing)throw Error("Existing private delivery requires operator reconciliation");
 putAsset({id:assetId,owner:`customer-${order.account_id}`,kind:"video",
  name:"singmotion.mp4",path:file,mime:"video/mp4",bytes:details.size,
  duration:media.durationSeconds,width:null,height:null,created:Date.now()});
 const evidence=`private-validated-byteplus-output:${orderId}:${details.size}`;
 store.recordPaidVideoDelivery(orderId,assetId,evidence);
 if(!store.finalizePaidFulfillment(orderId,{state:"delivered",deliveryEvidence:evidence}))
  throw Error("Paid fulfillment transition unavailable");
 return "delivered";
}
