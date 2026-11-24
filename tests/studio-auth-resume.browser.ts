/**
 * Real isolated Chrome + Next regression for Step 4 -> normal login ->
 * same verified original draft, for both sign-in and account creation.
 * No real Stripe, BytePlus or R2 calls and never accesses a deployed database.
 */
import assert from "node:assert/strict";
import {spawn,execFileSync} from "node:child_process";
import {createServer} from "node:net";
import {randomUUID} from "node:crypto";
import {mkdtemp,mkdir,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {chromium,type Page} from "@playwright/test";
import {cameraMovements,featuredCameraMovements,additionalCameraMovements,cameraMovementPreview} from "../lib/studio-camera-movements.ts";

/** Use the actual built Studio, not a mocked picker; preserve the test's draft. */
async function verifyCameraPicker(page:Page,original:string){
 const panel=page.locator(".sm-performance-ideas").filter({has:page.getByRole("heading",{name:"Camera Movements",exact:true})});
 const prompt=page.locator("#flow-performance-prompt");
 const preview=panel.locator("#sm-camera-active-preview");
 const recommended=panel.locator(".sm-camera-chip-recommended");
 const experimental=panel.locator(".sm-camera-chip-experimental");
 assert.equal(await recommended.count(),9);
 assert.equal(await panel.locator(".sm-camera-chip-recommended:visible").count(),9);
 assert.equal(await experimental.count(),25);
 assert.equal(await panel.locator(".sm-camera-chip-experimental:visible").count(),0);
 assert.equal(await preview.count(),0);
 const initialUrl=page.url();
 let ownText=original;
 const expected=(move:typeof cameraMovements[number])=>ownText+"\n"+move.direction;
 const select=async(move:typeof cameraMovements[number])=>{
  const chip=panel.getByRole("button",{name:"Add "+move.name+" camera movement to prompt",exact:true});
  const group=panel.getByRole("group",{name:move.recommended?"Add camera movement to prompt":"Experimental camera movements",exact:true});
  const positions=()=>group.evaluate(el=>{
   // Use layout offsets, not transformed client rectangles: hovering a chip
   // intentionally translates it by one pixel, without reflowing any rows.
   const buttons=Array.from(el.querySelectorAll<HTMLButtonElement>(".sm-camera-chip-recommended,.sm-camera-chip-experimental"));
   const origin=buttons[0];
   return buttons.map(button=>[button.offsetLeft-origin.offsetLeft,button.offsetTop-origin.offsetTop,button.offsetWidth,button.offsetHeight]);
  });
  const before=await positions();
  await chip.click();
  await preview.waitFor({state:"visible"});
  assert.equal(await prompt.evaluate(el=>document.activeElement===el),false,"quick tip must never focus the prompt");
  assert.ok(await group.evaluate(el=>!!el.lastElementChild?.querySelector("#sm-camera-active-preview")),"preview follows every chip in its own group");
  const after=await positions();
  assert.equal(after.length,before.length);
  assert.ok(after.every((rect,index)=>rect.every((value,axis)=>Math.abs(value-before[index][axis])<=1)),"quick links retain their layout positions within one pixel when the preview changes");
  assert.ok(await group.evaluate(el=>{
   const slot=el.lastElementChild!.getBoundingClientRect();
   return Array.from(el.querySelectorAll(".sm-camera-chip-recommended,.sm-camera-chip-experimental")).every(button=>button.getBoundingClientRect().bottom<=slot.top);
  }),"preview is below every quick link");
  assert.equal(await preview.count(),1);
  assert.equal(await preview.locator("strong").innerText(),move.name);
  assert.equal(await preview.locator(".sm-camera-chip-rating").innerText(),move.recommended?"Recommended":"Experimental");
  assert.equal(await prompt.inputValue(),expected(move));
  const img=preview.locator("img");
  assert.equal(await img.getAttribute("src"),cameraMovementPreview(move).animation);
  await img.scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>{const el=document.querySelector<HTMLImageElement>("#sm-camera-active-preview img");return el?.complete&&el.naturalWidth===640&&el.naturalHeight===360});
  const bounds=await preview.boundingBox();
  const viewport=page.viewportSize();
  assert.ok(bounds&&viewport&&bounds.x>=-1&&bounds.x+bounds.width<=viewport.width+1,"preview fits the viewport");
  assert.equal(page.url(),initialUrl,"no page navigation");
 };
 const dolly=featuredCameraMovements.find(m=>m.name==="Dolly in")!;
 assert.equal(await prompt.evaluate(el=>document.activeElement===el),false,"prompt starts unfocused");
 await select(dolly);
 await prompt.click();
 assert.equal(await prompt.evaluate(el=>document.activeElement===el),true,"manual tap can still focus the prompt");
 ownText="  Sing naturally.\n\nCamera: My own framing instruction.  ";
 await prompt.fill(ownText+"\n"+dolly.direction);
 await select(dolly);
 await preview.getByRole("button",{name:"Pause Dolly in preview"}).click();
 assert.equal(await preview.locator("img").getAttribute("src"),cameraMovementPreview(dolly).poster);
 await preview.getByRole("button",{name:"Play Dolly in preview"}).click();
 await page.emulateMedia({reducedMotion:"reduce"});
 await page.waitForFunction(()=>document.querySelector<HTMLImageElement>("#sm-camera-active-preview img")?.currentSrc.endsWith("-poster.webp"));
 await page.emulateMedia({reducedMotion:"no-preference"});
 await select(featuredCameraMovements.find(m=>m.name==="Pan right")!);
 assert.equal(await preview.getByText("Dolly in",{exact:true}).count(),0);
 await panel.getByRole("button",{name:"Show more (25 experimental)",exact:true}).click();
 assert.equal(await panel.locator(".sm-camera-chip-experimental:visible").count(),25);
 await select(additionalCameraMovements.find(m=>m.name==="Truck right")!);
 await select(additionalCameraMovements.find(m=>m.name==="Truck left")!);
 await preview.getByRole("button",{name:"Close camera movement preview"}).click();
 assert.equal(await preview.count(),0);
 await select(additionalCameraMovements.find(m=>m.name==="Truck left")!);
 await panel.getByRole("button",{name:"Show less",exact:true}).click();
 assert.equal(await preview.count(),0);
 assert.equal(await panel.locator(".sm-camera-chip-experimental:visible").count(),0);
 await prompt.fill(original);
 assert.equal(await prompt.inputValue(),original);
 console.log("PASS: Studio camera chips keep previews below all chips in each group, preserve chip positions and manual text, and never focus the prompt at "+page.viewportSize()?.width+"px.");
}
async function verifyCameraHelp(page:Page,origin:string){
 const help=await page.context().newPage();
 try{
  await help.emulateMedia({reducedMotion:"reduce"});
  await help.goto(origin+"/help/camera-movements");
  const cards=help.locator("#camera-movements article.sm-camera-technique");
  assert.equal(await cards.count(),34);
  assert.equal(await help.locator("#camera-movements .sm-camera-recommended").count(),9);
  assert.equal(await help.locator("#camera-movements .sm-camera-experimental").count(),25);
  for(const [index,move] of cameraMovements.entries()){
   const card=cards.nth(index);
   assert.equal(await card.locator("h3").innerText(),move.name);
   assert.equal(await card.locator("blockquote").innerText(),move.example);
   const {animation,poster}=cameraMovementPreview(move);
   assert.equal(await card.locator("img").getAttribute("src"),animation);
   assert.equal(await card.locator("source").getAttribute("srcset"),poster);
   for(const asset of [animation,poster]){
    const response=await help.request.get(origin+asset);
    assert.equal(response.status(),200,asset);
    assert.match(response.headers()["content-type"],/^image\/webp/);
    await response.dispose();
   }
  }
  await cards.first().locator("img").scrollIntoViewIfNeeded();
  await help.waitForFunction(()=>{const el=document.querySelector<HTMLImageElement>("#camera-movements article img");return el?.complete&&el.naturalWidth===640&&el.currentSrc.endsWith("-poster.webp")});
  console.log("PASS: all 34 Help cards, original English prompts, 68 local WebP responses and reduced-motion poster in Chromium.");
 }finally{await help.close()}
}


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
   // Two fast first-party Next.js redirects can abort the intermediate
   // navigation request after the final Step 4 is already visible. Observe
   // only the browser's final address, then verify the actual saved content.
   const returnDeadline=Date.now()+20000;
   let arrivedAtReview=false;
   while(Date.now()<returnDeadline){
    const location=new URL(page.url());
    if(location.pathname==="/studio"&&location.searchParams.get("draft")===id&&
       location.searchParams.get("resume")==="review"&&location.searchParams.size===2){
     arrivedAtReview=true;
     break;
    }
    await new Promise<void>(resolve=>setTimeout(resolve,100));
   }
   assert.ok(arrivedAtReview,"Login must return to the exact saved Step 4");
   await page.getByRole("heading",{name:"Ready to generate?"}).waitFor({timeout:15000});
   await page.getByText(prompt,{exact:true}).first().waitFor({timeout:15000});
   assert.ok(await page.getByText("original-song.mp3",{exact:true}).count());
   assert.ok(await page.locator(".sm-review-photo-value img").count());
   // Real Chromium navigation at phone and desktop widths: four neon circles,
   // restored audio/photo/prompt, and no billing side effects.
   for(const viewport of [{width:390,height:844},{width:1280,height:900}]){
    await page.setViewportSize(viewport);
    await page.getByRole("button",{name:"Go to step 3 of 4: Performance"}).click();
    await page.getByRole("heading",{name:"Your performance"}).waitFor({timeout:10000});
    assert.equal(await page.locator("#flow-performance-prompt").inputValue(),prompt);
    if(!registration){
     await verifyCameraPicker(page,prompt);
     if(viewport.width===390)await verifyCameraHelp(page,origin);
    }
    await page.getByRole("button",{name:"Go to step 2 of 4: Photo"}).click();
    await page.getByRole("heading",{name:"Your artist photo"}).waitFor({timeout:10000});
    await page.getByRole("button",{name:"Go to step 1 of 4: Audio"}).click();
    await page.getByText("Step 1 of 4 · Audio",{exact:true}).waitFor({timeout:10000});
    await page.getByRole("button",{name:"Go to step 4 of 4: Generate"}).click();
    await page.getByRole("heading",{name:"Ready to generate?"}).waitFor({timeout:10000});
    await page.getByText(prompt,{exact:true}).first().waitFor({timeout:10000});
   }
   // Make sure we did not merely pass through Step 4 before a wallet redirect.
   const finalLocation=new URL(page.url());
   assert.equal(finalLocation.pathname,"/studio");
   assert.equal(finalLocation.searchParams.get("draft"),id);
   assert.equal(finalLocation.searchParams.get("resume"),"review");
   assert.equal(finalLocation.searchParams.size,2);
   const user=commerce.db.prepare("SELECT id FROM customer_accounts WHERE email=?").get(email) as {id:string}|undefined;
   assert.ok(user);
   const customerOwner="customer-"+user.id;
   // Navigation commits Studio drafts asynchronously. Verify the persisted
   // Step 4 after the write settles; still fail if it never becomes durable.
   const savedStepDeadline=Date.now()+10000;
   let restored:{owner:string;selection:string;step:number;project_name:string}|undefined;
   do{
    restored=db.prepare("SELECT owner,selection,step,project_name FROM studio_drafts WHERE id=?").get(id) as typeof restored;
    if(restored?.step===3)break;
    await new Promise<void>(resolve=>setTimeout(resolve,100));
   }while(Date.now()<savedStepDeadline);
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
   // A standalone purchase must ignore an old Step 4 handoff.
   await page.route("**/api/credit-balance",async route=>{
    if(route.request().method()!=="GET"){await route.continue();return;}
    const actual=await route.fetch();
    const data=await actual.json();
    await route.fulfill({response:actual,json:{...data,availableCredits:10000}});
   });
   await page.evaluate(draftId=>sessionStorage.setItem("sm-credit-checkout-resume",JSON.stringify({draftId,requiredCredits:500,created:Date.now()})),id);
   await page.goto(origin+"/credits?checkout=success");
   await page.getByRole("region",{name:"Current credit balance"}).waitFor({timeout:15000});
   await page.waitForTimeout(1700);
   assert.equal(new URL(page.url()).pathname,"/credits","standalone purchase must remain in Credits");
   assert.equal(await page.getByRole("link",{name:"Continue project · Step 4"}).count(),0);
   await page.unroute("**/api/credit-balance");
   await page.goto(origin+"/studio?new=1&suno_connected=1");
   await page.getByText("Step 1 of 4 · Audio",{exact:true}).waitFor({timeout:15000});
   assert.equal(await page.getByRole("heading",{name:"Ready to generate?"}).count(),0);
   assert.equal(new URL(page.url()).searchParams.get("new"),"1");
   console.log("PASS: standalone Credits return ignores stale Step 4; Suno OAuth return starts at audio.");
   // Reproduce the real signed-in failure: existing Step 4, Videos -> New
   // video, then two new Suno imports. Suno OAuth/MCP is mocked, but MP3
   // upload, account-owned storage and navigation run through real Next.js.
   const mockMp3Path=path.join(root,"suno-browser-"+randomUUID()+".mp3");
   execFileSync("ffmpeg",["-nostdin","-v","error","-f","lavfi","-i",
     "sine=frequency=620:duration=9","-c:a","libmp3lame",mockMp3Path]);
   const mockMp3=await readFile(mockMp3Path);
   let sunoImportCount=0;
   await page.route("**/api/suno-import",async route=>{
     if(route.request().method()==="GET"){
       await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({connected:true})});
       return;
     }
     if(route.request().method()==="POST"){
       sunoImportCount++;
       await route.fulfill({status:200,
         headers:{"content-type":"audio/mpeg",
                  "x-suno-audio-filename":"new-suno-"+sunoImportCount+".mp3"},
         body:mockMp3});
       return;
     }
     await route.abort();
   });
   await page.goto(origin+"/videos");
   await page.getByRole("link",{name:"New video"}).click();
   await page.getByText("Step 1 of 4 · Audio",{exact:true}).waitFor({timeout:15000});
   assert.equal(await page.getByRole("heading",{name:"Ready to generate?"}).count(),0,
     "New video cannot resume the last Step 4");
   const createdIds:string[]=[];
   for(let i=1;i<=2;i++){
     // The second import explicitly replaces the audio from the first, while
     // preserving the first independent saved draft on the server.
     if(i===2){
       await page.getByRole("button",{name:"Delete audio"}).click();
       await page.locator("#suno-import").waitFor({timeout:10000});
     }
     const panel=page.locator("#suno-import");
     if(!(await panel.evaluate(el=>(el as HTMLDetailsElement).open)))
       await panel.locator("summary").click();
     await page.getByRole("textbox",{name:"Suno song link"}).fill(
       i===1?"https://suno.com/s/9NgKJGqKoraKou62":
       "https://suno.com/song/abcdef01-2345-6789-abcd-001122334455"
     );
     await page.getByRole("button",{name:"Import song directly"}).click();
     try {
       await page.locator(".sm-new-file-info strong",{
         hasText:"new-suno-"+i+".mp3"
       }).waitFor({timeout:30000});
     } catch (cause) {
       // Synthetic test-only diagnostics; no credentials or actual Suno URLs.
       console.error("SUNO_BROWSER_IMPORT_FAILURE",{
         attempt:i,pathname:new URL(page.url()).pathname,
         notice:(await page.locator("#suno-import [role='status']").allTextContents()).slice(0,5),
         feedback:(await page.locator("main").innerText()).slice(0,800)
       });
       throw cause;
     }
     await page.getByText("Step 1 of 4 · Audio",{exact:true}).waitFor();
     await page.waitForURL(url=>url.pathname==="/studio"&&
       !!url.searchParams.get("draft")&&url.searchParams.get("draft")!==id&&
       !createdIds.includes(url.searchParams.get("draft")||""),{timeout:20000});
     const newId=new URL(page.url()).searchParams.get("draft")!;
     assert.ok(newId&&newId!==id&&!createdIds.includes(newId),
       "every explicit Suno import must create a new project ID");
     createdIds.push(newId);
     const savedNew=db.prepare(
       "SELECT owner,selection,step FROM studio_drafts WHERE id=?"
     ).get(newId) as {owner:string;selection:string;step:number}|undefined;
     assert.ok(savedNew,"newly uploaded Suno song must be saved under its own ID");
     assert.equal(savedNew.owner,customerOwner);
     assert.equal(savedNew.step,0);
     const fresh=JSON.parse(savedNew.selection);
     assert.equal(fresh.songId!==audioId,true,"new song must not be previous recording");
     assert.equal(fresh.imageId,"","new Suno project must not inherit artist photo");
     assert.equal(fresh.customPrompt,"","new Suno project must not inherit old prompt");
     assert.equal(fresh.performance,"Natural");
     assert.equal(fresh.camera,"Static camera");
     assert.equal(fresh.start,0);
     const original=db.prepare("SELECT owner,selection,step FROM studio_drafts WHERE id=?"
     ).get(id) as {owner:string;selection:string;step:number}|undefined;
     assert.ok(original,"original Step 4 must remain available");
     assert.equal(original.step,3);
     assert.deepEqual(JSON.parse(original.selection),{...selection,owner:customerOwner});
     await page.reload();
     await page.locator(".sm-new-file-info strong",{
       hasText:"new-suno-"+i+".mp3"
     }).waitFor({timeout:15000});
     assert.equal(await page.getByRole("heading",{name:"Ready to generate?"}).count(),0,
       "a reload must not reopen the old Step 4");
   }
   assert.equal(sunoImportCount,2);
   const firstNew=db.prepare("SELECT selection FROM studio_drafts WHERE id=?"
   ).get(createdIds[0]) as {selection:string}|undefined;
   assert.ok(firstNew,"first imported draft stays saved after second import");
   assert.ok(JSON.parse(firstNew.selection).songId,
     "first imported song persists independently of the second");
   console.log("PASS: signed-in New video + two mocked Suno MP3 imports create separate blank Step 1 drafts, preserve previous Step 4 and survive reload.");
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
