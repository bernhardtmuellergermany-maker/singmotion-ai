/** Isolated real HTTP + Chromium regression for self-service account deletion.
 * Never touches connected Stripe, BytePlus, R2 or production customer data.
 * Must run only against the fresh compiled Next.js build.
 */
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {createServer} from "node:net";
import {mkdtemp,mkdir,rm} from "node:fs/promises";
import {DatabaseSync} from "node:sqlite";
import {tmpdir} from "node:os";
import path from "node:path";
import {chromium} from "@playwright/test";

const root=await mkdtemp(path.join(tmpdir(),"singmotion-erasure-http-"));
const originalDataDir=process.env.DATA_DIR;process.env.DATA_DIR=root;
const {CommerceStore}=await import("../lib/commerce/store.ts");
const {runCustomerErasureJobs}=await import("../lib/commerce/customer-erasure-runner.ts");
const reserve=createServer();
await new Promise<void>(resolve=>reserve.listen(0,"127.0.0.1",resolve));
const address=reserve.address();
if(!address||typeof address==="string")throw Error("No local test port");
const port=address.port;await new Promise<void>(resolve=>reserve.close(()=>resolve()));
const origin="http://127.0.0.1:"+port;
await mkdir(path.join(root,"media"),{recursive:true});
await mkdir(path.join(root,"live-output"),{recursive:true});
const demo=new DatabaseSync(path.join(root,"demo.sqlite"));
demo.exec("CREATE TABLE sessions(token TEXT PRIMARY KEY,owner TEXT NOT NULL,expires INTEGER NOT NULL,admin INTEGER NOT NULL DEFAULT 0);CREATE TABLE assets(id TEXT PRIMARY KEY,owner TEXT NOT NULL,data TEXT NOT NULL)");
demo.close();
const server=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","-p",String(port)],{
 env:{...process.env,DATA_DIR:root,NODE_ENV:"production",APP_ORIGIN:origin,
  RAILWAY_ENVIRONMENT_ID:"",SINGMOTION_ISOLATED_ERASURE_TEST:"true",
  CUSTOMER_AUTOMATED_ERASURE_ENABLED:"true",
  CUSTOMER_ACCOUNTS_ENABLED:"true",CUSTOMER_BETA_WELCOME_CREDITS_ENABLED:"false",
  STAGING_AUTH_ENABLED:"false",CUSTOMER_R2_STORAGE_ENABLED:"false",
  DEMO_MODE:"true",GENERATIONS_ENABLED:"false",ADMIN_DEMO_ENABLED:"false",
  STRIPE_CREDIT_TOPUPS_TEST_ENABLED:"false",STRIPE_LIVE_ENABLED:"false"},
 stdio:["ignore","pipe","pipe"]
});
let logs="";server.stdout?.on("data",x=>logs+=x.toString());
server.stderr?.on("data",x=>logs+=x.toString());
let browser:Awaited<ReturnType<typeof chromium.launch>>|null=null;
let store:InstanceType<typeof CommerceStore>|null=null;
try{
 let ready=false;
 for(let i=0;i<110;i++){
  if(server.exitCode!==null)throw Error("Isolated Next server failed: "+logs.slice(-500));
  try{if((await fetch(origin+"/api/account")).status===200){ready=true;break}}catch{}
  await new Promise(resolve=>setTimeout(resolve,160));
 }
 assert.ok(ready,"Compiled Next server must boot over loopback: "+logs.slice(-900));
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?
  {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 const context=await browser.newContext();
 const email="erasure-browser-"+randomUUID()+"@example.test",password="unique secure browser deletion password";
 const response=await context.request.post(origin+"/api/account",{headers:{origin},
  data:{action:"register",email,password}});
 assert.equal(response.status(),200,"customer registration must work in isolated browser fixture");
 store=new CommerceStore(path.join(root,"commerce.sqlite"));
 const account=store.db.prepare("SELECT id FROM customer_accounts WHERE email=?").get(email) as {id:string};
 assert.ok(account?.id);
 const page=await context.newPage();
 // Account Settings intentionally animates #privacy anchor scrolling.
 // Disable motion for deterministic geometry sampling; the UI still retains
 // smooth scrolling for visitors who have not requested reduced motion.
 await page.emulateMedia({reducedMotion:"reduce"});
 await page.setViewportSize({width:1440,height:900});
 await page.goto(origin+"/account/settings#privacy");
 await page.getByRole("heading",{name:"Privacy & account deletion"}).waitFor({timeout:15000});
 // Restore the original single-column Account Settings section flow.
 // Only the deletion confirmation itself uses two columns on desktop.
 const ids=["profile","security","email-notifications","billing","invoices","privacy"];
 const boxes=await Promise.all(ids.map(async id=>page.locator("#"+id).boundingBox()));
 assert.ok(boxes.every(Boolean),"all six account settings sections must be visible");
 for(let i=1;i<boxes.length;i++){
  assert.ok(Math.abs(boxes[i]!.x-boxes[0]!.x)<3,
   ids[i]+" must align with the previous vertical sections");
  assert.ok(Math.abs(boxes[i]!.width-boxes[0]!.width)<3,
   ids[i]+" must retain full content width");
  assert.ok(boxes[i]!.y>=boxes[i-1]!.y+boxes[i-1]!.height-2,
   ids[i]+" must be BELOW "+ids[i-1]+", not a side-by-side dashboard");
 }
 await page.getByText("Delete account permanently",{exact:true}).click();
 const form=page.locator("#privacy .sm-settings-deletion-disclosure form");
 // Wait for the expanded form and its responsive CSS to settle before measuring.
 // Keep the original geometry requirements: a genuinely stacked desktop form fails.
 await page.waitForFunction(()=>{
  const form=document.querySelector("#privacy .sm-settings-deletion-disclosure form");
  const fields=form?.querySelectorAll("input:not([type=hidden])");
  if(!fields||fields.length<2)return false;
  const password=Array.from(fields).find(e=>e.getAttribute("type")==="password");
  const confirm=Array.from(fields).find(e=>e!==password);
  if(!password||!confirm)return false;
  const a=password.getBoundingClientRect(),b=confirm.getBoundingClientRect();
  return a.width>0&&b.width>0&&Math.abs(a.y-b.y)<9&&a.right<b.left;
 },{},{timeout:5000});
 const desktopForm=await form.boundingBox();
 const passwordField=await form.getByLabel("Account password").boundingBox();
 const confirmationField=await form.getByRole("textbox",{name:"Type DELETE MY ACCOUNT"}).boundingBox();
 assert.ok(desktopForm&&passwordField&&confirmationField);
 assert.ok(desktopForm.width>500,"only the deletion form needs a usable desktop width");
 assert.ok(Math.abs(passwordField.y-confirmationField.y)<9&&
   passwordField.x+passwordField.width<confirmationField.x,
   "password and final confirmation are side by side INSIDE deletion form");
 await page.setViewportSize({width:390,height:844});
 const mobileBoxes=await Promise.all(ids.map(id=>page.locator("#"+id).boundingBox()));
 assert.ok(mobileBoxes.every(Boolean));
 for(let i=1;i<mobileBoxes.length;i++)
  assert.ok(mobileBoxes[i]!.y>=mobileBoxes[i-1]!.y+mobileBoxes[i-1]!.height-2,
   ids[i]+" must remain a separate stacked section on phones");
 const mobilePassword=await form.getByLabel("Account password").boundingBox();
 const mobileConfirm=await form.getByRole("textbox",{name:"Type DELETE MY ACCOUNT"}).boundingBox();
 assert.ok(mobilePassword&&mobileConfirm&&
   mobileConfirm.y>=mobilePassword.y+mobilePassword.height-2,
   "deletion form should stack both fields on narrow screens");
 const overflow=await page.evaluate(()=>({
  content:document.documentElement.scrollWidth,viewport:window.innerWidth,
 }));
 assert.ok(overflow.content<=overflow.viewport+1,
  "mobile account settings must not scroll horizontally: "+JSON.stringify(overflow));
 console.log("PASS: six original Account Settings sections are vertically stacked; only deletion confirmation expands to two desktop fields and fits 390px mobile.");
 await page.getByRole("textbox",{name:"Type DELETE MY ACCOUNT"}).fill("DELETE MY ACCOUNT");
 await page.getByLabel("Account password").fill(password);
 page.on("dialog",dialog=>void dialog.accept());
 await page.getByRole("button",{name:"Permanently delete my account"}).click();
 await page.waitForURL(origin+"/account/deletion-status",{timeout:15000});
 const first=await context.request.get(origin+"/api/customer-erasure-status");
 assert.equal(first.status(),200,"erasure status is visible only with deletion cookie");
 assert.equal((await first.json()).state,"requested");
 // Isolated worker drives the same durable states as the real Railway worker.
 for(let i=0;i<5;i++)await runCustomerErasureJobs(root);
 const last=await context.request.get(origin+"/api/customer-erasure-status");
 assert.equal(last.status(),200);
 const result=await last.json() as {state:string;done:boolean};
 assert.equal(result.done,true);
 assert.equal(result.state,"completed");
 assert.equal(store.db.prepare("SELECT 1 FROM customer_accounts WHERE id=?").get(account.id),undefined);
 const withoutToken=await fetch(origin+"/api/customer-erasure-status");
 assert.equal(withoutToken.status,401,"anonymous visitor cannot read somebody else's erasure status");
 console.log("PASS: real HTTP Chromium password confirmation, account freeze, private cookie receipt, worker completion and login deletion.");
 // Regression for a customer who reopens the browser after 30 minutes:
 // the first GET is already expired; an independent Payload cookie must
 // remain intact without making the customer login look authenticated.
 const idleContext=await browser.newContext();
 try{
  const idleEmail="idle-browser-"+randomUUID()+"@example.test";
  const registered=await idleContext.request.post(origin+"/api/account",{
   headers:{origin},data:{action:"register",email:idleEmail,password}});
  assert.equal(registered.status(),200);
  const idleAccount=store.db.prepare("SELECT id FROM customer_accounts WHERE email=?")
   .get(idleEmail) as {id:string};
  assert.ok(idleAccount?.id);
  await idleContext.addCookies([{name:"payload-token",value:"obsolete-staff-cookie",
   url:origin}]);
  const startCookies=await idleContext.cookies(origin);
  assert.ok(startCookies.some(x=>x.name==="sm_customer"));
  assert.ok(startCookies.some(x=>x.name==="payload-token"));
  store.db.prepare("UPDATE customer_session_policies SET last_activity=? WHERE account_id=?")
   .run(Date.now()-31*60_000,idleAccount.id);
  const idlePage=await idleContext.newPage();
  await idlePage.goto(origin+"/login");
  await idlePage.getByText("You were signed out after inactivity. Please sign in again.")
   .waitFor({timeout:18000});
  await idlePage.getByRole("heading",{name:"Sign in"})
   .waitFor({timeout:10000});
  assert.equal(await idlePage.getByRole("button",{name:"Sign out"}).count(),0);
  assert.equal(await idlePage.getByText(idleEmail,{exact:true}).count(),0);
  const cookies=await idleContext.cookies(origin);
  for(const name of ["sm_customer","sm_session"])
   assert.equal(cookies.some(c=>c.name===name),false,
    name+" must be removed automatically after the customer timeout");
  assert.equal(cookies.some(c=>c.name==="payload-token"),true,
   "The independent CMS cookie must survive customer inactivity.");
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM customer_sessions WHERE account_id=?")
   .get(idleAccount.id)?.n,0);
  console.log("PASS: expired customer and media sessions clear, CMS cookie remains; customer form stays unauthenticated.");
 }finally{await idleContext.close()}

}finally{
 await browser?.close().catch(()=>{});
 store?.close();
 server.kill("SIGTERM");
 await new Promise<void>(resolve=>{
  if(server.exitCode!==null)return resolve();
  const timeout=setTimeout(resolve,2500);
  server.once("exit",()=>{clearTimeout(timeout);resolve()});
 });
 await rm(root,{recursive:true,force:true});
 if(originalDataDir===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=originalDataDir;
}
