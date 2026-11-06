import assert from "node:assert/strict";
import test from "node:test";
import {sanitizedStripeCheckoutError} from "../lib/commerce/stripe-error-diagnostics.ts";
test("reads safe Stripe type, code and parameter only",()=>{
 assert.deepEqual(sanitizedStripeCheckoutError({error:{type:"invalid_request_error",code:"parameter_unknown",param:"line_items[0][price_data][tax_behavior]",message:"Private email secret"}}),{
  type:"invalid_request_error",code:"parameter_unknown",param:"line_items[0][price_data][tax_behavior]"
 });
});
test("never exposes error messages or untrusted parameter content",()=>{
 assert.deepEqual(sanitizedStripeCheckoutError({error:{message:"secret key and email",param:"user@example.com",code:"x".repeat(200)}}),{type:null,code:null,param:null});
 assert.deepEqual(sanitizedStripeCheckoutError(null),{type:null,code:null,param:null});
});
