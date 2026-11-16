import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
 assertManagedCreditCheckoutParams,managedCreditMoRApproved,
 managedCreditTaxDecision
} from "../lib/commerce/managed-credit-payments.ts";

const read=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const approved={
 CREDIT_GLOBAL_MERCHANT_OF_RECORD:"stripe-managed",
 STRIPE_MANAGED_PAYMENTS_ACCOUNT_APPROVED:"true",
 STRIPE_MANAGED_PAYMENTS_PREPAID_CREDITS_APPROVED:"true",
 STRIPE_MANAGED_PAYMENTS_LIVE_PRODUCT_REVIEWED:"true",
 STRIPE_CREDIT_TAX_CODE:"txcd_10105003",
};

test("reviewed Managed Payments one-time Credit Checkout contains no forbidden tax or invoice fields",()=>{
 const form=new URLSearchParams({
  mode:"payment","managed_payments[enabled]":"true",
  "line_items[0][price_data][product]":"prod_Vchw1yEak3Xa6k",
  "line_items[0][price_data][unit_amount]":"500",
  "line_items[0][price_data][currency]":"eur",
  "line_items[0][price_data][tax_behavior]":"inclusive",
  billing_address_collection:"required",
  "metadata[creditTaxCountry]":"FR",
 });
 assert.doesNotThrow(()=>assertManagedCreditCheckoutParams(form));
 for(const key of [
  "invoice_creation[enabled]","invoice_creation[invoice_data][footer]",
  "tax_id_collection[enabled]","automatic_tax[enabled]",
  "payment_method_types[0]","excluded_payment_method_types[0]",
  "adaptive_pricing[enabled]","payment_method_configuration",
  "customer_update[address]","shipping_address_collection[allowed_countries][0]",
  "payment_intent_data[statement_descriptor]",
 ]){
  const invalid=new URLSearchParams(form);
  invalid.set(key,"false");
  assert.throws(()=>assertManagedCreditCheckoutParams(invalid),/incompatible/,key);
 }
 const disabled=new URLSearchParams(form);disabled.set("managed_payments[enabled]","false");
 assert.throws(()=>assertManagedCreditCheckoutParams(disabled),/incompatible/);
});

test("Managed Payments requires separate account, prepaid-credit product and tax code approvals",()=>{
 assert.equal(managedCreditMoRApproved(approved),true);
 for(const key of ["CREDIT_GLOBAL_MERCHANT_OF_RECORD","STRIPE_MANAGED_PAYMENTS_ACCOUNT_APPROVED",
  "STRIPE_MANAGED_PAYMENTS_PREPAID_CREDITS_APPROVED","STRIPE_MANAGED_PAYMENTS_LIVE_PRODUCT_REVIEWED",
  "STRIPE_CREDIT_TAX_CODE"]){
  assert.equal(managedCreditMoRApproved({...approved,[key]:"false"}),false,key);
 }
 assert.equal(managedCreditTaxDecision(approved,"FR","consumer").ready,true);
 assert.equal(managedCreditTaxDecision(approved,"CN","consumer").ready,false);
 assert.equal(managedCreditTaxDecision(approved,"FR",null).ready,false);
});

test("server collects country/type for reviewed global checkout and never changes private-DE pilot",()=>{
 const checkout=read("app/(site)/api/credit-checkout/route.ts");
 const balance=read("app/(site)/api/credit-balance/route.ts");
 const picker=read("components/credit-amount-picker.tsx");
 const dashboard=read("components/credits-dashboard.tsx");
 assert.match(checkout,/privateLiveTest\s*\?privateLiveCreditTestTaxDecision/);
 assert.match(checkout,/assessWorldwideCreditTax\(process\.env,body\.billingCountry,body\.buyerType\)/);
 assert.match(checkout,/assertManagedCreditCheckoutParams\(form\)/);
 assert.match(checkout,/\.\.\.\(!useMoR\?\{"invoice_creation\[enabled\]":"true"\}:\{\}\)/);
 assert.match(checkout,/decision\.mode!=="stripe-managed-payments"/);
 assert.match(checkout,/session\.managed_payments\?\.enabled!==true/);
 assert.match(balance,/globalCountrySelection:liveCheckout&&!privateLiveCreditTestEnabled/);
 assert.match(dashboard,/globalCountrySelection=\{balance\.globalCountrySelection===true\}/);
 assert.match(picker,/needsBillingCountry\?\{billingCountry,buyerType\}:\{\}/);
 assert.match(picker,/Select your billing country/);
 assert.match(picker,/needsBillingCountry&&!billingCountry/);
 assert.match(picker,/requestKey\.current=null/);
});
