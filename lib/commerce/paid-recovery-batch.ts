import {CommerceStore} from "./store.ts";
import {recoverAndDeliverPaidCustomerVideo} from "./paid-customer-recovery.ts";
import {PaidDeliveryStageError} from "./paid-video-delivery.ts";
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
 const results: {orderId:string;state:string;diagnostic?:PaidRecoveryDiagnostic|"private_output_validation_failed"|`private_${PaidDeliveryDiagnosticStage}_failed`}[]=[];
 for(const orderId of ids){
  if(signal.aborted)break;
  try{
   let diagnostic:PaidRecoveryDiagnostic|undefined;
   const state=await recoverAndDeliverPaidCustomerVideo(store,orderId,dataDir,contract,statusTransport,outputTransport,signal,
    reason=>{diagnostic=reason;});
   results.push({orderId,state,...(diagnostic?{diagnostic}:{})});
  }catch(error){
   // Fixed-stage diagnostic only: never log provider URLs, raw errors, private
   // paths, Task IDs or customer data. No re-submission is ever attempted.
   const diagnostic=error instanceof PaidDeliveryStageError
    ? `private_${error.stage}_failed` as const : "private_output_validation_failed" as const;
   results.push({orderId,state:"requires-review",diagnostic});
  }
 }
 return results;
}
