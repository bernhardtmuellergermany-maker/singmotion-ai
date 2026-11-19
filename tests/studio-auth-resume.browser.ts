/**
 * Real isolated Chrome + Next regression for Step 4 -> normal login ->
 * same verified original draft, for both sign-in and account creation.
 * No real Stripe, BytePlus or R2 calls and never accesses a deployed database.
 */
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createServer} from "node:net";
import {randomUUID} from "node:crypto";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {chromium} from "@playwright/test";

const root=await mkdtemp(path.join(tmpdir(),"sm-studio-standard-login-"));
const oldData=process.env.DATA_DIR,oldDemo=process.env.DEMO_MODE;
process.env.DATA_DIR=root;process.env.DEMO_MODE="true";
const {db}=await import("../lib/db.ts");
const {CommerceStore}=await import("../lib/commerce/store.ts");
const reserve=createServer();
await new Promise<void>(resolve=>reserve.listen(0,"127.0.0.1",resolve));
const address=reserve.address();
if(!address||typeof address==="string")throw Error("No isolated loopback port");
const port=address.port;
await new Promise<void>(resolve=>reserve.close(()=>resolve()));
const origin="http://127.0.0.1:"+port;
const live=new DatabaseSync(path.join(root,"live-test.sqlite"));
live.exec(`CREATE TABLE live_studio_projects(
 attempt_id TEXT PRIMARY KEY,owner TEXT NOT NULL,selection_json TEXT NOT NULL);
 CREATE TABLE live_attempts(id TEXT PRIMARY KEY,data TEXT NOT NULL);
 CREATE TABLE live_private_exceptions(id TEXT PRIMARY KEY,owner TEXT NOT NULL);`);
live.close();
const server=spawn(process.execPath,["node_modules/next/dist/bin/next","start",
 "--hostname","127.0.0.1","-p",String(port)],{
 env:{...process.env,DATA_DIR:root,NODE_ENV:"production",APP_ORIGIN:origin,
  RAILWAY_ENVIRONMENT_ID:"",SINGMOTION_ISOLATED_ERASURE_TEST:"true",
  CUSTOMER_ACCOUNTS_ENABLED:"true",STAGING_AUTH_ENABLED:"false",
  DEMO_MODE:"true",GENERATIONS_ENABLED:"false",ADMIN_DEMO_ENABLED:"false",
  STRIPE_LIVE_ENABLED:"false",STRIPE_CHECKOUT_ENABLED:"false",
  CUSTOMER_R2_STORAGE_ENABLED:"false",BYTEPLUS_LIVE_TEST_ENABLED:"false",
  CUSTOMER_BETA_WELCOME_CREDITS_ENABLED:"false"},
 stdio:["ignore","pipe","pipe"]
});
let logs="";server.stdout?.on("data",s=>logs+=s.toString());
server.stderr?.on("data",s=>logs+=s.toString());
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
let commerce:InstanceType<typeof CommerceStore>|undefined;
try{
 let ready=false;
 for(let i=0;i<110;i++){
  if(server.exitCode!==null)throw Error("Isolated Next server failed: "+logs.slice(-600));
  try{if((await fetch(origin+"/api/session")).status!==502){ready=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,170));
 }
 assert.ok(ready,"Isolated Next server did not boot: "+logs.slice(-700));
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?
  {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 commerce=new CommerceStore(path.join(root,"commerce.sqlite"),
  {CUSTOMER_BETA_WELCOME_CREDITS_ENABLED:"false"});

 for(const registration of [false,true]){
  const context=await browser.newContext({viewport:{width:390,height:844}});
  try{
   const session=await context.request.post(origin+"/api/session",{headers:{origin},data:{}});
   assert.equal(session.status(),200,"a normal guest workspace must exist");
   const guest=await session.json() as {owner:string};
   assert.match(guest.owner,/^[a-f0-9-]{36}$/);
   const guestSessionCookie=(await context.cookies(origin)).find(x=>x.name==="sm_session");
   assert.ok(guestSessionCookie,"guest ownership is protected by an HttpOnly cookie");
   const id=randomUUID(),audioId=randomUUID(),imageId=randomUUID();
   await mkdir(path.join(root,"media"),{recursive:true});
   const audioFile=path.join(root,"media",audioId),imageFile=path.join(root,"media",imageId);
   await writeFile(audioFile,Buffer.from("ID3 offline browser audio fixture"));
   await writeFile(imageFile,Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLxAAAAAElFTkSuQmCC","base64"));
   const created=Date.now();
   const audio={id:audioId,owner:guest.owner,kind:"audio",name:"original-song.mp3",
    path:audioFile,mime:"audio/mpeg",bytes:33,duration:12,width:null,height:null,created};
   const image={id:imageId,owner:guest.owner,kind:"image",name:"artist-photo.png",
    path:imageFile,mime:"image/png",bytes:68,duration:null,width:720,height:1280,created};
   db.prepare("INSERT INTO assets VALUES(?,?,?)").run(audioId,guest.owner,JSON.stringify(audio));
   db.prepare("INSERT INTO assets VALUES(?,?,?)").run(imageId,guest.owner,JSON.stringify(image));
   const prompt="Bright stage, singer looking into the camera, slow orbit to the left";
   const selection={version:1,owner:guest.owner,songId:audioId,imageId,
    start:1.5,end:6.5,performance:"Custom",camera:"Orbit left",customPrompt:prompt,
    outputFormat:"9:16",formatMode:"9:16"};
   const name="Saved song and photo – "+(registration?"registration":"login");
   const posted=await context.request.post(origin+"/api/studio-drafts",{
    headers:{origin},data:{id,selection,artistName:"Test artist",projectName:name,step:3}
   });
   assert.equal(posted.status(),200,"original complete guest Step 4 must be saved: "+await posted.text());
   const page=await context.newPage();
   await page.goto(origin+"/studio?draft="+encodeURIComponent(id)+"&resume=review");
   await page.getByRole("heading",{name:"Ready to generate?"}).waitFor({timeout:15000});
   await page.getByText(prompt,{exact:true}).first().waitFor({timeout:15000});
   await page.getByText("I confirm that I own or have permission").first().click();
   await page.getByRole("button",{name:"Login to generate"}).click();
   await page.waitForURL(/\/login\?returnTo=/,{timeout:15000});
   await page.getByRole("heading",{name:"Sign in"}).waitFor({timeout:15000});
   assert.equal(await page.getByRole("heading",{name:"Create your free account"}).count(),0,
    "guest must see the standard Sign in screen, not the old registration modal");
   assert.equal(await page.locator("dialog[open]").count(),0);
   const email="studio-return-"+randomUUID()+"@example.test";
   const password="safe-test-account-password-123";
   if(registration){
    await page.getByRole("button",{name:"Create account"}).click();
    await page.getByRole("heading",{name:"Create your account"}).waitFor();
    await page.getByLabel("Confirm password").fill(password);
   }else commerce.register(email,password);
   await page.getByLabel("Email",{exact:true}).fill(email);
   await page.getByLabel("Password",{exact:true}).fill(password);
   await page.getByRole("button",{name:registration?"Create account":"Sign in",exact:true}).last().click();
   await page.waitForURL(new RegExp("/studio\\\\?draft="+id+"&resume=review"),{timeout:20000}).catch(async error=>{
    // Only nonsecret diagnostics: never log passwords, cookies or tokens.
    const location=new URL(page.url());
    const messages=await page.locator('[role="alert"],[role="status"]').allTextContents().catch(()=>[]);
    const headings=await page.locator("h1,h2").allTextContents().catch(()=>[]);
    const auth=await context.request.get(origin+"/api/customer-auth",{failOnStatusCode:false}).catch(()=>null);
    const authBody=auth?await auth.json().catch(()=>null) as {authenticated?:boolean;kind?:string;error?:string}:null;
    console.error("STUDIO_LOGIN_RESUME_DIAGNOSTIC",{
     pathname:location.pathname,queryKeys:Array.from(location.searchParams.keys()),
     headings:headings.slice(0,5),messages:messages.slice(0,6).map(x=>x.slice(0,250)),
     customerAuthStatus:auth?.status(),customerAuthenticated:authBody?.authenticated,kind:authBody?.kind,
     authError:authBody?.error,
    });
    throw error;
   });
   await page.getByRole("heading",{name:"Ready to generate?"}).waitFor({timeout:15000});
   await page.getByText(prompt,{exact:true}).first().waitFor({timeout:15000});
   assert.ok(await page.getByText("original-song.mp3",{exact:true}).count());
   assert.ok(await page.locator(".sm-review-photo-value img").count());
   const user=commerce.db.prepare("SELECT id FROM customer_accounts WHERE email=?").get(email) as {id:string}|undefined;
   assert.ok(user);
   const customerOwner="customer-"+user.id;
   const restored=db.prepare("SELECT owner,selection,step,project_name FROM studio_drafts WHERE id=?").get(id) as
    {owner:string;selection:string;step:number;project_name:string}|undefined;
   assert.ok(restored);
   assert.equal(restored.owner,customerOwner);
   assert.equal(restored.step,3);
   assert.equal(restored.project_name,name);
   assert.deepEqual(JSON.parse(restored.selection),{...selection,owner:customerOwner});
   for(const assetId of [audioId,imageId])
    assert.equal(db.prepare("SELECT owner FROM assets WHERE id=?").get(assetId)?.owner,customerOwner);
   assert.equal(commerce.db.prepare("SELECT COUNT(*) AS n FROM customer_orders WHERE account_id=?").get(user.id)?.n,0,
    "sign-in does not create an order");
   const cookies=await context.cookies(origin);
   assert.ok(cookies.some(x=>x.name==="sm_customer"),"customer has a verified login");
   console.log("PASS: "+(registration?"standard account creation":"standard sign in")+
    " returns original audio, image, crop, 5-second selection and prompt to Step 4 without a purchase.");
  }finally{await context.close()}
 }
}finally{
 await browser?.close().catch(()=>{});
 commerce?.close();
 server.kill("SIGTERM");
 await new Promise<void>(resolve=>{
  if(server.exitCode!==null)return resolve();
  const timer=setTimeout(resolve,2500);
  server.once("exit",()=>{clearTimeout(timer);resolve()});
 });
 try{db.close()}catch{}
 await rm(root,{recursive:true,force:true});
 if(oldData===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=oldData;
 if(oldDemo===undefined)delete process.env.DEMO_MODE;else process.env.DEMO_MODE=oldDemo;
}
