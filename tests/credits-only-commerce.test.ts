import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {legacyCustomerPurchaseRetired,CUSTOMER_CREDITS_ONLY_COMMERCE,
 LEGACY_PURCHASE_RETIRED_RESPONSE} from "../lib/commerce/credits-only-commerce.ts";

const read=(f:string)=>readFileSync(new URL("../"+f,import.meta.url),"utf8");
test("Credits are the ONLY admitted new customer purchase model",()=>{
 assert.equal(CUSTOMER_CREDITS_ONLY_COMMERCE,true);
 assert.equal(legacyCustomerPurchaseRetired(),true);
 assert.equal(LEGACY_PURCHASE_RETIRED_RESPONSE.code,"CREDITS_ONLY");
 assert.equal(LEGACY_PURCHASE_RETIRED_RESPONSE.creditsUrl,"/credits#buy-credits");
 for(const file of [
  "app/(site)/api/stripe-checkout/route.ts",
  "app/(site)/api/hobby-checkout/route.ts",
  "app/(site)/api/customer-orders/route.ts",
 ]){
  const source=read(file);
  assert.match(source,/legacyCustomerPurchaseRetired\(\)/,file);
  assert.match(source,/LEGACY_PURCHASE_RETIRED_RESPONSE/,file);
  assert.match(source,/status:410|,410\)/,file);
  assert.ok(source.indexOf("legacyCustomerPurchaseRetired()")<
   source.indexOf("fetch(\"https://api.stripe.com/v1/checkout/sessions\"")||
   !source.includes('fetch("https://api.stripe.com/v1/checkout/sessions"'),
   file+": legacy card Checkout must be unreachable");
 }
 assert.match(read("app/(site)/api/hobby-checkout/route.ts"),/enabled:!legacyCustomerPurchaseRetired\(\)/);
 assert.match(read("app/(site)/api/hobby-readiness/route.ts"),/checkoutConfigured:!legacyCustomerPurchaseRetired\(\)/);
});
test("historical customer transactions are visible but cannot become spendable wallet deposits",()=>{
 const source=read("app/(site)/api/credit-balance/route.ts");
 assert.match(source,/const purchased=wallet\.total\(identity\.subject\)/);
 assert.match(source,/const videoReserved=wallet\.reserved\(identity\.subject\)/);
 assert.match(source,/const rawBalance=purchased-reserved/);
 assert.doesNotMatch(source,/rawBalance=purchased\+legacy/);
 assert.match(source,/const entries=wallet\.entries\(identity\.subject\)/);
 assert.match(source,/legacyOrders:oldOrders/);
 assert.doesNotMatch(source,/entries=\[\.\.\.wallet\.entries\(identity\.subject\),\.\.\.oldEntries\]/);
 assert.match(source,/protectedProductionLivePilotApproved\(process\.env\)/);
});
test("only Credit Checkout can create new Stripe purchases, and own paid MP4 history stays accessible",()=>{
 const credit=read("app/(site)/api/credit-checkout/route.ts");
 assert.match(credit,/CreditWallet/);
 assert.match(credit,/stripeCreditTopupsTestEnabled/);
 assert.match(credit,/stripeCreditTopupsLiveEnabled/);
 assert.match(credit,/metadata\[flow\]/);
 assert.match(credit,/singmotion_credit_topup/);
 assert.match(credit,/managed_payments\[enabled\]/);
 assert.match(credit,/automatic_tax\[enabled\]/);
 assert.match(credit,/stripeCreditTopupsLiveEnabled\(process\.env\)/);
 const webhook=read("app/(site)/api/stripe-webhook/route.ts");
 assert.match(webhook,/reconcileCreditPurchase/);
 assert.match(webhook,/reconcileReversal/);
 const old=read("app/(site)/api/orders/[id]/route.ts");
 assert.match(old,/ownedDeliveredVideoAsset/);
 const portal=read("app/(site)/api/hobby-portal/route.ts");
 assert.match(portal,/provider_subscription_id/);
 const cta=read("components/customer-video-checkout.tsx");
 assert.match(cta,/href="\/credits#buy-credits"/);
 assert.doesNotMatch(cta,/api\/stripe-checkout/);
 assert.doesNotMatch(cta,/window\.location\.assign/);
});
test("unauthorised customer generation remains blocked until a reviewed credit-to-video pipeline exists",()=>{
 const dialog=read("components/generation-dialog.tsx");
 const route=read("app/(site)/api/customer-orders/route.ts");
 assert.match(dialog,/Customer credit-paid generation is not yet enabled/);
 assert.match(dialog,/Customer video generation with Credits is not yet enabled/);
 assert.match(route,/checkoutEnabled: !legacyCustomerPurchaseRetired\(\)/);
});
