import test from "node:test";import assert from "node:assert/strict";import {readFileSync} from "node:fs";
import {MIN_CREDIT_TOPUP,MAX_CREDIT_TOPUP,parseCreditTopup,proposedTopupCents} from "../lib/commerce/credit-topup-quote.ts";
const read=(p:string)=>readFileSync(new URL(`../${p}`,import.meta.url),"utf8");
test("whole credit counts and correct integer pricing",()=>{
 assert.equal(MIN_CREDIT_TOPUP,500);assert.equal(MAX_CREDIT_TOPUP,100000);
 for(const bad of ["","0","10","499","100001","1.5","1e3","-500","abc","Infinity"])assert.equal(parseCreditTopup(bad),null);
 for(const [v,credits] of [["500",500],["2357",2357],["100000",100000]] as const){
  assert.equal(parseCreditTopup(v),credits);assert.equal(proposedTopupCents(credits),credits);
 }
});
test("No new Hobby offer",()=>{
 assert.doesNotMatch(read("app/(site)/plans/page.tsx"),/€4\.99|€0\.20|Upgrade to Hobby/);
 assert.match(read("app/(site)/api/hobby-checkout/route.ts"),/HOBBY_NEW_PURCHASES_ENABLED==="true"/);
});
test("Super-admin has a real isolated wallet, never a fake credit slider",()=>{
 const auth=read("lib/commerce/credit-wallet-auth.ts");
 const menu=read("components/header-account-menu.tsx"),dashboard=read("components/credits-dashboard.tsx");
 assert.match(auth,/CMS_ENABLED/);assert.match(auth,/super-admin/);
 assert.doesNotMatch(menu,/TEST ONLY|testCredits/);
 assert.doesNotMatch(dashboard,/admin-preview|Test-Credits|Testansicht/);
 assert.match(dashboard,/Usage & Orders/);
});
test("Credits replace the legacy Hobby subscription in account settings",()=>{
 const s=read("app/(site)/account/settings/page.tsx");
 assert.match(s,/Prepaid Credits/); assert.doesNotMatch(s,/Existing Hobby subscription/);
 assert.match(s,/href="\/credits"/);assert.doesNotMatch(s,/Upgrade to Hobby|async function subscribe\(/);
});

test("all private LIVE buyers select a reviewed billing country and buyer type worldwide",()=>{
 const picker=read("components/credit-amount-picker.tsx");
 const checkout=read("app/(site)/api/credit-checkout/route.ts");
 const webhook=read("app/(site)/api/stripe-webhook/route.ts");
 // No German special-case remains in new LIVE Credit purchases.
 // Every buyer follows the same reviewed country/type eligibility gate.
 assert.match(picker,/needsBillingCountry\?\{billingCountry,buyerType\}:\{\}/);
 assert.match(picker,/needsBillingCountry&&<div className="sm-credit-country-fields"/);
 assert.match(picker,/moRCountries\.includes\(billingCountry\)/);
 assert.match(read("app/(site)/api/credit-balance/route.ts"),/globalCountrySelection:liveCheckout&&/);
 assert.match(picker,/body:JSON\.stringify\(\{credits:String\(credits\)/);
 assert.doesNotMatch(checkout,/privateLiveCreditTestTaxDecision/);
 assert.match(checkout,/managedCreditTaxDecision\(process\.env,body\.billingCountry,body\.buyerType\)/);
 assert.match(checkout,/form\.set\("billing_address_collection","required"\)/);
 assert.match(checkout,/tax_id_collection\[enabled\]/);
 assert.match(checkout,/decision\.mode!=="stripe-managed-payments"/);
 assert.match(webhook,/details\?\.address\?\.country!==prior\.country/);
 assert.match(webhook,/prior\.buyerType==="consumer"&&Array\.isArray\(details\?\.tax_ids\)/);
});
