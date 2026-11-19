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
 await page.goto(origin+"/account/settings#privacy");
 await page.getByRole("heading",{name:"Privacy & account deletion"}).waitFor({timeout:15000});
 await page.getByText("Delete account permanently",{exact:true}).click();
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
