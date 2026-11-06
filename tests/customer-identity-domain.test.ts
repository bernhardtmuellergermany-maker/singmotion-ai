import {test} from "node:test";
import assert from "node:assert/strict";
import {customerIdentityOrigin,googleLoginReady,passwordResetReady,trustedIdentityHost} from "../lib/customer-identity-origin.ts";
const stage="dfaeabed-03df-43ed-aa71-50f343a75041";
const production="36adc41d-7e54-4396-ad1a-fd432ba0441d";
const root="https://www.singmotion.ai";
const stageOrigin="https://singmotion-ai-staging.up.railway.app";
const preview={
 RAILWAY_ENVIRONMENT_ID:production,APP_ORIGIN:root,CMS_ORIGIN:root,
 CUSTOMER_ACCOUNTS_ENABLED:"true",PRODUCTION_PRIVATE_CUSTOMER_PREVIEW_ENABLED:"true",
 STAGING_AUTH_ENABLED:"true",STAGING_PASSWORD:"a".repeat(40),
 PRODUCTION_PUBLIC_ACCESS_ENABLED:"false",PUBLIC_CUSTOMER_LAUNCH_APPROVED:"false",
 STRIPE_LIVE_CHECKOUT_ENABLED:"false",HOBBY_SUBSCRIPTIONS_ENABLED:"false",
 CUSTOMER_PAID_WORKER_ENABLED:"false",CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED:"false",
 DEMO_MODE:"true",GENERATIONS_ENABLED:"false",ADMIN_DEMO_ENABLED:"false",
};
test("Google and reset use the exact approved production HTTPS domain in a protected preview",()=>{
 assert.equal(customerIdentityOrigin(preview),root);
 assert.equal(trustedIdentityHost("www.singmotion.ai",root),true);
 for(const host of ["singmotion.ai","www.singmotion.ai.attacker.test","evil.test",null,"WWW.SINGMOTION.AI"])
  assert.equal(trustedIdentityHost(host,root),false);
 assert.equal(googleLoginReady(preview),false);
 assert.equal(passwordResetReady(preview),false);
 assert.equal(googleLoginReady({...preview,GOOGLE_OAUTH_CLIENT_ID:"id",GOOGLE_OAUTH_CLIENT_SECRET:"secret"}),true);
 assert.equal(passwordResetReady({...preview,RESEND_API_KEY:"re_synthetic",ACCOUNT_EMAIL_FROM:"SingMotion AI <no-reply@singmotion.ai>"}),true);
});
test("incorrect origin, unreviewed production, and unsafe public flags disable all customer identity endpoints",()=>{
 for(const changes of [
  {APP_ORIGIN:"https://singmotion-ai-production.up.railway.app"},
  {APP_ORIGIN:"http://www.singmotion.ai"},
  {APP_ORIGIN:"https://www.singmotion.ai/"},
  {APP_ORIGIN:"https://evil.test"},
  {PRODUCTION_PRIVATE_CUSTOMER_PREVIEW_ENABLED:"false"},
  {STAGING_AUTH_ENABLED:"false"},
  {PRODUCTION_PUBLIC_ACCESS_ENABLED:"true"},
  {PUBLIC_CUSTOMER_LAUNCH_APPROVED:"true"},
  {STRIPE_LIVE_CHECKOUT_ENABLED:"true"},
  {CUSTOMER_ACCOUNTS_ENABLED:"false"},
  {RAILWAY_ENVIRONMENT_ID:"unknown"},
 ]){
  const env={...preview,...changes,GOOGLE_OAUTH_CLIENT_ID:"id",GOOGLE_OAUTH_CLIENT_SECRET:"secret",RESEND_API_KEY:"key",ACCOUNT_EMAIL_FROM:"no-reply@singmotion.ai"};
  assert.equal(customerIdentityOrigin(env),null,JSON.stringify(changes));
  assert.equal(googleLoginReady(env),false);
  assert.equal(passwordResetReady(env),false);
 }
});
test("staging identity remains staging-bound and never accepts the production callback",()=>{
 const env={RAILWAY_ENVIRONMENT_ID:stage,CUSTOMER_ACCOUNTS_ENABLED:"true",APP_ORIGIN:stageOrigin,
  CMS_ORIGIN:stageOrigin,GOOGLE_OAUTH_CLIENT_ID:"id",GOOGLE_OAUTH_CLIENT_SECRET:"secret"};
 assert.equal(customerIdentityOrigin(env),stageOrigin);
 assert.equal(googleLoginReady(env),true);
 assert.equal(customerIdentityOrigin({...env,APP_ORIGIN:root}),null);
 assert.equal(customerIdentityOrigin({...env,RAILWAY_ENVIRONMENT_ID:production}),null);
});
