/** Isolated browser regression: all external requests intercepted, no real GA hits. */
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createServer} from "node:net";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {chromium,expect} from "@playwright/test";
import {CONSENT_KEY,serializeConsent} from "../lib/analytics/consent.ts";
const root=await mkdtemp(path.join(tmpdir(),"sm-analytics-browser-"));
const reserve=createServer();
await new Promise<void>(resolve=>reserve.listen(0,"127.0.0.1",resolve));
const address=reserve.address();
if(!address||typeof address==="string")throw Error("Missing loopback port");
const port=address.port;
await new Promise<void>(resolve=>reserve.close(()=>resolve()));
const origin="http://127.0.0.1:"+port;
const id="G-TEST1234",key=CONSENT_KEY+":"+id;
// Explicit synthetic environment: never inherit deployed Railway, Stripe or AI credentials.
const server=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","-p",String(port)],{
 env:{PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:"production",DATA_DIR:root,APP_ORIGIN:origin,
  STAGING_AUTH_ENABLED:"false",DEMO_MODE:"true",GENERATIONS_ENABLED:"false",ADMIN_DEMO_ENABLED:"false",
  CUSTOMER_ACCOUNTS_ENABLED:"true",CUSTOMER_R2_STORAGE_ENABLED:"false",STRIPE_LIVE_ENABLED:"false",
  RAILWAY_ENVIRONMENT_NAME:"staging",GA4_ENABLED:"true",GA4_MEASUREMENT_ID:id},
 stdio:["ignore","pipe","pipe"]
});
let logs=""; server.stdout?.on("data",x=>logs+=x.toString());server.stderr?.on("data",x=>logs+=x.toString());
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
try {
 let ready=false;
 for(let i=0;i<120;i++){
  if(server.exitCode!==null)throw Error("Isolated Next exited: "+logs.slice(-1000));
  try{if((await fetch(origin+"/")).ok){ready=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 assert.ok(ready,"Isolated Next did not boot: "+logs.slice(-1000));
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  const context=await browser.newContext({viewport,serviceWorkers:"block"});
  const requests:string[]=[];
  try{
   await context.route("**/*",async route=>{
    const url=new URL(route.request().url());
    if(url.origin===origin)return route.continue();
    if(url.hostname==="www.googletagmanager.com"||url.hostname.endsWith(".google-analytics.com")||url.hostname==="google-analytics.com"){
     requests.push(url.href);
     if(url.hostname==="www.googletagmanager.com"&&url.pathname==="/gtag/js"){
      return route.fulfill({contentType:"application/javascript",body:"window.__smMockGoogleTagLoaded = true;"});
     }
    }
    return route.abort();
   });
   const page=await context.newPage();
   await page.goto(origin+"/");
   await expect(page.getByRole("heading",{name:"Privacy preferences"})).toBeVisible();
   const reject=page.getByRole("button",{name:"Reject optional",exact:true});
   const accept=page.getByRole("button",{name:"Accept analytics",exact:true});
   await expect(reject).toBeVisible();await expect(accept).toBeVisible();
   assert.equal(requests.length,0,"no tag before consent");
   await reject.click();
   await expect(page.getByRole("button",{name:"Privacy settings"})).toBeVisible();
   await page.reload();
   await expect(page.getByRole("button",{name:"Privacy settings"})).toBeVisible();
   assert.equal(requests.length,0,"no tag after rejection and reload");
   await page.getByRole("button",{name:"Privacy settings"}).click();
   await accept.click();
   await expect.poll(()=>requests.length).toBe(1);
   await page.waitForFunction(()=>Boolean((window as unknown as Record<string,unknown>).__smMockGoogleTagLoaded));
   const queue=await page.evaluate(()=>((window as unknown as {dataLayer:unknown[]}).dataLayer||[]).map(entry=>Array.from(entry as ArrayLike<unknown>)));
   const events=queue.filter(entry=>entry[0]==="event"&&entry[1]==="page_view");
   assert.equal(events.length,1);
   assert.deepEqual(queue[0],["consent","default",{analytics_storage:"denied",ad_storage:"denied",ad_user_data:"denied",ad_personalization:"denied"}]);
   assert.deepEqual(queue[1],["consent","update",{analytics_storage:"granted",ad_storage:"denied",ad_user_data:"denied",ad_personalization:"denied"}]);
   assert.equal((events[0][2] as {page_location:string}).page_location,origin+"/");
   // Query-bearing homepage and private page must never load Google, even with a previous grant.
   const privatePage=await context.newPage();
   await privatePage.goto(origin+"/?card=projects");
   await expect(privatePage.getByRole("button",{name:"Privacy settings"})).toBeVisible();
   assert.equal(requests.length,1);
   await privatePage.goto(origin+"/privacy");
   await expect(privatePage.getByRole("button",{name:"Privacy settings"})).toBeVisible();
   assert.equal(requests.length,1);
   // Revocation in another tab disables and unloads the existing tag.
   await privatePage.evaluate(({key,value})=>localStorage.setItem(key,value),{key,value:serializeConsent("denied")});
   await expect.poll(()=>page.evaluate(id=>Boolean((window as unknown as Record<string,unknown>)["ga-disable-"+id]),id)).toBe(true);
   await expect.poll(()=>page.evaluate(()=>Boolean((window as unknown as Record<string,unknown>).__smMockGoogleTagLoaded))).toBe(false);
   assert.equal(requests.length,1,"revocation must not load another tag");
   await page.reload();
   await expect(page.getByRole("button",{name:"Privacy settings"})).toBeVisible();
   assert.equal(requests.length,1);
   console.log("PASS: isolated analytics consent browser test "+viewport.width+"px; no real Google requests");
  }finally{await context.close();}
 }
}finally{
 await browser?.close();server.kill("SIGTERM");
 await new Promise<void>(resolve=>{if(server.exitCode!==null)resolve();else server.once("exit",()=>resolve());});
 await rm(root,{recursive:true,force:true});
}
