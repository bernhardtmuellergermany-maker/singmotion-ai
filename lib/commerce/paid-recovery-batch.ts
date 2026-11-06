import {CommerceStore} from "./store.ts";
import {recoverAndDeliverPaidCustomerVideo} from "./paid-customer-recovery.ts";
import type {PaidRecoveryDiagnostic} from "./paid-output-recovery.ts";
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
 if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
  throw new Error("Invalid recovery batch size");
 if (signal.aborted) return [];
 const ids=store.acknowledgedPaidRecovery(limit);
 const results: {orderId:string;state:string;diagnostic?:PaidRecoveryDiagnostic|"private_output_validation_failed"}[]=[];
 for(const orderId of ids){
  if(signal.aborted)break;
  try{
   let diagnostic:PaidRecoveryDiagnostic|undefined;
   const state=await recoverAndDeliverPaidCustomerVideo(store,orderId,dataDir,contract,statusTransport,outputTransport,signal,
    reason=>{diagnostic=reason;});
   results.push({orderId,state,...(diagnostic?{diagnostic}:{})});
  }catch{
   // Keep payment, provider claim and output untouched for operator review.
   results.push({orderId,state:"requires-review",diagnostic:"private_output_validation_failed"});
  }
 }
 return results;
}
