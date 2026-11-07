import {test} from "node:test";
import assert from "node:assert/strict";
import {hobbyInvoicePaidThrough} from "../lib/commerce/stripe-hobby-invoice.ts";
const price="price_1UYKjSBAVolbZIfAeeyiF1lx";
const period=1794000000000;
const end=period/1000;
const line=(part:Record<string,unknown>)=>({period:{end},...part});
const invoice=(lines:unknown[],extra:Record<string,unknown>={})=>({
 paid:true,status:"paid",lines:{data:lines},...extra
});
test("modern Endive pricing.price_details.price enables verified paid Hobby period",()=>{
 assert.equal(hobbyInvoicePaidThrough(invoice([line({pricing:{
   type:"price_details",price_details:{price}}})]),price,period),true);
 assert.equal(hobbyInvoicePaidThrough(invoice([line({pricing:{
   type:"price_details",price_details:{price:{id:price}}}})]),price,period),true);
});
test("historic Stripe test invoice price shape remains supported",()=>{
 assert.equal(hobbyInvoicePaidThrough(invoice([line({price:{id:price}})]),price,period),true);
 assert.equal(hobbyInvoicePaidThrough(invoice([line({price})]),price,period),true);
});
test("do not activate Hobby for unpaid or void invoices even with correct price",()=>{
 for(const patch of [{paid:false},{status:"open"},{status:"void"},{paid:null}]){
  assert.equal(hobbyInvoicePaidThrough(invoice([line({pricing:{type:"price_details",price_details:{price}}})],patch),price,period),false);
 }
});
test("wrong price, malformed pricing and wrong billing period cannot activate Hobby",()=>{
 const cases=[
  line({pricing:{type:"price_details",price_details:{price:"price_else"}}}),
  line({pricing:{type:"metered",price_details:{price}}}),
  line({pricing:{type:"price_details",price_details:{}}}),
  line({pricing:{type:"price_details",price_details:{price}},period:{end:end-1}}),
  line({pricing:{type:"price_details",price_details:{price}},period:{end:"invalid"}}),
  line({price:{id:price},pricing:{type:"other",price_details:{price:"price_else"}}}),
  line({price:{id:price},pricing:{type:"price_details",price_details:{price:"price_other"}}}),
 ];
 for(const l of cases)assert.equal(hobbyInvoicePaidThrough(invoice([l]),price,period),false);
});
test("missing invoice, empty lines and invalid expected IDs fail closed",()=>{
 const good=invoice([line({pricing:{type:"price_details",price_details:{price}}})]);
 assert.equal(hobbyInvoicePaidThrough(undefined,price,period),false);
 assert.equal(hobbyInvoicePaidThrough({paid:true,status:"paid"},price,period),false);
 assert.equal(hobbyInvoicePaidThrough(invoice([]),price,period),false);
 assert.equal(hobbyInvoicePaidThrough(good,"price_wrong!",period),false);
 assert.equal(hobbyInvoicePaidThrough(good,price,0),false);
 assert.equal(hobbyInvoicePaidThrough(good,price,NaN),false);
});
