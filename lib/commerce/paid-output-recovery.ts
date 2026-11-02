import {CommerceStore} from "./store.ts";
import {BytePlusProtocol} from "../live/byteplus.ts";
import type {Transport} from "../live/byteplus.ts";

/** Trusted-worker bridge. Only an acknowledged, claimed paid task is eligible.
 * Never submits or retries a BytePlus task. A completed response is delivered
 * only through a separately injected private validation/ingestion operation. */
export async function recoverReviewedPaidOutput(
 store:CommerceStore,
 orderId:string,
 transport:Transport,
 signal:AbortSignal,
 deliver:(orderId:string,providerUrl:string)=>Promise<"delivered"|"already-delivered">,
):Promise<"awaiting-job"|"pending"|"unverified"|"delivered"|"already-delivered">{
 if(!/^[a-f0-9-]{36}$/.test(orderId))throw Error("Invalid order reference");
 const order=store.db.prepare("SELECT status FROM customer_orders WHERE id=?").get(orderId) as {status:string}|undefined;
 const queue=store.db.prepare("SELECT state FROM customer_fulfillment_queue WHERE order_id=?").get(orderId) as {state:string}|undefined;
 if(queue?.state==="delivered")return "already-delivered";
 if(order?.status!=="paid"||queue?.state!=="processing")return "awaiting-job";
 const job=store.paidProviderJob(orderId);
 if(!job||job.provider!=="byteplus")return "awaiting-job";
 let result:Awaited<ReturnType<BytePlusProtocol["status"]>>;
 try{result=await new BytePlusProtocol(transport).status(job.jobId,signal);}
 catch{return "unverified";}
 if(result.status==="in_queue"||result.status==="generating")return "pending";
 if(result.status!=="done"||!result.outputUrl)return "unverified";
 return deliver(orderId,result.outputUrl);
}
