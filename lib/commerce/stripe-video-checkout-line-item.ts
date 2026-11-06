/** Verified against Stripe Sandbox's Product Tax Code search on 2026-11-06.
 * "Digital Audio Visual Works - downloaded - non subscription - with permanent rights":
 * includes downloadable music videos. The customer retains their exported MP4.
 * Do not substitute a neighboring tax code or disable Managed Payments.
 */
export const SINGMOTION_VIDEO_TAX_CODE="txcd_10402100" as const;

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
