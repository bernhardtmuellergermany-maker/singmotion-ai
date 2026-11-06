import {test} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {CommerceStore} from "../lib/commerce/store.ts";
import {sendCustomerVerificationEmail} from "../lib/commerce/verification-email.ts";

const password="Strong customer password 2026!";
const preview={
 RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d",
 APP_ORIGIN:"https://www.singmotion.ai",
 CMS_ORIGIN:"https://www.singmotion.ai",
 CUSTOMER_ACCOUNTS_ENABLED:"true",PRODUCTION_PRIVATE_CUSTOMER_PREVIEW_ENABLED:"true",
 STAGING_AUTH_ENABLED:"true",STAGING_PASSWORD:"a".repeat(40),
 PRODUCTION_PUBLIC_ACCESS_ENABLED:"false",PUBLIC_CUSTOMER_LAUNCH_APPROVED:"false",
 STRIPE_LIVE_CHECKOUT_ENABLED:"false",HOBBY_SUBSCRIPTIONS_ENABLED:"false",
 CUSTOMER_PAID_WORKER_ENABLED:"false",CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED:"false",
 DEMO_MODE:"true",GENERATIONS_ENABLED:"false",ADMIN_DEMO_ENABLED:"false",
 RESEND_API_KEY:"re_synthetic_not_live",ACCOUNT_EMAIL_FROM:"SingMotion AI <no-reply@singmotion.ai>",
};
test("new customer starts pending and cannot pass verified-email prepayment gate",()=>{
 const store=new CommerceStore(":memory:");
 try{
  const id=store.register("Customer@example.test",password);
  assert.equal(store.emailVerified(id),false);
  assert.equal(store.verificationState(id),"pending");
  assert.equal(store.login("customer@example.test",password).length>30,true);
  const sent=store.issueEmailVerification(id,1000000);
  assert.equal(sent?.email,"customer@example.test");
  assert.ok(sent?.token&&sent.token.length>=40);
  assert.equal(store.issueEmailVerification(id,1000500),null,"60-second cooldown");
  assert.equal(store.verifyEmailToken(sent!.token,1000000+24*3600000+1),false,"expired");
  assert.equal(store.verifyEmailToken(sent!.token,1000200),true);
  assert.equal(store.emailVerified(id),true);
  assert.equal(store.verificationState(id),"verified");
  assert.equal(store.verifyEmailToken(sent!.token,1000300),false,"one-time token");
  assert.equal(store.issueEmailVerification(id,1000500),null);
 }finally{store.close()}
});
test("resend invalidates old token, rejects bogus token and permits retry after send failure",()=>{
 const store=new CommerceStore(":memory:");
 try{
  const id=store.register("resend@example.test",password);
  const first=store.issueEmailVerification(id,1000000)!;
  store.invalidateEmailVerification(first.token);
  assert.equal(store.verifyEmailToken(first.token,1000100),false);
  assert.equal(store.issueEmailVerification(id,1000001),null,"failed sends still throttled");
  const next=store.issueEmailVerification(id,1060001)!;
  assert.notEqual(first.token,next.token);
  assert.equal(store.verifyEmailToken(first.token,1060050),false);
  assert.equal(store.verifyEmailToken("broken-token",1060050),false);
  assert.equal(store.verifyEmailToken(next.token,1060050),true);
 }finally{store.close()}
});
test("verified Google identities are trusted after OAuth verification; old accounts are not locked out",()=>{
 const db=new DatabaseSync(":memory:");
 // Simulate a customer registered before the email-verification migration.
 db.exec("CREATE TABLE customer_accounts(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,created INTEGER NOT NULL)");
 db.prepare("INSERT INTO customer_accounts VALUES(?,?,?,?)").run("old-customer","old@example.test","legacy-salt:legacy-digest",1);
 const store=new CommerceStore(":memory:");
 try{
  // Same legacy table shape is read by the current store without a row in the new verification table.
  store.db.prepare("INSERT INTO customer_accounts VALUES(?,?,?,?)").run("old-customer","old@example.test","legacy-salt:legacy-digest",1);
  assert.equal(store.emailVerified("old-customer"),true);
  assert.equal(store.verificationState("old-customer"),"legacy");
  const google=store.googleLogin("12345678901234567890","google@example.test");
  assert.equal(store.verificationState(google.id),"verified");
  assert.equal(store.issueEmailVerification(google.id),null);
 }finally{store.close();db.close()}
});
test("verification mail uses exact trusted domain and never accepts unreviewed or unconfigured domains",async()=>{
 const sent:Array<{url:string;body:string}>=[];
 const mock=async (url:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
  sent.push({url:String(url),body:String(init?.body)});
  return new Response(JSON.stringify({id:"synthetic"}),{status:200});
 };
 assert.equal(await sendCustomerVerificationEmail("customer@example.test","synthetic-token",preview,mock as typeof fetch),true);
 assert.equal(sent.length,1);
 const mail=JSON.parse(sent[0].body);
 assert.equal(sent[0].url,"https://api.resend.com/emails");
 assert.deepEqual(mail.to,["customer@example.test"]);
 assert.ok(mail.text.includes("https://www.singmotion.ai/account/verify-email?token=synthetic-token"));
 assert.ok(!sent[0].body.includes(preview.RESEND_API_KEY));
 assert.equal(await sendCustomerVerificationEmail("customer@example.test","synthetic-token",{...preview,APP_ORIGIN:"https://evil.test"},mock as typeof fetch),false);
 assert.equal(await sendCustomerVerificationEmail("customer@example.test","synthetic-token",{...preview,RESEND_API_KEY:""},mock as typeof fetch),false);
 assert.equal(sent.length,1,"rejects unsafe mail before network call");
});
