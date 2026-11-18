import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {assessPrivateInternationalCreditBeta,privateInternationalCreditBetaEnabled} from "../lib/commerce/private-international-credit-beta.ts";
import {customerIdentityOrigin,googleLoginReady,passwordResetReady} from "../lib/customer-identity-origin.ts";
import {customerAccountSettingsAccessible} from "../lib/commerce/customer-live-config.ts";
import {managedCreditTaxDecision,approvedMoRBuyerCountries} from "../lib/commerce/managed-credit-payments.ts";
import {stripeCreditTopupsLiveEnabled} from "../lib/commerce/credit-wallet.ts";
import {customerCreditStudioBetaEnabled} from "../lib/commerce/customer-credit-studio-beta.ts";
import {stagingAccess,privateBetaPasswordEnabled,issuePrivateGateTicket,validPrivateGateTicket} from "../lib/staging.ts";

const read=(p:string)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const prod="36adc41d-7e54-4396-ad1a-fd432ba0441d";
const env=()=>({
 RAILWAY_ENVIRONMENT_ID:prod,
 PRODUCTION_PRIVATE_INTERNATIONAL_CREDIT_BETA_ENABLED:"true",
 STAGING_AUTH_ENABLED:"true",
 STAGING_PASSWORD:"operator-only-internal-password-test-0123456789",
 PRIVATE_BETA_PASSWORD:"global-testers-only-password-test-0123456789",
 PRODUCTION_PUBLIC_ACCESS_ENABLED:"false",
 PUBLIC_CUSTOMER_LAUNCH_APPROVED:"false",
 CREDIT_GLOBAL_MERCHANT_OF_RECORD:"stripe-managed",
 STRIPE_MANAGED_PAYMENTS_ACCOUNT_APPROVED:"true",
 STRIPE_MANAGED_PAYMENTS_PREPAID_CREDITS_APPROVED:"true",
 STRIPE_MANAGED_PAYMENTS_LIVE_PRODUCT_REVIEWED:"true",
 STRIPE_CREDIT_TAX_CODE:"txcd_10105003",
 STRIPE_ACCOUNT_LIVE_REVIEW_APPROVED:"true",
 STRIPE_CREDIT_TOPUPS_LIVE_ENABLED:"true",
 STRIPE_LIVE_CHECKOUT_ENABLED:"true",
 STRIPE_SECRET_KEY:"sk_live_testfixture",
 STRIPE_WEBHOOK_SECRET:"whsec_testfixture",
 CUSTOMER_PRIVATE_LIVE_CREDIT_VIDEO_ENABLED:"true",
 CUSTOMER_ACCOUNTS_ENABLED:"true",
 CMS_ENABLED:"true",
 PAYLOAD_SECRET:"p".repeat(48),
 CUSTOMER_BYTEPLUS_OWNER_CONFIRMED_PRICING:"true",
 BYTEPLUS_STUDIO_RECOVERY_ENABLED:"true",
 BYTEPLUS_STUDIO_OPERATOR_SECRET:"o".repeat(48),
 BYTEPLUS_ACCESS_KEY_ID:"test-access-key-id",
 BYTEPLUS_SECRET_ACCESS_KEY:"test-secret-access-key-long",
 CUSTOMER_R2_STORAGE_ENABLED:"true",
 R2_ACCOUNT_ID:"test-account",
 R2_BUCKET:"test-private-video",
 R2_ACCESS_KEY_ID:"test-r2-access",
 R2_SECRET_ACCESS_KEY:"test-r2-secret",
 DEMO_MODE:"true",
 GENERATIONS_ENABLED:"false",
 ADMIN_DEMO_ENABLED:"false",
 HOBBY_SUBSCRIPTIONS_ENABLED:"false",
 CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED:"false",
 APP_ORIGIN:"https://www.singmotion.ai",
 PUBLIC_SITE_ORIGIN:"https://www.singmotion.ai",
});

const basic=(username:string,password:string)=>
 "Basic "+Buffer.from(username+":"+password).toString("base64");

test("global private LIVE cohort is approved without opening the website",()=>{
 const p=env();
 assert.equal(assessPrivateInternationalCreditBeta(p).ready,true);
 assert.equal(privateInternationalCreditBetaEnabled(p),true);
 assert.equal(stripeCreditTopupsLiveEnabled(p),true);
 assert.equal(p.PUBLIC_CUSTOMER_LAUNCH_APPROVED,"false");
 assert.equal(p.PRODUCTION_PUBLIC_ACCESS_ENABLED,"false");
 assert.equal(customerCreditStudioBetaEnabled(p),true);
});

test("every new LIVE Checkout uses reviewed buyer-country treatment, including Germany",()=>{
 const p=env();
 const options=approvedMoRBuyerCountries(p);
 for(const country of ["DE","US","BR","JP","ZA","IN","NZ"]){
  assert.ok(options.includes(country),country);
  assert.equal(managedCreditTaxDecision(p,country,"consumer").ready,true);
 }
 assert.equal(managedCreditTaxDecision(p,"BR","business").ready,true);
 for(const restricted of ["CN","IR","RU","KP","CU","SY","XK"]){
  assert.equal(managedCreditTaxDecision(p,restricted,"consumer").ready,false,restricted);
  assert.ok(!options.includes(restricted));
 }
 assert.equal(managedCreditTaxDecision(p,"RS","consumer").ready,false);
 assert.equal(managedCreditTaxDecision({...p,STRIPE_MANAGED_PAYMENTS_SERBIA_NO_VAT_REGISTRATION_CONFIRMED:"true"},"RS","consumer").ready,true);
});

test("DE-only legacy flag cannot authorize any new LIVE credit purchases or video studio",()=>{
 const p=env();
 const old={...p,PRODUCTION_PRIVATE_INTERNATIONAL_CREDIT_BETA_ENABLED:"false",PRODUCTION_PRIVATE_CREDIT_TEST_ENABLED:"true"};
 assert.equal(privateInternationalCreditBetaEnabled(old),false);
 assert.equal(stripeCreditTopupsLiveEnabled(old),false);
 assert.equal(customerCreditStudioBetaEnabled(old),false);
 for(const file of [
  "app/(site)/api/credit-checkout/route.ts",
  "app/(site)/api/credit-balance/route.ts",
  "lib/commerce/credit-wallet.ts",
  "lib/commerce/customer-credit-studio-beta.ts",
 ]){
  const s=read(file);
  assert.doesNotMatch(s,/privateLiveCreditTestEnabled|privateLiveCreditTestTaxDecision|privateCreditPilotApproved/,file);
 }
 const checkout=read("app/(site)/api/credit-checkout/route.ts");
 assert.match(checkout,/metadata\[creditTaxFlow\]/);
 assert.match(checkout,/form\.set\("billing_address_collection","required"\)/);
 assert.doesNotMatch(checkout,/PRIVATE_LIVE_TRIAL_DE_PRIVATE_CUSTOMER_ONLY/);
});

test("global cohort password is separate from operator password and revoked with gate",()=>{
 const p=env();
 assert.equal(stagingAccess(basic("beta",p.PRIVATE_BETA_PASSWORD),p),200);
 assert.equal(stagingAccess(basic("staging",p.STAGING_PASSWORD),p),200);
 assert.equal(stagingAccess(basic("staging",p.PRIVATE_BETA_PASSWORD),p),401);
 assert.equal(stagingAccess(basic("beta",p.STAGING_PASSWORD),p),401);
 const stamp=Date.UTC(2026,10,18,12);
 const v1=issuePrivateGateTicket(p,stamp);
 const v2=issuePrivateGateTicket(p,stamp,"beta");
 assert.notEqual(v1,v2);
 assert.equal(validPrivateGateTicket(v1,p,stamp),true);
 assert.equal(validPrivateGateTicket(v2,p,stamp),true);
 assert.equal(validPrivateGateTicket(v2,{...p,PRIVATE_BETA_PASSWORD:"rotated-test-password-0123456789-abcdefghijkl"},stamp),false);
 assert.equal(validPrivateGateTicket(v2,{...p,PRODUCTION_PRIVATE_INTERNATIONAL_CREDIT_BETA_ENABLED:"false"},stamp),false);
 assert.equal(stagingAccess(basic("beta",p.PRIVATE_BETA_PASSWORD),{...p,PRODUCTION_PRIVATE_INTERNATIONAL_CREDIT_BETA_ENABLED:"false"}),401);
 assert.equal(privateBetaPasswordEnabled({...p,PRIVATE_BETA_PASSWORD:"too-short"}),false);
 const pendingStripeProductReview={...p,STRIPE_MANAGED_PAYMENTS_PREPAID_CREDITS_APPROVED:"false"};
 assert.equal(privateBetaPasswordEnabled(pendingStripeProductReview),true,"group login is independent of payment readiness");
 assert.equal(stagingAccess(basic("beta",p.PRIVATE_BETA_PASSWORD),pendingStripeProductReview),200);
 assert.equal(stripeCreditTopupsLiveEnabled(pendingStripeProductReview),false,"group password must never bypass payment approval");
});

test("launch remains fail-closed for incomplete product, payment, password or media proof",()=>{
 const p=env();
 const missing=[
  {PRIVATE_BETA_PASSWORD:""},
  {STAGING_AUTH_ENABLED:"false"},
  {PRODUCTION_PUBLIC_ACCESS_ENABLED:"true"},
  {PUBLIC_CUSTOMER_LAUNCH_APPROVED:"true"},
  {CREDIT_GLOBAL_MERCHANT_OF_RECORD:""},
  {STRIPE_MANAGED_PAYMENTS_ACCOUNT_APPROVED:"false"},
  {STRIPE_MANAGED_PAYMENTS_PREPAID_CREDITS_APPROVED:"false"},
  {STRIPE_MANAGED_PAYMENTS_LIVE_PRODUCT_REVIEWED:"false"},
  {STRIPE_ACCOUNT_LIVE_REVIEW_APPROVED:"false"},
  {STRIPE_LIVE_CHECKOUT_ENABLED:"false"},
  {STRIPE_SECRET_KEY:"sk_test_fake"},
  {CUSTOMER_PRIVATE_LIVE_CREDIT_VIDEO_ENABLED:"false"},
  {BYTEPLUS_STUDIO_RECOVERY_ENABLED:"false"},
  {CUSTOMER_R2_STORAGE_ENABLED:"false"},
  {GENERATIONS_ENABLED:"true"},
  {APP_ORIGIN:"http://localhost:3000"},
 ];
 for(const patch of missing){
  const next={...p,...patch};
  assert.equal(privateInternationalCreditBetaEnabled(next),false,JSON.stringify(patch));
  assert.equal(stripeCreditTopupsLiveEnabled(next),false,JSON.stringify(patch));
 }
});

test("signed LIVE reconciliation remains possible for already bound old-DE or global sessions after beta switch-off",async()=>{
 const {DatabaseSync}=await import("node:sqlite");
 const {randomUUID}=await import("node:crypto");
 const {CreditWallet}=await import("../lib/commerce/credit-wallet.ts");
 const {existingBoundLiveCreditReceipt}=await import("../lib/commerce/legacy-private-credit-settlement.ts");
 const db=new DatabaseSync(":memory:");
 try{
  const wallet=new CreditWallet(db);
  const subject={subject:"customer:test-international",customerId:"test-international",email:"pilot@example.test"};
  for(const [country,mode] of [["DE","private-live-verification"],["BR","stripe-managed-payments"]] as const){
   const pending=wallet.pending(subject,500,randomUUID());
   wallet.bindTaxContext(pending.id,{
    country,buyerType:"consumer",
    voucherKind:mode==="private-live-verification"?"private-test-unclassified":"merchant-of-record-determined",
    mode,revision:mode==="private-live-verification"?"private-owner-checkout-v1":"stripe-mor-seller-tax-v1",
    taxAtIssue:false,taxCode:mode==="stripe-managed-payments"?"txcd_10105003":null
   });
   const session="cs_live_"+randomUUID().replaceAll("-","");
   wallet.bind(pending.id,session,"https://checkout.stripe.com/c/pay/"+country);
   assert.equal(existingBoundLiveCreditReceipt(db,pending.id,session),true);
   assert.equal(existingBoundLiveCreditReceipt(db,pending.id,"cs_live_other"),false);
   assert.equal(existingBoundLiveCreditReceipt(db,randomUUID(),session),false);
   wallet.settle({id:pending.id,sessionId:session,amount:500,currency:"eur",paymentStatus:"paid",livemode:true});
   assert.equal(existingBoundLiveCreditReceipt(db,pending.id,session),true,"idempotent paid webhook retry");
   wallet.reverse({sessionId:session,amount:500,currency:"eur",livemode:true,kind:"refund"});
   assert.equal(existingBoundLiveCreditReceipt(db,pending.id,session),false,"reversed receipt is terminal");
  }
  assert.equal(existingBoundLiveCreditReceipt(db,randomUUID(),"cs_live_unbound"),false);
 }finally{db.close();}
 const webhook=read("app/(site)/api/stripe-webhook/route.ts");
 assert.match(webhook,/existingBoundLiveCreditReceipt/);
 assert.match(webhook,/verifyStripePaymentEvent\(raw,signature,secret,mode\)/);
 assert.match(webhook,/stripeGet\("checkout\/sessions\/"/);
});

test("approved private international beta enables customer sign-in, Google and password recovery without changing payment approvals",()=>{
 const p=env();
 assert.equal(customerIdentityOrigin(p),"https://www.singmotion.ai");
 assert.equal(customerAccountSettingsAccessible(p),true);
 assert.equal(googleLoginReady({...p,GOOGLE_OAUTH_CLIENT_ID:"test-id",GOOGLE_OAUTH_CLIENT_SECRET:"test-secret"}),true);
 assert.equal(passwordResetReady({...p,RESEND_API_KEY:"re_test",ACCOUNT_EMAIL_FROM:"SingMotion AI <no-reply@singmotion.ai>"}),true);
 assert.equal(customerIdentityOrigin({...p,PRODUCTION_PRIVATE_INTERNATIONAL_CREDIT_BETA_ENABLED:"false"}),null);
 assert.equal(customerIdentityOrigin({...p,APP_ORIGIN:"https://not-singmotion.example"}),null);
 assert.equal(customerIdentityOrigin({...p,STAGING_AUTH_ENABLED:"false"}),null);
 const accountRoute=read("app/(site)/api/customer-auth/route.ts");
 const accountPanel=read("components/account-panel.tsx");
 assert.match(accountRoute,/privateInternationalCreditBetaEnabled\(process\.env\)/);
 assert.match(accountPanel,/\{mode==="login"&&<Link className="sm-account-recovery-link" href="\/account\/reset-password">Forgot password\?<\/Link>\}/);
 assert.doesNotMatch(accountPanel,/recoveryAvailable/);
 assert.match(accountPanel,/placeholder=\{mode==="register"\?"At least 8 characters":"Your password"\}/);
});
