import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {assessPublicCreditRelease,publicCreditReleaseApproved,PUBLIC_CREDIT_RELEASE_EVIDENCE} from "../lib/commerce/public-credit-release.ts";
import {privateLiveCreditTestEnabled} from "../lib/commerce/private-live-credit-test.ts";
import {productionCustomerReleaseApproved} from "../lib/commerce/customer-live-config.ts";
import {stripeCreditTopupsLiveEnabled} from "../lib/commerce/credit-wallet.ts";
import {customerCreditStudioBetaEnabled} from "../lib/commerce/customer-credit-studio-beta.ts";
import {stagingAccess,stagingEnabled} from "../lib/staging.ts";
import {customerIdentityOrigin,googleLoginReady,passwordResetReady} from "../lib/customer-identity-origin.ts";

const production="36adc41d-7e54-4396-ad1a-fd432ba0441d";
function approved():Record<string,string>{
 const env:Record<string,string>={
  RAILWAY_ENVIRONMENT_ID:production,
  PUBLIC_CUSTOMER_LAUNCH_APPROVED:"true",
  PRODUCTION_PUBLIC_ACCESS_ENABLED:"true",
  STAGING_AUTH_ENABLED:"false",
  DEMO_MODE:"true",GENERATIONS_ENABLED:"false",ADMIN_DEMO_ENABLED:"false",
  HOBBY_SUBSCRIPTIONS_ENABLED:"false",CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED:"false",
  CREDIT_GLOBAL_MERCHANT_OF_RECORD:"stripe-managed",
  STRIPE_MANAGED_PAYMENTS_ACCOUNT_APPROVED:"true",
  STRIPE_MANAGED_PAYMENTS_PREPAID_CREDITS_APPROVED:"true",
  STRIPE_MANAGED_PAYMENTS_LIVE_PRODUCT_REVIEWED:"true",
  STRIPE_CREDIT_TAX_CODE:"txcd_10105003",
  STRIPE_CREDIT_TOPUPS_LIVE_ENABLED:"true",STRIPE_LIVE_CHECKOUT_ENABLED:"true",
  STRIPE_SECRET_KEY:"sk_live_synthetic_fixture",STRIPE_WEBHOOK_SECRET:"whsec_synthetic_fixture",
  CUSTOMER_PUBLIC_LIVE_CREDIT_VIDEO_ENABLED:"true",
  CUSTOMER_ACCOUNTS_ENABLED:"true",CUSTOMER_BYTEPLUS_OWNER_CONFIRMED_PRICING:"true",
  BYTEPLUS_STUDIO_RECOVERY_ENABLED:"true",BYTEPLUS_STUDIO_OPERATOR_SECRET:"s".repeat(40),
  CUSTOMER_R2_STORAGE_ENABLED:"true",
  BYTEPLUS_ACCESS_KEY_ID:"synthetic-byteplus-id",BYTEPLUS_SECRET_ACCESS_KEY:"synthetic-byteplus-secret",
  R2_ACCOUNT_ID:"synthetic-account",R2_BUCKET:"synthetic-bucket",
  R2_ACCESS_KEY_ID:"synthetic-key",R2_SECRET_ACCESS_KEY:"synthetic-secret",
  CMS_ENABLED:"true",PAYLOAD_SECRET:"s".repeat(40),
  SUPPORT_CONTACT_VERIFIED:"support@example.test",
  CMS_DATABASE_URL:"postgresql://example.test/singmotion",
  APP_ORIGIN:"https://www.singmotion.ai",PUBLIC_SITE_ORIGIN:"https://www.singmotion.ai",
 };
 for(const proof of PUBLIC_CREDIT_RELEASE_EVIDENCE)env[proof]="true";
 return env;
}

test("reviewed public Credit-only release works WITHOUT legacy video checkout or worker",()=>{
 const env=approved();
 assert.equal(publicCreditReleaseApproved(env),true);
 assert.deepEqual(assessPublicCreditRelease(env).checks.filter(check=>!check.ready),[]);
 assert.equal(privateLiveCreditTestEnabled(env),false);
 assert.equal(productionCustomerReleaseApproved(env),false,"retired video worker stays off");
 assert.equal(stagingEnabled(env),false,"public website no longer requires private password");
 assert.equal(stagingAccess(null,env),200);
 assert.equal(stripeCreditTopupsLiveEnabled(env),true,"signed live prepaid Credits admitted");
 assert.equal(customerCreditStudioBetaEnabled(env),true,"account-scoped prepaid Studio admitted");
});

test("public prepaid Credit customers can register and use verified canonical identity without legacy worker",()=>{
 const env=approved();
 env.GOOGLE_OAUTH_CLIENT_ID="synthetic-google-id";
 env.GOOGLE_OAUTH_CLIENT_SECRET="synthetic-google-secret";
 env.RESEND_API_KEY="synthetic-resend-key";
 env.ACCOUNT_EMAIL_FROM="SingMotion AI <no-reply@singmotion.ai>";
 assert.equal(productionCustomerReleaseApproved(env),false);
 assert.equal(customerIdentityOrigin(env),"https://www.singmotion.ai");
 assert.equal(googleLoginReady(env),true);
 assert.equal(passwordResetReady(env),true);
 const auth=readFileSync(new URL("../app/(site)/api/customer-auth/route.ts",import.meta.url),"utf8");
 const origin=readFileSync(new URL("../lib/customer-identity-origin.ts",import.meta.url),"utf8");
 assert.match(auth,/publicCreditReleaseApproved\(process\.env\)/);
 assert.match(origin,/publicCreditReleaseApproved\(env\)/);
 assert.equal(customerIdentityOrigin({...env,LEGAL_REVIEW_APPROVED:"false"}),null);
 assert.equal(customerIdentityOrigin({...env,APP_ORIGIN:"https://evil.test"}),null);
 assert.equal(customerIdentityOrigin({...env,RAILWAY_ENVIRONMENT_ID:"dfaeabed-03df-43ed-aa71-50f343a75041",APP_ORIGIN:"https://www.singmotion.ai"}),null);
});

test("public Credit release fails CLOSED independently for every reviewed operator proof",()=>{
 const base=approved();
 for(const key of PUBLIC_CREDIT_RELEASE_EVIDENCE){
  const env={...base,[key]:"false"};
  assert.equal(publicCreditReleaseApproved(env),false,key);
  assert.equal(stagingEnabled(env),true,key);
  assert.equal(stripeCreditTopupsLiveEnabled(env),false,key);
  assert.equal(customerCreditStudioBetaEnabled(env),false,key);
 }
});

test("separately reject unsupported Stripe MoR, disabled Customer Studio, secret mismatch and public access",()=>{
 const base=approved();
 for(const [key,value] of [
  ["RAILWAY_ENVIRONMENT_ID","dfaeabed-03df-43ed-aa71-50f343a75041"],
  ["STAGING_AUTH_ENABLED","true"],
  ["PRODUCTION_PUBLIC_ACCESS_ENABLED","false"],
  ["PUBLIC_CUSTOMER_LAUNCH_APPROVED","false"],
  ["CREDIT_GLOBAL_MERCHANT_OF_RECORD","other"],
  ["STRIPE_MANAGED_PAYMENTS_ACCOUNT_APPROVED","false"],
  ["STRIPE_MANAGED_PAYMENTS_PREPAID_CREDITS_APPROVED","false"],
  ["STRIPE_MANAGED_PAYMENTS_LIVE_PRODUCT_REVIEWED","false"],
  ["STRIPE_CREDIT_TAX_CODE","txcd_10000000"],
  ["STRIPE_CREDIT_TOPUPS_LIVE_ENABLED","false"],
  ["STRIPE_LIVE_CHECKOUT_ENABLED","false"],
  ["STRIPE_SECRET_KEY","sk_test_wrong"],
  ["STRIPE_WEBHOOK_SECRET",""],
  ["CUSTOMER_PUBLIC_LIVE_CREDIT_VIDEO_ENABLED","false"],
  ["CUSTOMER_ACCOUNTS_ENABLED","false"],
  ["CUSTOMER_R2_STORAGE_ENABLED","false"],
  ["BYTEPLUS_ACCESS_KEY_ID",""],["BYTEPLUS_SECRET_ACCESS_KEY",""],
  ["R2_ACCOUNT_ID",""],["R2_SECRET_ACCESS_KEY",""],
  ["BYTEPLUS_STUDIO_RECOVERY_ENABLED","false"],
  ["CUSTOMER_BYTEPLUS_OWNER_CONFIRMED_PRICING","false"],
  ["BYTEPLUS_STUDIO_OPERATOR_SECRET","short"],
  ["HOBBY_SUBSCRIPTIONS_ENABLED","true"],
  ["CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED","true"],
  ["CMS_ENABLED","false"],
  ["CMS_DATABASE_URL",""],
  ["PAYLOAD_SECRET","short"],
  ["SUPPORT_CONTACT_VERIFIED",""],
  ["APP_ORIGIN","http://localhost:3000"],
  ["PUBLIC_SITE_ORIGIN","http://localhost:3000"],
  ["DEMO_MODE","false"],
  ["GENERATIONS_ENABLED","true"],
  ["ADMIN_DEMO_ENABLED","true"],
 ]){
  const env={...base,[key]:value};
  assert.equal(publicCreditReleaseApproved(env),false,key);
  assert.equal(stagingEnabled(env),true,key);
  assert.equal(stripeCreditTopupsLiveEnabled(env),false,key);
  assert.equal(customerCreditStudioBetaEnabled(env),false,key);
 }
});

test("existing private Production owner path stays independent of public credit release",()=>{
 const env=approved();
 env.STAGING_AUTH_ENABLED="true";
 env.PUBLIC_CUSTOMER_LAUNCH_APPROVED="false";
 env.PRODUCTION_PUBLIC_ACCESS_ENABLED="false";
 env.PRODUCTION_PRIVATE_CREDIT_TEST_ENABLED="true";
 env.CUSTOMER_PRIVATE_LIVE_CREDIT_VIDEO_ENABLED="true";
 env.STAGING_PASSWORD="s".repeat(40);
 env.PRODUCTION_SANDBOX_PILOT_ENABLED="false";
 assert.equal(publicCreditReleaseApproved(env),false);
 assert.equal(privateLiveCreditTestEnabled(env),true);
 assert.equal(stripeCreditTopupsLiveEnabled(env),true);
 assert.equal(customerCreditStudioBetaEnabled(env),true);
 assert.equal(stagingEnabled(env),true);
 assert.equal(stagingAccess(null,env),401);
});

test("public Credit diagnostics print only predefined gate names, not private values",()=>{
 const env=approved();
 const report=assessPublicCreditRelease({...env,LEGAL_REVIEW_APPROVED:"false"});
 assert.deepEqual(report.checks.filter(x=>!x.ready).map(x=>x.id),["LEGAL_REVIEW_APPROVED"]);
 assert.doesNotMatch(JSON.stringify(report),/sk_live_synthetic|whsec_synthetic|postgresql:\/\/|support@example/);
 const worker=readFileSync(new URL("../scripts/worker.ts",import.meta.url),"utf8");
 assert.match(worker,/PUBLIC_CREDIT_RELEASE_READINESS/);
 assert.match(worker,/assessPublicCreditRelease\(process\.env\)/);
 assert.match(worker,/check=>!check\.ready/);
});

test("new public Credit admission wired into Checkout, balance, webhook and live Studio",()=>{
 const read=(p:string)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
 for(const path of [
  "app/(site)/api/credit-checkout/route.ts",
  "app/(site)/api/credit-balance/route.ts",
  "app/(site)/api/stripe-webhook/route.ts",
  "lib/commerce/credit-wallet.ts",
  "lib/commerce/customer-credit-studio-beta.ts",
  "lib/staging.ts",
 ]){
  assert.match(read(path),/publicCreditReleaseApproved/,path);
 }
 const videoRoute=read("app/(site)/api/studio-live/route.ts");
 assert.match(videoRoute,/customerCreditStudioBetaEnabled\(process\.env\)/);
 assert.match(videoRoute,/owner!=="customer-"\+customerId/);
 assert.match(videoRoute,/commerce\.emailVerified\(customerId\)/);
 assert.match(videoRoute,/req\.headers\.get\("origin"\)!==origin/);
});
