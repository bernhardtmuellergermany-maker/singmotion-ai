import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {LiveTestStore,confirmationPhrase} from "../lib/live/store.ts";
import {customerCreditStudioBetaEnabled,exactCustomerCreditSubject} from "../lib/commerce/customer-credit-studio-beta.ts";

const root=new URL("../",import.meta.url);
function read(path:string){return readFileSync(new URL(path,root),"utf8")}
const staging="dfaeabed-03df-43ed-aa71-50f343a75041";
function env():Record<string,string>{
 return {RAILWAY_ENVIRONMENT_ID:staging,CUSTOMER_CREDIT_STUDIO_TEST_ENABLED:"true",
 STAGING_AUTH_ENABLED:"true",DEMO_MODE:"true",GENERATIONS_ENABLED:"false",
 CUSTOMER_ACCOUNTS_ENABLED:"true",STRIPE_CREDIT_TOPUPS_TEST_ENABLED:"true",
 STRIPE_SECRET_KEY:"sk_test_fakekey12345",STRIPE_WEBHOOK_SECRET:"whsec_fakekey12345",
 CUSTOMER_BYTEPLUS_OWNER_CONFIRMED_PRICING:"true",BYTEPLUS_STUDIO_ENABLED:"true",
 BYTEPLUS_STUDIO_RECOVERY_ENABLED:"true",BYTEPLUS_STUDIO_OPERATOR_SECRET:"z".repeat(40),
 CUSTOMER_R2_STORAGE_ENABLED:"true"};
}
test("Customer generation beta requires private Staging, Stripe TEST, pricing and provider recovery",()=>{
 const good=env();
 assert.equal(customerCreditStudioBetaEnabled(good),true);
 for(const [key,value] of [
  ["RAILWAY_ENVIRONMENT_ID","36adc41d-7e54-4396-ad1a-fd432ba0441d"],
  ["CUSTOMER_CREDIT_STUDIO_TEST_ENABLED","false"],["STRIPE_SECRET_KEY","sk_live_notallowed"],
  ["STRIPE_CREDIT_TOPUPS_TEST_ENABLED","false"],["BYTEPLUS_STUDIO_RECOVERY_ENABLED","false"],
  ["CUSTOMER_BYTEPLUS_OWNER_CONFIRMED_PRICING","false"],["STAGING_AUTH_ENABLED","false"],
  ["GENERATIONS_ENABLED","true"]]){
  assert.equal(customerCreditStudioBetaEnabled({...good,[key]:value}),false,key);
 }
});
test("Credit wallet identity must belong to the SAME logged-in customer media owner",()=>{
 const id="7135eadf-16e9-495a-a732-eaf996a3368e";
 assert.equal(exactCustomerCreditSubject("customer-"+id,"customer:"+id),true);
 assert.equal(exactCustomerCreditSubject("customer-"+id,"customer:another"),false);
 assert.equal(exactCustomerCreditSubject("cms-staff-1","customer:"+id),false);
 assert.equal(exactCustomerCreditSubject("customer-"+id,"super-admin:"+id),false);
});
test("Customer Studio route uses verified email, private media session, CSRF and account-scoped Wallet",()=>{
 const api=read("app/(site)/api/studio-live/route.ts"),wallet=read("lib/live/studio.ts");
 assert.match(api,/commerce\.emailVerified\(customerId\)/);
 assert.match(api,/owner!=="customer-"\+customerId/);
 assert.match(api,/customerBeta && !\["prepare","submit","poll"/);
 assert.match(api,/req\.headers\.get\("origin"\)!==origin/);
 assert.match(api,/expectedSubject=customerBeta\?"customer:"\+actor/);
 assert.match(wallet,/matchedCustomer/);
 assert.match(wallet,/wallet\.reserveVideo\(id,verifiedCreditSubject,quote\.credits\)/);
 assert.match(wallet,/!this\.requirePrepaidCredits && !this\.superAdmin/);
 const wizard=read("components/studio-wizard.tsx");
 assert.match(wizard,/const creditStudio=operatorStudio\|\|owner\.startsWith\("customer-"\)/);
 assert.match(wizard,/access\.customerBeta/);
 assert.match(wizard,/Continue project · Step 4|Buy Credits and return to Step 4/);
});
test("Customer Beta provider job reserves global USD lifetime and daily ceilings",()=>{
 const store=new LiveTestStore(":memory:");
 const config={demoMode:false,enabled:true,operatorSecret:"s".repeat(40),
  maxDurationSeconds:30,maxJobMicroUsd:2500000,maxTotalMicroUsd:10000000};
 function add(owner:string,micro:number,createdAt:number,reserved:number){
  const id=crypto.randomUUID();
  const row={id,media:{sourceJobId:"studio-"+id,owner,durationSeconds:5},
   contractRevision:"reviewed-beta",upperBoundMicroUsd:micro,
   state:"prepared",providerJobId:null,outputPath:null,failureCode:null,
   createdAt,updatedAt:createdAt};
  store.db.prepare("INSERT INTO live_attempts(id,source_job_id,data,reserved_micro_usd) VALUES(?,?,?,?)")
   .run(id,row.media.sourceJobId,JSON.stringify(row),reserved);
  return row;
 }
 try {
  const owner="customer-7135eadf-16e9-495a-a732-eaf996a3368e";
  add("cms-staff-admin",20_000_000,Date.now(),20_000_000);
  const allowed=add(owner,400_000,Date.now(),0);
  const token=store.authorize(allowed.id,config,config.operatorSecret,confirmationPhrase(allowed as Parameters<typeof confirmationPhrase>[0]));
  assert.equal(typeof token,"string");
  add("customer-d8db2fa7-ec04-44db-a975-0b46b8e85ef4",2_000_000,Date.now(),2_000_000);
  const daily=add(owner,400_000,Date.now(),0);
  assert.throws(()=>store.authorize(daily.id,config,config.operatorSecret,confirmationPhrase(daily as Parameters<typeof confirmationPhrase>[0])),/daily provider cap reached/);
 }finally{store.close();}
});
test("Customer Beta production guard always stays closed",()=>{
 const api=read("lib/commerce/customer-credit-studio-beta.ts");
 const data=read("lib/live/store.ts");
 assert.match(api,/STAGING="dfaeabed-03df-43ed-aa71-50f343a75041"/);
 assert.match(data,/attempt\.media\.owner\.startsWith\("customer-"\)/);
 assert.match(data,/daily\.total\+attempt\.upperBoundMicroUsd!>2500000/);
 assert.match(data,/cumulativeCap!==Number\.MAX_SAFE_INTEGER/);
});
