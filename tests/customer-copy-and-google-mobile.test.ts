import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {customerIdentityOrigin,googleLoginReady,trustedIdentityHost} from "../lib/customer-identity-origin.ts";

const read=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const prod="36adc41d-7e54-4396-ad1a-fd432ba0441d";
const root="https://www.singmotion.ai";
const invitedBeta={
 RAILWAY_ENVIRONMENT_ID:prod,APP_ORIGIN:root,PUBLIC_SITE_ORIGIN:root,CMS_ORIGIN:root,
 CUSTOMER_ACCOUNTS_ENABLED:"true",
 PRODUCTION_PRIVATE_CUSTOMER_PREVIEW_ENABLED:"false",
 PRODUCTION_PRIVATE_INTERNATIONAL_CREDIT_BETA_ENABLED:"true",
 STAGING_AUTH_ENABLED:"true",STAGING_PASSWORD:"s".repeat(48),PRIVATE_BETA_PASSWORD:"b".repeat(48),
 PUBLIC_CUSTOMER_LAUNCH_APPROVED:"false",PRODUCTION_PUBLIC_ACCESS_ENABLED:"false",
 DEMO_MODE:"true",GENERATIONS_ENABLED:"false",ADMIN_DEMO_ENABLED:"false",
 GOOGLE_OAUTH_CLIENT_ID:"synthetic-google-client",GOOGLE_OAUTH_CLIENT_SECRET:"synthetic-secret",
};

test("invited worldwide beta may access Google OAuth without public or legacy-preview flags",()=>{
 assert.equal(customerIdentityOrigin(invitedBeta),root);
 assert.equal(googleLoginReady(invitedBeta),true);
 assert.equal(trustedIdentityHost("www.singmotion.ai",root),true);
 for(const patch of [
  {PRIVATE_BETA_PASSWORD:""}, {PRIVATE_BETA_PASSWORD:invitedBeta.STAGING_PASSWORD},
  {STAGING_AUTH_ENABLED:"false"}, {PRODUCTION_PRIVATE_INTERNATIONAL_CREDIT_BETA_ENABLED:"false"},
  {PRODUCTION_PUBLIC_ACCESS_ENABLED:"true"}, {PUBLIC_CUSTOMER_LAUNCH_APPROVED:"true"},
  {APP_ORIGIN:"https://example.net"}, {CUSTOMER_ACCOUNTS_ENABLED:"false"},
  {RAILWAY_ENVIRONMENT_ID:"unknown"},
 ]){
  const env={...invitedBeta,...patch};
  assert.equal(customerIdentityOrigin(env),null,JSON.stringify(patch));
  assert.equal(googleLoginReady(env),false,JSON.stringify(patch));
 }
 const auth=read("app/(site)/api/customer-auth/route.ts");
 assert.match(auth,/privateBetaPasswordEnabled\(process\.env\)/);
 const begin=read("app/(site)/api/google-auth/route.ts");
 const callback=read("app/(site)/api/google-auth/callback/route.ts");
 assert.match(begin,/googleLoginReady\(process\.env\)/);
 assert.match(begin,/code_challenge_method:"S256"/);
 assert.match(begin,/sameSite:"lax"/);
 assert.match(callback,/identity\.email_verified!=="true"/);
 assert.match(callback,/saved\.nonce/);
 assert.match(callback,/store\.googleLogin\(identity\.sub,identity\.email\)/);
});

test("Google button appears ONCE before email on login AND registration, including mobile",()=>{
 const panel=read("components/account-panel.tsx");
 const css=read("app/(site)/carousel.css");
 const mobile=read("app/(site)/login/standalone-login.css");
 assert.match(panel,/\{googleAvailable&&<>/);
 assert.doesNotMatch(panel,/googleAvailable&&mode==="login"/);
 const button=panel.indexOf('className="sm-account-google"');
 const input=panel.indexOf('className="sm-account-label">Email address');
 assert.ok(button>0&&input>button,"Google action must precede Email on both auth tabs");
 assert.equal(panel.split('className="sm-account-google"').length-1,1,"no duplicate Google button");
 assert.match(panel,/href="\/api\/google-auth\?start=1"/);
 assert.match(css,/\.sm-carousel-login \.sm-account-google\{[^}]*display:flex/);
 assert.match(mobile,/\.sm-standalone-auth \.sm-carousel-login \.sm-account-google/);
 assert.match(mobile,/@media\(max-width:760px\)/);
});

test("customers see relevant guidance, never operational Staging/test/preview disclaimers",()=>{
 const screens=[
  "components/account-panel.tsx","components/site-footer.tsx",
  "components/contact-form.tsx","components/help-faq.tsx",
  "components/customer-video-checkout.tsx",
 ];
 for(const file of screens){
  const src=read(file);
  assert.doesNotMatch(src,/STAGING test account|Development preview|not yet available; please do not use|Staging offers Stripe sandbox|customer test account|operator must finish verified mail/i,file);
 }
 const panel=read("components/account-panel.tsx");
 assert.match(panel,/Your videos and drafts stay private/);
 assert.match(panel,/Contact support if you cannot access/);
 assert.doesNotMatch(panel,/Password recovery will be available after email setup/);
 assert.match(read("components/site-footer.tsx"),/© SingMotion AI/);
 const help=read("components/help-faq.tsx");
 assert.match(help,/invited customers behind a shared website password/);
 assert.match(help,/eligible countries/);
 const legacy=read("app/(site)/settings/page.tsx");
 assert.match(legacy,/redirect\("\/account\/settings"\)/);
 assert.doesNotMatch(read("components/customer-video-checkout.tsx"),/Stripe Test Mode on Staging/);
 assert.match(read("components/contact-form.tsx"),/mailto:support@singmotion\.ai/);
});
