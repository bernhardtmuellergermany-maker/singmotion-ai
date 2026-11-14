import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {mkdtemp,mkdir,writeFile,rm,readFileSync} from "node:fs";
import {mkdtemp as mkdtempAsync,mkdir as mkdirAsync,writeFile as writeFileAsync,rm as rmAsync} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {retryStudioCreditVideoReadyNotifications} from "../lib/commerce/video-ready-notifications.ts";
import {
 customerVideoReadyEmailPreference,updateCustomerVideoReadyEmailPreference
} from "../lib/commerce/customer-email-preferences.ts";

const account="7135eadf-16e9-495a-a732-eaf996a3368e";
const other="d8db2fa7-ec04-44db-a975-0b46b8e85ef4";
const origin="https://singmotion-ai-staging.up.railway.app";
const env={
 RAILWAY_ENVIRONMENT_ID:"dfaeabed-03df-43ed-aa71-50f343a75041",
 CUSTOMER_ACCOUNTS_ENABLED:"true",APP_ORIGIN:origin,
 RESEND_API_KEY:"test-outbox-token",ACCOUNT_EMAIL_FROM:"notifications@singmotion.ai"
};
async function fixture(){
 const root=await mkdtempAsync(path.join(tmpdir(),"studio-video-mail-"));
 await mkdirAsync(path.join(root,"live-output"));
 const commerce=new DatabaseSync(path.join(root,"commerce.sqlite"));
 const live=new DatabaseSync(path.join(root,"live-test.sqlite"));
 commerce.exec("CREATE TABLE customer_accounts(id TEXT PRIMARY KEY,email TEXT NOT NULL)");
 commerce.prepare("INSERT INTO customer_accounts VALUES(?,?)").run(account,"test-account@example.com");
 commerce.prepare("INSERT INTO customer_accounts VALUES(?,?)").run(other,"another-account@example.com");
 live.exec("CREATE TABLE live_attempts(id TEXT PRIMARY KEY,data TEXT NOT NULL);CREATE TABLE live_studio_projects(attempt_id TEXT PRIMARY KEY,owner TEXT NOT NULL)");
 async function completed(id:string,owner:string,updatedAt:number){
  const outputPath=path.join(root,"live-output",id+".mp4");
  await writeFileAsync(outputPath,"validated-mp4-fixture");
  live.prepare("INSERT INTO live_attempts VALUES(?,?)").run(id,JSON.stringify({state:"completed",outputPath,updatedAt}));
  live.prepare("INSERT INTO live_studio_projects VALUES(?,?)").run(id,"customer-"+owner);
 }
 return {root,commerce,live,completed,async close(){live.close();commerce.close();await rmAsync(root,{force:true,recursive:true})}};
}
test("Video ready email settings persist per account without impacting other accounts",()=>{
 const db=new DatabaseSync(":memory:");
 try{
  assert.equal(customerVideoReadyEmailPreference(db,account).enabled,true);
  updateCustomerVideoReadyEmailPreference(db,account,false);
  assert.equal(customerVideoReadyEmailPreference(db,account).enabled,false);
  assert.equal(customerVideoReadyEmailPreference(db,other).enabled,true);
  updateCustomerVideoReadyEmailPreference(db,account,true);
  assert.equal(customerVideoReadyEmailPreference(db,account).enabled,true);
 }finally{db.close()}
});
test("Completed paid credit Studio video sends only verified private link and respects durable opt-out",async()=>{
 const f=await fixture();
 try{
  const id="c3eedab6-1170-45f5-9b10-62f0c76af8be";
  const next="c3eedab6-1170-45f5-9b10-62f0c76af8bf";
  const another="c3eedab6-1170-45f5-9b10-62f0c76af8bc";
  updateCustomerVideoReadyEmailPreference(f.commerce,account,false);
  await f.completed(id,account,Date.now());
  let emails:Array<{to:string[];text:string}>=[];
  const sender=async (url:RequestInfo|URL,options?:RequestInit)=>{
   assert.equal(String(url),"https://api.resend.com/emails");
   const email=JSON.parse(String(options?.body)) as {to:string[];text:string};
   emails.push(email);
   return new Response('{"id":"email_test"}',{status:200});
  };
  let result=await retryStudioCreditVideoReadyNotifications(f.root,env,sender as typeof fetch);
  assert.deepEqual(result,{attempted:0,sent:0,suppressed:1});
  updateCustomerVideoReadyEmailPreference(f.commerce,account,true);
  result=await retryStudioCreditVideoReadyNotifications(f.root,env,sender as typeof fetch);
  assert.deepEqual(result,{attempted:0,sent:0,suppressed:0},"Re-enabling must never send old opted-out video emails");
  const later=Date.now()+10000;
  await f.completed(next,account,later);
  await f.completed(another,other,later);
  result=await retryStudioCreditVideoReadyNotifications(f.root,env,sender as typeof fetch);
  assert.equal(result.sent,2);
  assert.equal(emails.length,2);
  assert.ok(emails.some(m=>m.text.includes("/projects/live_"+next)));
  assert.ok(emails.every(m=>!m.text.includes("BytePlus")&&!m.text.includes("R2")&&!m.text.includes("secret")));
  result=await retryStudioCreditVideoReadyNotifications(f.root,env,sender as typeof fetch);
  assert.equal(result.sent,0,"Resend dispatch is idempotent per video");
 }finally{await f.close()}
});
test("Customer video ready email controls are exposed only to authenticated accounts",()=>{
 const api=readFileSync(new URL("../app/(site)/api/customer-email-preferences/route.ts",import.meta.url),"utf8");
 const settings=readFileSync(new URL("../app/(site)/account/settings/page.tsx",import.meta.url),"utf8");
 const gallery=readFileSync(new URL("../components/my-projects-gallery.tsx",import.meta.url),"utf8");
 assert.match(api,/store\.session\(req\.cookies\.get\("sm_customer"\)/);
 assert.match(api,/req\.headers\.get\("origin"\)!==origin/);
 assert.match(api,/typeof .*videoReadyEmailEnabled!=="boolean"/);
 assert.match(settings,/id="email-notifications"/);
 assert.match(settings,/videoEmailEnabled===true/);
 assert.match(gallery,/if\(item.kind==="customer"\)\{\s*const id=item\.id\.slice\(6\);\s*const response=await fetch\("\/api\/customer-orders"/);
});
