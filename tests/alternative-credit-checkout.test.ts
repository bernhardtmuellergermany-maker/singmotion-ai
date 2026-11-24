import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {CreditWallet} from "../lib/commerce/credit-wallet.ts";
import {standardCreditCheckoutEnabled,configureStandardCreditCheckout,standardCreditTaxDecisionFromVerifiedStripe,existingBoundStandardCreditReceipt,STANDARD_CREDIT_TAX_FLOW} from "../lib/commerce/standard-credit-checkout.ts";
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
 CREDIT_TAX_DE_KLEINUNTERNEHMER_APPROVED:"true",
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
 assert.match(checkout,/selectAlternativeCreditCheckout\(process\.env,body\.paymentRoute,liveMode,body\.billingCountry,body\.buyerType\)/);
 assert.match(checkout,/if\(!route\.allowed\)return json/);
 assert.match(checkout,/managedCreditMoRApproved\(process\.env\)&&!route\.alternative/);
 assert.match(checkout,/assessWorldwideCreditTax\(process\.env,body\.billingCountry,body\.buyerType\)/);
 assert.match(checkout,/route\.alternative&&session\.managed_payments\?\.enabled!==false/);
 assert.match(balance,/liveCheckout&&alternativeCreditCheckoutApproved\(process\.env\)/);
 assert.doesNotMatch(picker,/name="credit-payment-route"|setPaymentRoute|paymentRoute:"alternative"/);
 assert.doesNotMatch(picker,/needsBillingCountry|setBillingCountry|setBuyerType|Select your billing country/);
 assert.match(checkout,/route=\{allowed:true,alternative:false\};useMoR=true;tax=null/);
 assert.match(picker,/requestKey\.current=null/);
 assert.match(webhook,/if\(session\.payment_status!=="paid"\)/);
 assert.match(webhook,/CREDIT_TAX_LOCATION_OR_BUSINESS_PROOF_MISMATCH/);
});


test("wallet and pricing pages both discover checkout payment eligibility",()=>{
 for(const file of ["components/credits-dashboard.tsx","app/(site)/plans/page.tsx"])
  assert.match(read(file),/<CreditAmountPicker discoverAvailability\s*\/>/);
});


test("automatic checkout chooses reviewed seller route only for eligible country and buyer",()=>{
 assert.deepEqual(selectAlternativeCreditCheckout(approved,undefined,true,"DE","consumer"),{allowed:true,alternative:true});
 for(const [country,buyer] of [["US","consumer"],["DE","business"],["GB","consumer"],[undefined,undefined]])
  assert.equal(selectAlternativeCreditCheckout(approved,undefined,true,country,buyer).alternative,false);
 assert.equal(selectAlternativeCreditCheckout(approved,undefined,false,"DE","consumer").alternative,false);
 assert.equal(selectAlternativeCreditCheckout({...approved,CREDIT_TAX_DE_KLEINUNTERNEHMER_APPROVED:"false"},undefined,true,"DE","consumer").alternative,false);
 assert.equal(selectAlternativeCreditCheckout(approved,"managed",true,"DE","consumer").alternative,false);
});


test("explicit operator-owned normal Stripe checkout preserves auto tax, invoices and dynamic payment methods",()=>{
 const env={...approved,CREDIT_STANDARD_STRIPE_CHECKOUT_ENABLED:"true",CREDIT_STANDARD_STRIPE_SELLER_TAX_RESPONSIBILITY_ACCEPTED:"true",STRIPE_CREDIT_TAX_CODE:"txcd_10105003"};
 assert.equal(standardCreditCheckoutEnabled(env),true);
 for(const key of ["CREDIT_STANDARD_STRIPE_CHECKOUT_ENABLED","CREDIT_STANDARD_STRIPE_SELLER_TAX_RESPONSIBILITY_ACCEPTED","STRIPE_CREDIT_TAX_CODE","RAILWAY_ENVIRONMENT_ID"])
  assert.equal(standardCreditCheckoutEnabled({...env,[key]:""}),false,key);
 const form=new URLSearchParams();configureStandardCreditCheckout(form);
 for(const [key,value] of [["managed_payments[enabled]","false"],["automatic_tax[enabled]","true"],["invoice_creation[enabled]","true"],["billing_address_collection","required"],["tax_id_collection[enabled]","true"],["adaptive_pricing[enabled]","false"],["metadata[creditTaxFlow]",STANDARD_CREDIT_TAX_FLOW]])assert.equal(form.get(key),value,key);
 assert.equal(form.has("payment_method_types[0]"),false);
 assert.match(read("app/(site)/api/credit-checkout/route.ts"),/if\(sellerHosted\)configureStandardCreditCheckout\(form\)/);
});
test("standard checkout records actual verified billing and settles the exact paid wallet once",()=>{
 const db=new DatabaseSync(":memory:");try{
  const w=new CreditWallet(db),p=w.pending({subject:"customer:fixture",customerId:"fixture",email:"fixture@example.test"},500,"00000000-0000-4000-8000-000000000081");
  const sessionId="cs_live_fixture81";w.bind(p.id,sessionId,"https://checkout.stripe.com/c/pay/"+sessionId);
  const metadata={flow:"singmotion_credit_topup",creditTopupId:p.id,creditTaxFlow:STANDARD_CREDIT_TAX_FLOW};
  const session={metadata,managed_payments:{enabled:false},automatic_tax:{enabled:true,liability:{type:"self"},status:"complete"},payment_status:"paid",customer_details:{address:{country:"DE"},tax_ids:[]}};
  assert.equal(existingBoundStandardCreditReceipt(db,metadata,sessionId),true);
  assert.equal(existingBoundStandardCreditReceipt(db,metadata,"cs_live_other"),false);
  assert.equal(existingBoundStandardCreditReceipt(db,{...metadata,creditTaxFlow:"stripe-collected"},sessionId),false);
  const decision=standardCreditTaxDecisionFromVerifiedStripe(session)!;
  assert.equal(decision.country,"DE");assert.equal(decision.mode,"seller-stripe-tax");assert.equal(decision.voucherKind,"seller-review-pending");
  assert.equal(standardCreditTaxDecisionFromVerifiedStripe({...session,managed_payments:{enabled:true}}),null);
  assert.equal(standardCreditTaxDecisionFromVerifiedStripe({...session,automatic_tax:{enabled:false}}),null);
  assert.equal(standardCreditTaxDecisionFromVerifiedStripe({...session,payment_status:"unpaid"}),null);
  assert.equal(standardCreditTaxDecisionFromVerifiedStripe({...session,customer_details:{address:{country:"US"},tax_ids:[{type:"us_ein",value:"fixture"}]}})?.buyerType,"business");
  w.bindTaxContext(p.id,decision,sessionId);
  const receipt={id:p.id,sessionId,amount:500,currency:"eur",paymentStatus:"paid",livemode:true};
  assert.equal(w.settle(receipt),true);w.bindTaxContext(p.id,decision,sessionId);assert.equal(w.settle(receipt),false);
  assert.equal(w.total("customer:fixture"),500);
 }finally{db.close()}
});
