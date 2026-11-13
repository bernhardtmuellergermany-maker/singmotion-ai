/** Explicit trusted worker composition for customer-owned paid BytePlus orders.
 * No routes, deployment, secrets, billing shortcuts or automatic dispatch loop.
 * The caller supplies a verified per-account private R2 lease adapter.
 */
import {CommerceStore} from "./store.ts";
import {productionCustomerReleaseApproved} from "./customer-live-config.ts";
import {assessProductionSandboxPilot} from "./customer-sandbox-pilot-policy.ts";
import {protectedProductionLivePilotApproved} from "./protected-production-live-pilot.ts";
import {submitReviewedPaidVideo} from "./paid-video-worker.ts";
import {planUpperBoundMicroUsd,contractDigest,type VerifiedContract} from "../live/contract.ts";
import {BytePlusProtocol,submitPreparedInputs,type PrivateInputDelivery} from "../live/byteplus.ts";
import {inputDeliveryPolicy} from "../live/input-policy.ts";
import type {PreparedMedia} from "../live/store.ts";

export type CustomerBytePlusDispatch={
 contract:VerifiedContract;
 delivery:PrivateInputDelivery;
 inputHosts:readonly string[];
 protocol:BytePlusProtocol;
 dailyCapMicroUsd:number;
 lifetimeCapMicroUsd:number;
 reviewEvidence:string;
 signal:AbortSignal;
 /** Independent immutable private-media revalidation, required. */
 verify:(media:PreparedMedia)=>Promise<void>;
};

/** Validates REAL inclusive rules. Pilot uplift/unknown taxes are prohibited. */
export function reviewedCustomerBytePlusCost(media:PreparedMedia,review:CustomerBytePlusDispatch){
 const contract=review.contract;
 if(contract.pilotAdmission || contract.model!=="OmniHuman 2.0"||
    (!!media.prompt.trim() && !contract.promptSupported) ||
    contract.inputFetchWindowSeconds!==inputDeliveryPolicy.minimumRemainingSeconds ||
    !Array.isArray(contract.outputHosts)||contract.outputHosts.length<1||
    !contract.output.transfer || !contract.output.transfer.evidence?.trim() ||
    !review.reviewEvidence?.trim() || review.reviewEvidence.length<20 ||
    !review.inputHosts.length ||
    review.inputHosts.some(host=>!/^[-a-z0-9.]+$/.test(host)) ||
    !contract.generatedDurationBound?.evidence?.trim())
  throw Error("Verified inclusive customer BytePlus contract required");
 const cost=planUpperBoundMicroUsd(media.durationSeconds,contract);
 if(!Number.isSafeInteger(cost)||cost<1||cost>1_000_000_000)
  throw Error("Invalid reviewed provider cost");
 return {
  inclusiveMaxMicroUsd:cost,
  dailyCapMicroUsd:review.dailyCapMicroUsd,
  lifetimeCapMicroUsd:review.lifetimeCapMicroUsd,
  reviewEvidence:`customer-byteplus-v1:${contractDigest(contract)}:${review.reviewEvidence}`,
 };
}

/** Staging-only explicit invocation. A paid receipt, authenticated owner,
 * immutable media, reviewed cost and private lease are prerequisites.
 * This does not turn on a customer-facing production route.
 */
export async function dispatchReviewedCustomerBytePlus(
 store:CommerceStore,
 orderId:string,
 review:CustomerBytePlusDispatch,
 env:Record<string,string|undefined>=process.env,
){
 if((env.RAILWAY_ENVIRONMENT_ID!=="dfaeabed-03df-43ed-aa71-50f343a75041" &&
     !productionCustomerReleaseApproved(env) && !assessProductionSandboxPilot(env).ready &&
     !protectedProductionLivePilotApproved(env)) ||
    env.CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED!=="true")
  throw Error("Customer provider dispatch not authorized for this environment");
 const order=store.db.prepare("SELECT account_id,status,guest_hash FROM customer_orders WHERE id=?")
  .get(orderId) as {account_id:string|null;status:string;guest_hash:string|null}|undefined;
 const owner=order?.account_id?`customer-${order.account_id}`:store.guestMediaOwner(orderId);
 if(!order||order.status!=="paid"||!owner||(!order.account_id&&!order.guest_hash))
  throw Error("Paid authenticated account or reviewed guest order required");
 if(!store.hasEarlyPerformanceConsent(orderId))throw Error("Early performance acknowledgement missing");
 if(!store.hasContractConfirmation(orderId))throw Error("Durable contract confirmation missing");
 if(review.signal.aborted)throw Error("Provider submission aborted");
 return submitReviewedPaidVideo(store,orderId,{
  verify:review.verify,
  providerCost:(media)=>{
   if(media.owner!==owner)
    throw Error("Customer media owner mismatch");
   return reviewedCustomerBytePlusCost(media,review);
  },
  submit:async(media)=>{
   // No automatic retry is allowed if the provider accepts a request but
   // loses the response; the durable submission barrier is already present.
   const response=await submitPreparedInputs(media,review.delivery,
    review.inputHosts,review.contract.inputFetchWindowSeconds,
    review.protocol,review.signal);
   return response.jobId;
  },
 });
}
