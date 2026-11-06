import {CommerceStore} from "./store.ts";
import {BytePlusProtocol,BytePlusError} from "../live/byteplus.ts";
import type {Transport} from "../live/byteplus.ts";

export type PaidRecoveryDiagnostic =
 "provider_status_unavailable"|"provider_authentication"|"provider_throttled"|
 "provider_transient"|"provider_protocol"|"provider_rejected"|
 "provider_unsupported_status"|"provider_completed_without_url"|
 "provider_noncompletion"|"provider_done_missing_output";

export function paidRecoveryFailureCategory(error:unknown):PaidRecoveryDiagnostic {
 if(!(error instanceof BytePlusError))return "provider_status_unavailable";
 switch(error.diagnostic.code) {
  case "TRANSPORT_AUTHENTICATION": return "provider_authentication";
  case "TRANSPORT_THROTTLED": return "provider_throttled";
  case "TRANSPORT_TRANSIENT": return "provider_transient";
  case "TRANSPORT_PROTOCOL": return "provider_protocol";
  case "PROVIDER_REJECTED": return "provider_rejected";
  case "UNSUPPORTED_TASK_STATUS": return "provider_unsupported_status";
  case "COMPLETED_WITHOUT_VIDEO_URL": return "provider_completed_without_url";
  default: return "provider_status_unavailable";
 }
}

/** Trusted-worker bridge. Only an acknowledged, claimed paid task is eligible.
 * Never submits or retries a BytePlus task. A completed response is delivered
 * only through a separately injected private validation/ingestion operation. */
export async function recoverReviewedPaidOutput(
 store:CommerceStore,
 orderId:string,
 transport:Transport,
 signal:AbortSignal,
 deliver:(orderId:string,providerUrl:string)=>Promise<"delivered"|"already-delivered">,
 onDiagnostic?:(reason:PaidRecoveryDiagnostic)=>void,
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
 catch(error){onDiagnostic?.(paidRecoveryFailureCategory(error));return "unverified";}
 if(result.status==="in_queue"||result.status==="generating")return "pending";
 if(result.status!=="done"){
  onDiagnostic?.("provider_noncompletion");
  return "unverified";
 }
 if(!result.outputUrl){
  onDiagnostic?.("provider_done_missing_output");
  return "unverified";
 }
 return deliver(orderId,result.outputUrl);
}
