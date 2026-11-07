import assert from "node:assert/strict";
import test from "node:test";
import {stripeVideoCheckoutLineItem,stripeVideoCheckoutIdempotencyKey,SINGMOTION_VIDEO_TAX_CODE} from "../lib/commerce/stripe-video-checkout-line-item.ts";
test("Stripe Checkout includes verified downloadable music-video tax code for Managed Payments",()=>{
 const line=stripeVideoCheckoutLineItem(125);
 assert.equal(line["line_items[0][price_data][product_data][tax_code]"],"txcd_10402100");
 assert.equal(SINGMOTION_VIDEO_TAX_CODE,"txcd_10402100");
 assert.equal(line["line_items[0][price_data][unit_amount]"],"125");
 assert.equal(line["line_items[0][price_data][tax_behavior]"],"inclusive");
 assert.equal(line["line_items[0][price_data][currency]"],"eur");
 assert.equal(line["line_items[0][quantity]"],"1");
 const encoded=new URLSearchParams(line);
 assert.equal(encoded.get("line_items[0][price_data][product_data][tax_code]"),"txcd_10402100");
});
test("rejects zero, negative or invalid amounts before Stripe request",()=>{
 for(const cents of [0,-1,1.3,NaN,Infinity])
  assert.throws(()=>stripeVideoCheckoutLineItem(cents),/Invalid positive Stripe checkout amount/);
});

test("updated Stripe request key is stable per order and bypasses cached legacy invalid request",()=>{
 const id="123e4567-e89b-12d3-a456-426614174000";
 const key=stripeVideoCheckoutIdempotencyKey(id);
 assert.equal(key,"singmotion-checkout-tax-v2-"+id);
 assert.notEqual(key,"singmotion-checkout-"+id);
 assert.equal(stripeVideoCheckoutIdempotencyKey(id),key);
 assert.throws(()=>stripeVideoCheckoutIdempotencyKey("untrusted"));
});
