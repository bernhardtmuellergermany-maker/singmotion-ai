import {CommerceStore} from "./store.ts";
import {recoverReviewedPaidOutput} from "./paid-output-recovery.ts";
import {deliverReviewedPaidVideo} from "./paid-video-delivery.ts";
import type {Transport} from "../live/byteplus.ts";
import type {OutputTransport} from "../live/output-transport.ts";
import type {OutputValidationContract} from "../live/output.ts";

/** Explicit trusted-worker composition. No scheduler, public route, submission,
 * or automatic provider spending is created by importing this function. */
export async function recoverAndDeliverPaidCustomerVideo(
 store:CommerceStore,
 orderId:string,
 dataDir:string,
 contract:OutputValidationContract,
 statusTransport:Transport,
 outputTransport:OutputTransport,
 signal:AbortSignal,
){
 return recoverReviewedPaidOutput(store,orderId,statusTransport,signal,
  (id,url)=>deliverReviewedPaidVideo(store,id,url,dataDir,contract,outputTransport));
}
