import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {managedCreditMoRApproved,managedCreditBuyerSupported,managedCreditTaxDecision}
 from "../lib/commerce/managed-credit-payments.ts";
import {stripeCreditTopupsLiveEnabled} from "../lib/commerce/credit-wallet.ts";
const approved=()=>({
 CREDIT_GLOBAL_MERCHANT_OF_RECORD:"stripe-managed",
 STRIPE_MANAGED_PAYMENTS_ACCOUNT_APPROVED:"true",
 STRIPE_MANAGED_PAYMENTS_PREPAID_CREDITS_APPROVED:"true",
 STRIPE_MANAGED_PAYMENTS_LIVE_PRODUCT_REVIEWED:"true",
 STRIPE_CREDIT_TAX_CODE:"txcd_10105001",
});
test("supported countries have no merchant-managed tax whitelist, restricted destinations remain excluded",()=>{
 const env=approved();
 assert.equal(managedCreditMoRApproved(env),true);
 for(const country of ["DE","FR","GB","US","CA","AU","JP","BR","ZA","IN","NZ","SG"]){
  assert.equal(managedCreditTaxDecision(env,country,"consumer").ready,true,country);
 }
 for(const country of ["CN","CU","IR","XK","KP","RU","SY","AC","TA","DEU","de",undefined]){
  assert.equal(managedCreditBuyerSupported(country),false,String(country));
  assert.equal(managedCreditTaxDecision(env,country,"consumer").ready,false,String(country));
 }
 assert.equal(managedCreditTaxDecision(env,"US","unknown").ready,false);
});
test("never declare Stripe MoR eligible without real account AND prepaid product approval",()=>{
 const env=approved();
 for(const key of Object.keys(env)){
  assert.equal(managedCreditMoRApproved({...env,[key]:"false"}),false,key);
 }
 for(const taxCode of ["","txcd_10000000","txcd_99999999","txcd_10105099"])
  assert.equal(managedCreditMoRApproved({...env,STRIPE_CREDIT_TAX_CODE:taxCode}),false,taxCode);
});
test("managed global credits remain production-only and preserve verification of MoR during checkout and webhook",()=>{
 const env={...approved(),
  RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d",
  STRIPE_CREDIT_TOPUPS_LIVE_ENABLED:"true",STRIPE_LIVE_CHECKOUT_ENABLED:"true",
  STRIPE_ACCOUNT_LIVE_REVIEW_APPROVED:"true",PUBLIC_CUSTOMER_LAUNCH_APPROVED:"true",
  STRIPE_SECRET_KEY:"sk_live_fixture",STRIPE_WEBHOOK_SECRET:"whsec_fixture",
 };
 assert.equal(stripeCreditTopupsLiveEnabled(env),true);
 assert.equal(stripeCreditTopupsLiveEnabled({...env,STRIPE_MANAGED_PAYMENTS_PREPAID_CREDITS_APPROVED:"false"}),false);
 assert.equal(stripeCreditTopupsLiveEnabled({...env,RAILWAY_ENVIRONMENT_ID:"staging"}),false);
 const root=new URL("../",import.meta.url);
 const checkout=readFileSync(new URL("app/(site)/api/credit-checkout/route.ts",root),"utf8");
 const webhook=readFileSync(new URL("app/(site)/api/stripe-webhook/route.ts",root),"utf8");
 assert.match(checkout,/managed_payments\[enabled\]/);
 assert.match(checkout,/session.managed_payments\?\.enabled!==true/);
 assert.match(webhook,/STRIPE_MANAGED_PAYMENTS_MERCHANT_OF_RECORD_NOT_VERIFIED/);
});
