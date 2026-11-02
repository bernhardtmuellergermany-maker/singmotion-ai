import {CommerceStore} from "./store.ts";
import {recoverAndDeliverPaidCustomerVideo} from "./paid-customer-recovery.ts";
import type {Transport} from "../live/byteplus.ts";
import type {OutputTransport} from "../live/output-transport.ts";
import type {OutputValidationContract} from "../live/output.ts";

/** One explicit, bounded recovery batch. Never submits or retries a BytePlus
 * generation. Each order is independently isolated so one failed retrieval
 * does not prevent inspection of other acknowledged paid tasks. */
export async function runPaidRecoveryBatch(
 store:CommerceStore,
 dataDir:string,
 contract:OutputValidationContract,
 statusTransport:Transport,
 outputTransport:OutputTransport,
 signal:AbortSignal,
 limit=10,
){
 const ids=store.acknowledgedPaidRecovery(limit);
 const results: {orderId:string;state:string}[]=[];
 for(const orderId of ids){
  if(signal.aborted)break;
  try{
   const state=await recoverAndDeliverPaidCustomerVideo(store,orderId,dataDir,contract,statusTransport,outputTransport,signal);
   results.push({orderId,state});
  }catch{
   // Keep payment, provider claim and output untouched for operator review.
   results.push({orderId,state:"requires-review"});
  }
 }
 return results;
}
