import {test} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {CommerceStore} from "../lib/commerce/store.ts";
import {sendCustomerVerificationEmail} from "../lib/commerce/verification-email.ts";
import {ensurePaidCreditEmail} from "../lib/commerce/credit-topup-email.ts";

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

test("LIVE credit receipt is sent once, only after paid wallet settlement and without inventing a tax invoice",async()=>{
 const store=new CommerceStore(":memory:");
 const emails:Array<{body:{to:string[];text:string};headers:HeadersInit|undefined}>=[];
 const fake=async (_:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
  emails.push({body:JSON.parse(String(init?.body)),headers:init?.headers});
  return new Response(JSON.stringify({id:"synthetic-email"}),{status:200});
 };
 try{
  store.db.exec("CREATE TABLE credit_topup_purchases(id TEXT PRIMARY KEY,email TEXT NOT NULL,credits INTEGER NOT NULL,cents INTEGER NOT NULL,status TEXT NOT NULL)");
  const id="11111111-1111-4111-8111-111111111111";
  store.db.prepare("INSERT INTO credit_topup_purchases VALUES(?,?,?,?,?)")
   .run(id,"verified@example.test",500,500,"pending");
  assert.equal(await ensurePaidCreditEmail(store,id,preview,fake as typeof fetch),false);
  assert.equal(emails.length,0,"no email before Stripe settlement");
  store.db.prepare("UPDATE credit_topup_purchases SET status='paid' WHERE id=?").run(id);
  assert.equal(await ensurePaidCreditEmail(store,id,preview,fake as typeof fetch),true);
  assert.equal(await ensurePaidCreditEmail(store,id,preview,fake as typeof fetch),true);
  assert.equal(emails.length,1,"a webhook replay cannot resend the same receipt");
  assert.deepEqual(emails[0].body.to,["verified@example.test"]);
  assert.match(emails[0].body.text,/EUR 5\.00/);
  assert.match(emails[0].body.text,/not a tax invoice/);
  assert.match(emails[0].body.text,/account\/settings#invoices/);
  assert.equal((emails[0].headers as Record<string,string>)["Idempotency-Key"],"singmotion-credit-payment/"+id);
 }finally{store.close()}
});
test("failed email delivery leaves paid receipt pending for a signed webhook retry",async()=>{
 const store=new CommerceStore(":memory:");
 let count=0;
 const fake=async ():Promise<Response>=>{count++;return new Response("failed",{status:503});};
 try{
  const id="22222222-2222-4222-8222-222222222222";
  store.db.exec("CREATE TABLE credit_topup_purchases(id TEXT PRIMARY KEY,email TEXT NOT NULL,credits INTEGER NOT NULL,cents INTEGER NOT NULL,status TEXT NOT NULL)");
  store.db.prepare("INSERT INTO credit_topup_purchases VALUES(?,?,?,?,?)").run(id,"customer@example.test",750,750,"paid");
  assert.equal(await ensurePaidCreditEmail(store,id,preview,fake as typeof fetch),false);
  assert.equal(await ensurePaidCreditEmail(store,id,preview,fake as typeof fetch),false);
  assert.equal(count,2);
  assert.equal((store.db.prepare("SELECT COUNT(*) AS n FROM credit_topup_email_notifications").get() as {n:number}).n,0);
 }finally{store.close()}
});
test("invoice lookup binds each paid session to its LIVE or TEST key, never the reversal-mode default",()=>{
 const route=readFileSync(new URL("../app/(site)/api/customer-invoices/route.ts",import.meta.url),"utf8");
 assert.match(route,/stripeSessionIdMatchesMode\(row\.session_id,"live"\)/);
 assert.match(route,/credentials\.get\(mode\)/);
 assert.doesNotMatch(route,/configuredStripeReversalMode/);
 const hook=readFileSync(new URL("../app/(site)/api/stripe-webhook/route.ts",import.meta.url),"utf8");
 assert.match(hook,/ensurePaidCreditEmail\(store,purchaseId\)/);
});
