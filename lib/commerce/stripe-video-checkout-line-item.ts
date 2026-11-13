/** Verified against Stripe Sandbox's Product Tax Code search on 2026-11-06.
 * "Digital Audio Visual Works - downloaded - non subscription - with permanent rights":
 * includes downloadable music videos. The customer retains their exported MP4.
 * Do not substitute a neighboring tax code or disable Managed Payments.
 */
export const SINGMOTION_VIDEO_TAX_CODE="txcd_10402100" as const;

/** LIVE video pricing is VAT-inclusive. Stripe needs the buyer's billing
 * location to calculate the actual tax amount. The account-wide default is
 * not authoritative for this product's immutable EUR quote.
 * Never change Staging TEST Checkout payloads through this helper.
 */
export function stripeVideoCheckoutLiveTaxSettings(mode:"test"|"live"):Record<string,string>{
 return mode==="live" ? {
  "billing_address_collection":"required",
  "automatic_tax[enabled]":"true",
  "tax_id_collection[enabled]":"true",
  "invoice_creation[enabled]":"true",
 } : {};
}

export function stripeVideoCheckoutLineItem(cents:number):Record<string,string>{
 if(!Number.isSafeInteger(cents)||cents<=0)
  throw Error("Invalid positive Stripe checkout amount");
 return {
  "line_items[0][price_data][currency]":"eur",
  "line_items[0][price_data][tax_behavior]":"inclusive",
  "line_items[0][price_data][unit_amount]":String(cents),
  "line_items[0][price_data][product_data][name]":"SingMotion AI music video",
  "line_items[0][price_data][product_data][tax_code]":SINGMOTION_VIDEO_TAX_CODE,
  "line_items[0][quantity]":"1",
 };
}

/** Versioned for Stripe's cached failed 400 response to the previous request
 * without product tax_code. Stable on repeat requests for the same order. */
export function stripeVideoCheckoutIdempotencyKey(orderId:string):string{
 if(!/^[a-f0-9-]{36}$/.test(orderId))
  throw Error("Invalid checkout order reference");
 return `singmotion-checkout-tax-v2-${orderId}`;
}
