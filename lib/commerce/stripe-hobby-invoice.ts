/** Check a paid Hobby invoice against a real subscription billing period.
 * Stripe 2025-03-31.basil removed invoice line price in favour of
 * pricing.price_details.price; newer versions may expand that Price.
 * This performs no network operation and never assumes a payment was made.
 */
type PriceReference=string|{id?:unknown}|null|undefined;
type InvoiceLine={
 price?:PriceReference;
 pricing?:{type?:unknown;price_details?:{price?:PriceReference}|null}|null;
 period?:{end?:unknown}|null;
};
type PaidInvoice={
 paid?:unknown;status?:unknown;
 lines?:{data?:unknown[]}|null;
}|null|undefined;
function priceId(value:PriceReference):string|null {
 if(typeof value==="string")return value;
 if(value&&typeof value==="object"&&typeof value.id==="string")return value.id;
 return null;
}
export function hobbyInvoicePaidThrough(invoice:PaidInvoice,expectedPriceId:string,periodEndMs:number):boolean {
 if(!invoice||invoice.paid!==true||invoice.status!=="paid"||
    !/^price_[A-Za-z0-9_]+$/.test(expectedPriceId)||
    !Number.isSafeInteger(periodEndMs)||periodEndMs<=0)return false;
 if(!Array.isArray(invoice.lines?.data))return false;
 return invoice.lines.data.some(line=>{
   if(!line||typeof line!=="object")return false;
   // Stripe JSON must be checked at runtime before accessing nested fields.
   const item=line as InvoiceLine;
   const pricing=item.pricing;
   if(pricing && typeof pricing!=="object")return false;
   // Never treat a pricing.type other than price_details as the correct plan.
   const matched=pricing?
     pricing.type==="price_details"&&
     priceId(pricing.price_details?.price)===expectedPriceId:
     priceId(item.price)===expectedPriceId;
   const endSeconds=item.period?.end;
   return matched&&typeof endSeconds==="number"&&
     Number.isSafeInteger(endSeconds)&&endSeconds>0&&
     endSeconds*1000>=periodEndMs;
 });
}
