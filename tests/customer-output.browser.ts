/** Isolated real-HTTP/Chromium regression for the existing paid output card.
 * Run after npm run build: npm run test:customer:browser
 * No Stripe API, BytePlus API, production database or real payment is accessed. */
import assert from "node:assert/strict";
import {spawn,execFile} from "node:child_process";
import {promisify} from "node:util";
import {createHmac,randomUUID} from "node:crypto";
import {createServer} from "node:net";
import {mkdtemp,mkdir,readFile,rm,chmod} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {chromium} from "@playwright/test";

const root=await mkdtemp(path.join(tmpdir(),"singmotion-output-browser-"));
const oldDataDir=process.env.DATA_DIR;
process.env.DATA_DIR=root;
const {CommerceStore}=await import("../lib/commerce/store.ts");
const {putAsset,db}=await import("../lib/db.ts");
const {stripeCheckoutAdapter}=await import("../lib/commerce/stripe-webhook.ts");
const reserve=createServer();
await new Promise<void>(resolve=>reserve.listen(0,"127.0.0.1",resolve));
const address=reserve.address();
if(!address||typeof address==="string")throw Error("No isolated local test port");
const port=address.port;
await new Promise<void>(resolve=>reserve.close(()=>resolve()));
const origin=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","-p",String(port)],{
 env:{...process.env,DATA_DIR:root,NODE_ENV:"production",APP_ORIGIN:origin,
  CUSTOMER_ACCOUNTS_ENABLED:"true",CUSTOMER_ORDER_PREPARATION_ENABLED:"false",
  STAGING_AUTH_ENABLED:"false",DEMO_MODE:"true",GENERATIONS_ENABLED:"false",
  BYTEPLUS_LIVE_TEST_ENABLED:"false",BYTEPLUS_FIRST_TEST_ENABLED:"false",
  STRIPE_LIVE_ENABLED:"false"},
 stdio:["ignore","pipe","pipe"],
});
let serverLogs="";
child.stdout?.on("data",v=>serverLogs+=v.toString());
child.stderr?.on("data",v=>serverLogs+=v.toString());
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
let store:InstanceType<typeof CommerceStore>|undefined;
try{
 await mkdir(path.join(root,"media"),{recursive:true,mode:0o700});
 let ready=false;
 for(let i=0;i<100;i++){
  if(child.exitCode!==null)throw Error("Isolated Next server stopped: "+serverLogs.slice(-800));
  try{if((await fetch(origin+"/api/account")).status===200){ready=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,200));
 }
 assert.ok(ready,"Next must start on isolated loopback port");
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?
  {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 const context=await browser.newContext({acceptDownloads:true});
 const buyer=`buyer-${randomUUID()}@example.test`;
 const password="offline only securely generated test password 2026";
 const register=await context.request.post(origin+"/api/account",{
  headers:{origin},data:{action:"register",email:buyer,password},
 });
 assert.equal(register.status(),200,"real account registration over HTTP");
 store=new CommerceStore(path.join(root,"commerce.sqlite"));
 const account=(store.db.prepare("SELECT id FROM customer_accounts WHERE email=?").get(buyer) as {id:string}).id;
 const id=store.preparedVideoOrder({
  account,email:buyer,project:"browser-paid-output",key:"browser-"+randomUUID(),
  cents:125,quoteEvidence:"reviewed-offline-browser-price-2026",
  media:{sourceJobId:"offline-browser-prepared-source",promptLanguageConfirmed:true,
   owner:"customer-"+account,audioPath:"/private/audio.wav",imagePath:"/private/image.png",
   audioSha256:"a".repeat(64),imageSha256:"b".repeat(64),durationSeconds:5,
   prompt:"Sing naturally",outputFormat:"9:16"},
 }).id;
 store.bindStripeCheckout(id,"cs_test_browser_output");
 const event={id:"evt_browser_output",type:"checkout.session.completed",livemode:false,
  data:{object:{object:"checkout.session",id:"cs_test_browser_output",mode:"payment",
   payment_status:"paid",currency:"eur",amount_total:125,metadata:{orderId:id}}}};
 const raw=Buffer.from(JSON.stringify(event)),time=String(Math.floor(Date.now()/1000));
 const sig="t="+time+",v1="+createHmac("sha256","whsec_browser_offline_only")
  .update(time+".").update(raw).digest("hex");
 await store.webhook(raw,sig,stripeCheckoutAdapter("whsec_browser_offline_only"));
 assert.equal(store.claimPaidFulfillment(id),true);
 assert.equal(store.beginPaidProviderSubmission(id),true);
 store.recordPaidProviderJob(id,"byteplus","offline_browser_job");
 const file=path.join(root,"media",`paid-${id}.mp4`);
 await promisify(execFile)("ffmpeg",["-nostdin","-v","error","-f","lavfi","-i",
  "color=c=black:s=160x284:r=25:d=1","-an","-c:v","libx264","-pix_fmt","yuv420p",
  "-movflags","+faststart",file],{timeout:30000});
 await chmod(file,0o600);
 const bytes=await readFile(file);
 const assetId="customer-video-"+id;
 putAsset({id:assetId,owner:"customer-"+account,kind:"video",name:"singmotion.mp4",
  path:file,mime:"video/mp4",bytes:bytes.length,duration:1,width:null,height:null,created:Date.now()});
 store.recordPaidVideoDelivery(id,assetId,"verified offline browser fixture delivery 2026");
 assert.equal(store.finalizePaidFulfillment(id,{state:"delivered",
  deliveryEvidence:"validated offline browser result 2026"}),true);
 const page=await context.newPage();
 await page.goto(origin+"/orders/"+id);
 console.log("BROWSER_CHECKPOINT: page loaded");
 const output=page.getByRole("region",{name:"Video generation status"});
 console.log("BROWSER_CHECKPOINT: waiting for paid completed card");
 await output.getByRole("heading",{name:"Your video is ready"}).waitFor({timeout:15000});
 console.log("BROWSER_CHECKPOINT: paid completed card visible");
 assert.equal(await output.locator("video[controls]").count(),1);
 const download=output.getByRole("link",{name:/Download video/});
 assert.equal(await download.getAttribute("href"),`/api/customer-video?orderId=${id}&download=1`);
 const partial=await context.request.get(origin+`/api/customer-video?orderId=${id}`,{
  headers:{range:"bytes=0-31"},
 });
 assert.equal(partial.status(),206);
 assert.equal(partial.headers()["content-range"],`bytes 0-31/${bytes.length}`);
 assert.deepEqual(await partial.body(),bytes.subarray(0,32));
 console.log("BROWSER_CHECKPOINT: range protected and ready for download");
 const pendingDownload=page.waitForEvent("download");
 await download.click();
 const downloaded=await pendingDownload;
 assert.equal(downloaded.suggestedFilename(),"singmotion.mp4");
 // Regression: a delivered order must be reached from its project card,
 // not sent back to an editable draft or an order review.
 await page.goto(origin+"/?card=paid_"+id);
 const finishedCard=page.locator(".sm-carousel-card").filter({has:page.locator('a[href="/projects/paid_'+id+'"]')});
 await finishedCard.waitFor({timeout:15000});
 assert.equal(await finishedCard.locator("video[src^='/api/customer-video?orderId=']").count(),1,
  "home carousel shows the authenticated finished video");
 await finishedCard.getByRole("link",{name:/Open project/}).click();
 await page.waitForURL(origin+"/projects/paid_"+id);
 await page.getByRole("region",{name:"Video generation status"}).locator("video[controls]").waitFor({timeout:15000});
 console.log("BROWSER_CHECKPOINT: completed project card opens private video, not order review");
 const stranger=await browser.newContext();
 assert.equal((await stranger.request.get(origin+`/api/customer-video?orderId=${id}`)).status(),401);
 assert.equal((await stranger.request.get(origin+`/api/customer-orders?view=mine&orderId=${id}`)).status(),401);
 await stranger.close();
 store.reconcileVerifiedStripeDispute({orderId:id,stripeCheckoutId:"cs_test_browser_output",
  disputeId:"dp_browser_offline",evidence:"verified offline browser dispute notification"});
 console.log("BROWSER_CHECKPOINT: download complete; validating dispute revocation");
 await page.reload();
 await output.getByRole("heading",{name:"Your video is under review"}).waitFor({timeout:15000});
 assert.equal(await output.locator("video").count(),0);
 assert.equal(await output.getByRole("link",{name:/Download video/}).count(),0);
 assert.equal((await context.request.get(origin+`/api/customer-video?orderId=${id}`)).status(),404);
 await context.close();
 console.log("PASS: real HTTP + Chromium signup, signed sandbox receipt, redesigned output card, MP4 preview/range/download, cross-user denial and post-dispute revocation.");
}catch(error){
 console.error("BROWSER_CHECK_FAILED",error instanceof Error ? `${error.name}: ${error.message}` : String(error));
 throw error;
}finally{
 await browser?.close();
 store?.close();
 db.close();
 child.kill("SIGTERM");
 if(oldDataDir===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=oldDataDir;
 await rm(root,{recursive:true,force:true});
}
