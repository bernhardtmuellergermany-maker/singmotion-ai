import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {alternativeCreditCheckoutApproved,selectAlternativeCreditCheckout}
 from "../lib/commerce/alternative-credit-checkout.ts";

const read=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const approved={
 RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d",
 CREDIT_ALTERNATIVE_STRIPE_CHECKOUT_APPROVED:"true",
 CREDIT_TAX_WORLDWIDE_REVIEW_APPROVED:"true",
 CREDIT_TAX_COUNTRY_POLICY_JSON:JSON.stringify({revision:"DE-2026-reviewed",reviewedAt:new Date().toISOString().slice(0,10),
 entries:[{country:"DE",buyerType:"consumer",voucherKind:"single-purpose",
 mode:"de-small-business",evidence:"Reviewed synthetic tax policy fixture. Approval in this unit test is not evidence of a legal review."}]}),
 STRIPE_CREDIT_TOPUPS_LIVE_ENABLED:"true",
 STRIPE_LIVE_CHECKOUT_ENABLED:"true",
};
test("seller-of-record alternative payments are disabled by default and fail closed without reviewed tax policy",()=>{
 assert.equal(alternativeCreditCheckoutApproved({}),false);
 for(const key of ["RAILWAY_ENVIRONMENT_ID","CREDIT_ALTERNATIVE_STRIPE_CHECKOUT_APPROVED",
  "CREDIT_TAX_WORLDWIDE_REVIEW_APPROVED","CREDIT_TAX_COUNTRY_POLICY_JSON",
  "STRIPE_CREDIT_TOPUPS_LIVE_ENABLED","STRIPE_LIVE_CHECKOUT_ENABLED"]){
  assert.equal(alternativeCreditCheckoutApproved({...approved,[key]:""}),false,key);
 }
 assert.equal(alternativeCreditCheckoutApproved(approved),true);
 assert.equal(selectAlternativeCreditCheckout(approved,"alternative",true).allowed,true);
 assert.equal(selectAlternativeCreditCheckout(approved,"alternative",false).allowed,false);
 assert.equal(selectAlternativeCreditCheckout({},undefined,true).alternative,false);
 assert.equal(selectAlternativeCreditCheckout({},"managed",true).allowed,true);
 for(const bad of ["paypal","klarna",true,0,""])
  assert.equal(selectAlternativeCreditCheckout(approved,bad,true).allowed,false,String(bad));
});
test("alternative Credit Checkout cannot replace Merchant-of-Record without tax review and a server gate",()=>{
 const checkout=read("app/(site)/api/credit-checkout/route.ts");
 const balance=read("app/(site)/api/credit-balance/route.ts");
 const picker=read("components/credit-amount-picker.tsx");
 const webhook=read("app/(site)/api/stripe-webhook/route.ts");
 assert.match(checkout,/selectAlternativeCreditCheckout\(process\.env,body\.paymentRoute,liveMode\)/);
 assert.match(checkout,/if\(!route\.allowed\)return json/);
 assert.match(checkout,/managedCreditMoRApproved\(process\.env\)&&!route\.alternative/);
 assert.match(checkout,/assessWorldwideCreditTax\(process\.env,body\.billingCountry,body\.buyerType\)/);
 assert.match(checkout,/route\.alternative&&session\.managed_payments\?\.enabled!==false/);
 assert.match(balance,/liveCheckout&&alternativeCreditCheckoutApproved\(process\.env\)/);
 assert.match(picker,/alternativesEnabled&&canPurchase/);
 assert.match(picker,/paymentRoute:"alternative"/);
 assert.match(picker,/requestKey\.current=null/);
 assert.match(webhook,/if\(session\.payment_status!=="paid"\)/);
 assert.match(webhook,/CREDIT_TAX_LOCATION_OR_BUSINESS_PROOF_MISMATCH/);
});


test("wallet and pricing pages both discover checkout payment eligibility",()=>{
 for(const file of ["components/credits-dashboard.tsx","app/(site)/plans/page.tsx"])
  assert.match(read(file),/<CreditAmountPicker discoverAvailability\s*\/>/);
});
