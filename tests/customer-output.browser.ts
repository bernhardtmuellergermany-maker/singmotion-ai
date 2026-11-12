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
 // Regression for the shared private Output/Completed shell used by paid and
 // Super Admin live projects: the logo must be hit-testable on a mobile viewport
 // and navigating it must always reach the actual homepage.
 await page.setViewportSize({width:390,height:844});
 const homeLogo=page.getByRole("link",{name:"SingMotion AI home"});
 await homeLogo.waitFor({state:"visible",timeout:15000});
 const hitTest=await homeLogo.evaluate(element=>{
  const box=element.getBoundingClientRect();
  const top=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);
  return {target:top?.tagName??null,inside:Boolean(top&&(element===top||element.contains(top)))};
 });
 assert.ok(hitTest.inside,"Mobile Output logo must not be covered by any invisible layer: "+JSON.stringify(hitTest));
 await homeLogo.click({timeout:5000});
 await page.waitForURL(origin+"/",{timeout:10000});
 await page.getByRole("link",{name:"SingMotion AI home"}).waitFor({state:"visible",timeout:15000});
 console.log("BROWSER_CHECKPOINT: mobile private Output wordmark opens the homepage");

 // The My Projects library must list exactly the owner's paid order and
 // navigate to its existing private status, never initiate a new checkout.
 await page.goto(origin+"/projects");
 await page.getByRole("heading",{name:"My Projects"}).waitFor({timeout:15000});
 assert.equal(await page.getByRole("link",{name:/New video/}).count(),1);
 assert.equal(await page.getByRole("link",{name:/New video/}).getAttribute("href"),"/studio?new=1","New video must allocate a fresh draft instead of reusing the previous project");
 const libraryCard=page.getByRole("link",{name:/Open Music video .* Ready/});
 await libraryCard.waitFor({timeout:15000});
 assert.ok((await page.locator(".sm-projects-support").innerText()).includes(id.slice(0,8)));
 // One click must copy the full support reference, not the eight-character
 // preview displayed on the project card.
 await page.context().grantPermissions(["clipboard-read","clipboard-write"],{origin});
 await page.getByRole("button",{name:/Copy full support ID for/}).click();
 assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),id,
  "Support ID copy action places the complete order reference on the clipboard");
 await page.getByText("Copied!").waitFor({timeout:3000});
 await libraryCard.click();
 await page.waitForURL(origin+"/orders/"+id);
 await page.getByRole("region",{name:"Video generation status"}).getByRole("heading",{name:"Your video is ready"}).waitFor({timeout:15000});
 // Regression: opening the Studio never creates an empty draft. The first
 // successful audio upload creates it, and a second new=1 visit must not
 // overwrite the old project or persist another empty project.
 const guestContext=await browser.newContext();
 const guestPage=await guestContext.newPage();
 const guestSessionReady=guestPage.waitForResponse(response=>response.url().endsWith("/api/session") && response.request().method()==="POST" && response.status()===200,{timeout:15000});
 await guestPage.goto(origin+"/studio?new=1");
 await guestPage.getByRole("heading",{name:/Upload your audio/}).waitFor({timeout:15000});
 await guestSessionReady;
 const listGuestDrafts=async()=>{
   const r=await guestContext.request.get(origin+"/api/studio-drafts");
   assert.equal(r.status(),200);
   return await r.json() as Array<{id:string;selection:Record<string,unknown>;artistName:string;projectName?:string}>;
 };
 assert.equal((await listGuestDrafts()).length,0,
  "a new empty Studio session must not create a server draft");
 // Exercise the actual Studio upload widget through Chromium rather than
 // inserting a synthetic draft directly into the database.
 const guestAudioFile=path.join(root,"browser-first-upload.wav");
 await promisify(execFile)("ffmpeg",[
  "-nostdin","-v","error","-f","lavfi","-i",
  "sine=frequency=440:sample_rate=22050:duration=8",
  "-ac","1","-ar","22050","-c:a","pcm_s16le",guestAudioFile,
 ],{timeout:30000});
 const uploadGuestAudio=async()=>{
  await guestPage.getByLabel("Choose audio file").setInputFiles(guestAudioFile);
  await guestPage.getByText("browser-first-upload.wav").first().waitFor({timeout:15000});
 };
 await uploadGuestAudio();
 let firstDrafts=await listGuestDrafts();
 for(let i=0;firstDrafts.length<1&&i<60;i++){
   await new Promise(resolve=>setTimeout(resolve,250));
   firstDrafts=await listGuestDrafts();
 }
 assert.equal(firstDrafts.length,1,"first successful audio upload creates the guest draft");
 const old=firstDrafts[0];
 assert.ok(old.selection.songId,"first saved draft references uploaded audio");
 const note="Keep the saved guest performance";
 const saveOld=await guestContext.request.post(origin+"/api/studio-drafts",{
   headers:{origin},
   data:{id:old.id,selection:{...old.selection,customPrompt:note},
     artistName:"My artist",projectName:"Old Guest Project",step:2}
 });
 assert.equal(saveOld.status(),200,"guest can save its existing uploaded project");
 // The API must also reject a direct empty POST, even from a valid guest.
 const rejectEmpty=await guestContext.request.post(origin+"/api/studio-drafts",{
   headers:{origin},
   data:{id:randomUUID(),selection:{...old.selection,songId:"",imageId:"",customPrompt:"text only"},
     artistName:"No upload",projectName:"Must not persist",step:0}
 });
 assert.equal(rejectEmpty.status(),400,"direct empty draft must be rejected");
 await guestPage.goto(origin+"/projects");
 await guestPage.getByRole("heading",{name:"My Projects"}).waitFor({timeout:15000});
 await guestPage.getByRole("link",{name:/New video/}).click();
 await guestPage.waitForURL(origin+"/studio");
 await guestPage.getByRole("heading",{name:/Upload your audio/}).waitFor({timeout:15000});
 assert.equal((await listGuestDrafts()).length,1,
  "second new Studio visit must not create another empty guest draft");
 await uploadGuestAudio();
 let afterNew=await listGuestDrafts();
 for(let i=0;afterNew.length<2&&i<60;i++){
   await new Promise(resolve=>setTimeout(resolve,250));
   afterNew=await listGuestDrafts();
 }
 assert.equal(afterNew.length,2,"second successful upload creates an independent draft");
 assert.ok(afterNew.some(d=>d.id!==old.id&&Boolean(d.selection.songId)),
  "new uploaded draft has a distinct ID and saved audio");
 const preserved=afterNew.find(d=>d.id===old.id);
 assert.equal(preserved?.selection.customPrompt,note,"first guest project remains unchanged");
 await guestPage.goto(origin+"/projects");
 await guestPage.getByRole("link",{name:/Open Old Guest Project, Draft/}).click();
 await guestPage.waitForURL(origin+`/studio?draft=${encodeURIComponent(old.id)}`);
 await guestPage.locator("#flow-performance-prompt").waitFor({timeout:15000});
 assert.equal(await guestPage.locator("#flow-performance-prompt").inputValue(),note,
   "reopening the old project restores its performance instructions");
 assert.equal((await listGuestDrafts()).find(d=>d.id===old.id)?.selection.customPrompt,note);
 await guestContext.close();
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
