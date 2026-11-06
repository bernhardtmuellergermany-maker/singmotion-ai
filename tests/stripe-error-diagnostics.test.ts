import assert from "node:assert/strict";
import test from "node:test";
import {sanitizedStripeCheckoutError} from "../lib/commerce/stripe-error-diagnostics.ts";
test("reads safe Stripe type, code and parameter only",()=>{
 assert.deepEqual(sanitizedStripeCheckoutError({error:{type:"invalid_request_error",code:"parameter_unknown",param:"line_items[0][price_data][tax_behavior]",message:"Private email secret"}}),{
  type:"invalid_request_error",code:"parameter_unknown",param:"line_items[0][price_data][tax_behavior]",category:"line_item"
 });
});
test("never exposes error messages or untrusted parameter content",()=>{
 assert.deepEqual(sanitizedStripeCheckoutError({error:{message:"secret key and email",param:"user@example.com",code:"x".repeat(200)}}),{type:null,code:null,param:null,category:"unclassified"});
 assert.deepEqual(sanitizedStripeCheckoutError(null),{type:null,code:null,param:null});
});

test("classifies code-less Stripe messages without leaking their content",()=>{
 const account=sanitizedStripeCheckoutError({error:{type:"invalid_request_error",message:"Please activate your account before accepting payments: secret@example.com"}});
 assert.deepEqual(account,{type:"invalid_request_error",code:null,param:null,category:"account_not_ready"});
 assert.equal(JSON.stringify(account).includes("secret@example.com"),false);
 const tax=sanitizedStripeCheckoutError({error:{message:"tax_behavior cannot be set for the chosen price"}});
 assert.equal(tax.category,"tax_configuration");
 const unknown=sanitizedStripeCheckoutError({error:{message:"Your private email is jane@example.com"}});
 assert.equal(unknown.category,"unclassified");
});
