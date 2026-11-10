/** Separate the buyer of a paid order from an unrelated customer session.
 * A signed-in user may still own a guest order through an independent
 * capability. Never infer ownership from merely being signed in or from email.
 */
import type {CommerceStore} from "./store.ts";

export type VideoCheckoutOwner=
 | {kind:"account";accountId:string;order:Record<string,unknown>}
 | {kind:"guest";guestToken:string;order:Record<string,unknown>};

export function resolveVideoCheckoutOwner(
 store:CommerceStore,orderId:string,accountId:string|null,guestToken:string|undefined
):VideoCheckoutOwner{
 if(accountId){
  try{
   const accountOrder=store.ownedOrder(orderId,accountId);
   if(accountOrder.account_id===accountId){
    if(!store.emailVerified(accountId))throw Error("Email not verified");
    return {kind:"account",accountId,order:accountOrder};
   }
  }catch{/* Independently verify an actual guest capability below. */}
 }
 if(guestToken){
  const order=store.ownedOrder(orderId,null,guestToken);
  if(order.account_id===null && store.guestMediaOwner(orderId))
   return {kind:"guest",guestToken,order};
 }
 throw Error("Verified order owner required");
}
