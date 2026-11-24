import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
 assertManagedCreditCheckoutParams,managedCreditMoRApproved,
 managedCreditTaxDecision,managedCreditTaxDecisionFromVerifiedStripe
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
  "metadata[creditTaxFlow]":"stripe-collected",
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
 assert.equal(managedCreditTaxDecision(approved,"BR","consumer").ready,true);
 assert.equal(managedCreditTaxDecision(approved,"BR","consumer").decision?.revision,"stripe-mor-seller-tax-v1");
 assert.equal(managedCreditTaxDecision(approved,"CN","consumer").ready,false);
 assert.equal(managedCreditTaxDecision(approved,"FR",null).ready,false);
});

test("managed country is collected only once at Stripe; fulfillment still validates it",()=>{
 const checkout=read("app/(site)/api/credit-checkout/route.ts");
 const balance=read("app/(site)/api/credit-balance/route.ts");
 const picker=read("components/credit-amount-picker.tsx");
 const hook=read("app/(site)/api/stripe-webhook/route.ts");
 const css=read("components/credit-amount-picker.css");
 assert.match(checkout,/privateInternationalCreditBetaEnabled\(process\.env\)/);
 assert.match(checkout,/liveMode&&!useMoR\?assessWorldwideCreditTax\(process\.env,body\.billingCountry,body\.buyerType\):null/);
 assert.match(checkout,/metadata\[creditTaxFlow\]/);
 assert.match(checkout,/form\.set\("billing_address_collection","required"\)/);
 assert.match(checkout,/assertManagedCreditCheckoutParams\(form\)/);
 assert.match(checkout,/session\.managed_payments\?\.enabled!==true/);
 assert.match(balance,/globalCountrySelection:liveCheckout&&!managedCreditMoRApproved\(process\.env\)/);
 assert.match(balance,/approvedBillingCountries:null/);
 assert.doesNotMatch(picker,/needsBillingCountry|setBillingCountry|setBuyerType|paymentRoute:/);
 assert.match(hook,/managedCreditTaxDecisionFromVerifiedStripe\(process\.env,details\)/);
 assert.match(hook,/wallet\.bindTaxContext\(id,checked\.decision,session\.id\)/);
 assert.match(hook,/CREDIT_STRIPE_BILLING_COUNTRY_NOT_APPROVED/);
 assert.match(hook,/STRIPE_MANAGED_PAYMENTS_MERCHANT_OF_RECORD_NOT_VERIFIED/);
 assert.match(css,/\.sm-credit-buy-enabled\{[^}]*display:flex/);
 assert.match(css,/box-sizing:border-box;width:100%/);
 assert.match(picker,/<Link href="\/login" className="sm-credit-amount-disabled sm-credit-buy-enabled">Sign in to buy Credits<\/Link>/);
});
test("buyer country from verified Stripe session never approves restricted countries",()=>{
 assert.equal(managedCreditTaxDecisionFromVerifiedStripe(approved,{address:{country:"DE"}}).ready,true);
 assert.equal(managedCreditTaxDecisionFromVerifiedStripe(approved,{address:{country:"BR"},tax_ids:[{type:"br_cnpj",value:"synthetic"}]}).decision?.buyerType,"business");
 assert.equal(managedCreditTaxDecisionFromVerifiedStripe(approved,{address:{country:"DE"}}).decision?.buyerType,"consumer");
 assert.equal(managedCreditTaxDecisionFromVerifiedStripe(approved,{address:{country:"CN"}}).ready,false);
 assert.equal(managedCreditTaxDecisionFromVerifiedStripe(approved,{address:{country:"RS"}}).ready,false);
 assert.equal(managedCreditTaxDecisionFromVerifiedStripe(approved,undefined).ready,false);
 assert.equal(managedCreditTaxDecisionFromVerifiedStripe({...approved,STRIPE_MANAGED_PAYMENTS_ACCOUNT_APPROVED:"false"},{address:{country:"DE"}}).ready,false);
});
