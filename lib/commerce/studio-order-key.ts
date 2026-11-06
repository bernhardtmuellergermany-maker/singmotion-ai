import {createHash} from "node:crypto";

/** A project can have multiple reviewed selections, but a retry of the same
 * selection, promotion and account must reuse the same checkout order.
 * Never expose this private idempotency key to Stripe or another account. */
export function reviewedCustomerOrderKey(input:{
 accountId:string;projectId:string;draft:unknown;promoCode?:string;
}):string{
 const hash=createHash("sha256");
 for(const part of ["customer-studio-order-v2",input.accountId,input.projectId,
                    JSON.stringify(input.draft),input.promoCode?.trim().toUpperCase()||""]){
  hash.update(String(Buffer.byteLength(part))).update(":").update(part);
 }
 return hash.digest("hex");
}
