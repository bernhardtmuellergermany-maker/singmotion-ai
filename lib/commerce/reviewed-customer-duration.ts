/** The same verified duration envelope must be used for guest/account
 * preparation and the paid BytePlus worker. A public quote or UI selector
 * must never allow a charge for a duration the worker cannot accept.
 */
import {loadCustomerWorkerPolicy} from "./customer-paid-worker.ts";
import {ownerConfirmedBytePlusPolicy} from "./owner-confirmed-provider-policy.ts";

export async function reviewedCustomerOrderMaxSeconds(
 root:string,
 env:Record<string,string|undefined>=process.env,
):Promise<number>{
 const policy=await loadCustomerWorkerPolicy(root,env);
 const bound=policy.contract.generatedDurationBound;
 if(!bound||!Number.isFinite(bound.maxInputSeconds)||
    bound.maxInputSeconds<5||bound.maxInputSeconds>300||
    bound.maxInputSeconds+bound.maxAdditionalSeconds>300)
  throw Error("Reviewed BytePlus duration envelope unavailable");
 return bound.maxInputSeconds;
}

/** Read-only estimate must not advertise an unreviewed interval. */
export function stagingOwnerConfirmedSeconds():number{
 return ownerConfirmedBytePlusPolicy().contract.generatedDurationBound!.maxInputSeconds;
}
