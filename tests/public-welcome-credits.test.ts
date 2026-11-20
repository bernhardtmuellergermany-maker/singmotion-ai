import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {CommerceStore} from "../lib/commerce/store.ts";
import {CreditWallet} from "../lib/commerce/credit-wallet.ts";
import {NotificationInbox} from "../lib/commerce/notifications.ts";
import {PUBLIC_CREDIT_RELEASE_EVIDENCE} from "../lib/commerce/public-credit-release.ts";
import {publicWelcomeCreditsEnabled,grantPublicWelcomeCredits,PUBLIC_WELCOME_ACCOUNT_LIMIT,PUBLIC_WELCOME_CREDITS} from "../lib/commerce/public-welcome-credits.ts";
const e:Record<string,string>={
 RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d",
 PUBLIC_CUSTOMER_LAUNCH_APPROVED:"true",PRODUCTION_PUBLIC_ACCESS_ENABLED:"true",STAGING_AUTH_ENABLED:"false",
 CUSTOMER_PUBLIC_WELCOME_CREDITS_ENABLED:"true",DEMO_MODE:"true",GENERATIONS_ENABLED:"false",ADMIN_DEMO_ENABLED:"false",
 HOBBY_SUBSCRIPTIONS_ENABLED:"false",CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED:"false",
 CREDIT_GLOBAL_MERCHANT_OF_RECORD:"stripe-managed",STRIPE_MANAGED_PAYMENTS_ACCOUNT_APPROVED:"true",
 STRIPE_MANAGED_PAYMENTS_PREPAID_CREDITS_APPROVED:"true",STRIPE_MANAGED_PAYMENTS_LIVE_PRODUCT_REVIEWED:"true",
 STRIPE_CREDIT_TAX_CODE:"txcd_10105003",STRIPE_CREDIT_TOPUPS_LIVE_ENABLED:"true",
 STRIPE_LIVE_CHECKOUT_ENABLED:"true",STRIPE_SECRET_KEY:"sk_live_synthetic_fixture",
 STRIPE_WEBHOOK_SECRET:"whsec_synthetic_fixture",CUSTOMER_PUBLIC_LIVE_CREDIT_VIDEO_ENABLED:"true",
 CUSTOMER_ACCOUNTS_ENABLED:"true",CUSTOMER_BYTEPLUS_OWNER_CONFIRMED_PRICING:"true",
 BYTEPLUS_STUDIO_RECOVERY_ENABLED:"true",BYTEPLUS_STUDIO_OPERATOR_SECRET:"o".repeat(40),
 CUSTOMER_R2_STORAGE_ENABLED:"true",BYTEPLUS_ACCESS_KEY_ID:"synthetic-byteplus-id",
 BYTEPLUS_SECRET_ACCESS_KEY:"synthetic-byteplus-secret",
 R2_ACCOUNT_ID:"synthetic-account",R2_BUCKET:"synthetic-bucket",
 R2_ACCESS_KEY_ID:"synthetic-key",R2_SECRET_ACCESS_KEY:"synthetic-secret",
 CMS_ENABLED:"true",PAYLOAD_SECRET:"p".repeat(40),SUPPORT_CONTACT_VERIFIED:"support@example.test",
 CMS_DATABASE_URL:"postgresql://example.test/singmotion",
 APP_ORIGIN:"https://www.singmotion.ai",PUBLIC_SITE_ORIGIN:"https://www.singmotion.ai"
};
for(const id of PUBLIC_CREDIT_RELEASE_EVIDENCE)e[id]="true";

test("promotion is only available to approved public Production signups",()=>{
 assert.equal(PUBLIC_WELCOME_CREDITS,100);
 assert.equal(PUBLIC_WELCOME_ACCOUNT_LIMIT,50);
 assert.equal(publicWelcomeCreditsEnabled(e),true);
 for(const patch of [
  {CUSTOMER_PUBLIC_WELCOME_CREDITS_ENABLED:"false"},
  {RAILWAY_ENVIRONMENT_ID:"dfaeabed-03df-43ed-aa71-50f343a75041"},
  {STAGING_AUTH_ENABLED:"true"},{PRODUCTION_PUBLIC_ACCESS_ENABLED:"false"},
  {PUBLIC_CUSTOMER_LAUNCH_APPROVED:"false"},{LEGAL_REVIEW_APPROVED:"false"}
 ])assert.equal(publicWelcomeCreditsEnabled({...e,...patch}),false,JSON.stringify(patch));
});

test("exactly the first 50 accounts get 100 credits, no 51st bonus, including Google accounts",()=>{
 const store=new CommerceStore(":memory:",e);
 try{
  const wallet=new CreditWallet(store.db);
  const first=store.register("launch-first@example.test","securepassword123"),subject="customer:"+first;
  assert.equal(wallet.available(subject),100);
  assert.equal(store.session(store.login("launch-first@example.test","securepassword123")),first);
  assert.equal(wallet.total(subject),100);
  assert.equal(grantPublicWelcomeCredits(store.db,first),false);
  const notice=new NotificationInbox(store.db).list(subject);
  assert.equal(notice.unread,1);
  assert.equal(notice.notifications[0].kind,"gift");
  assert.match(notice.notifications[0].message,/100 free welcome Credits/);
  assert.throws(()=>store.register("launch-first@example.test","securepassword123"));
  for(let i=1;i<50;i++){
   const sub=String(100000000000+i),email="launch-"+i+"@example.test";
   const account=store.googleLogin(sub,email);
   assert.equal(wallet.total("customer:"+account.id),100);
   assert.equal(store.googleLogin(sub,email).id,account.id);
   assert.equal(wallet.total("customer:"+account.id),100);
  }
  const counter=()=>Number((store.db.prepare("SELECT issued FROM public_welcome_grant_counter WHERE id=1").get() as {issued:number}).issued);
  assert.equal(counter(),50);
  const fiftyFirst=store.register("launch-51@example.test","securepassword123");
  const fiftySecond=store.googleLogin("300000000012","launch-52@example.test");
  assert.equal(wallet.total("customer:"+fiftyFirst),0);
  assert.equal(wallet.total("customer:"+fiftySecond.id),0);
  assert.equal(counter(),50);
  assert.equal((store.db.prepare("SELECT COUNT(*) AS n FROM credit_wallet_ledger WHERE kind='public-welcome'")
   .get() as {n:number}).n,50);
 }finally{store.close()}
});

test("private Beta signups receive neither retired Beta nor public launch Credits",()=>{
 const store=new CommerceStore(":memory:",{...e,STAGING_AUTH_ENABLED:"true",
  PRODUCTION_PUBLIC_ACCESS_ENABLED:"false",CUSTOMER_BETA_WELCOME_CREDITS_ENABLED:"true"});
 try{
  const id=store.register("private-new@example.test","securepassword123");
  assert.equal(new CreditWallet(store.db).total("customer:"+id),0);
 }finally{store.close()}
});

test("welcome Credits are wallet Credits with normal reservation and settlement rules",()=>{
 const store=new CommerceStore(":memory:",e);
 try{
  const id=store.register("launch-spend@example.test","securepassword123");
  const wallet=new CreditWallet(store.db),subject="customer:"+id,project=randomUUID();
  wallet.reserveVideo(project,subject,99);
  assert.equal(wallet.available(subject),1);
  wallet.reconcileVideo(project,"completed");
  assert.equal(wallet.available(subject),1);
 }finally{store.close()}
});
