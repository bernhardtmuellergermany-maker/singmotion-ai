/** Actual React Projects editor against an isolated authenticated-media fixture.
 * No deployed account, paid provider, or R2 credentials are used. */
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {createRequire} from "node:module";
import {execFileSync} from "node:child_process";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {chromium} from "@playwright/test";
const require=createRequire(import.meta.url);
// Use the existing tsx bundler dependency, including when npm nests it.
const {build}=createRequire(require.resolve("tsx/package.json"))("esbuild");
const root=mkdtempSync(path.join(tmpdir(),"projects-replay-"));
const mp4=path.join(root,"clip.mp4");
execFileSync("ffmpeg",["-nostdin","-v","error","-f","lavfi","-i","color=red:size=320x180:rate=30","-t","4","-vf","drawbox=color=green:t=fill:enable='between(t,1,1.999)',drawbox=color=blue:t=fill:enable='gte(t,2)'","-an","-c:v","libx264","-threads","1","-pix_fmt","yuv420p","-profile:v","baseline","-g","15","-movflags","+faststart",mp4]);
const video=readFileSync(mp4);
const song=execFileSync("ffmpeg",["-nostdin","-v","error","-f","lavfi","-i","sine=frequency=440:sample_rate=44100","-t","4","-c:a","libmp3lame","-f","mp3","pipe:1"],{maxBuffer:1024*1024});
const bundled=await build({stdin:{contents:'import React from "react";import {createRoot} from "react-dom/client";import {MusicVideoEditor} from "./components/music-video-editor";import {AddToMusicProject} from "./components/add-to-music-project";createRoot(document.getElementById("root")!).render(location.pathname==="/add-test"?<AddToMusicProject sourceId="fixture" sourceKind="live" enabled/>:<MusicVideoEditor id={location.pathname==="/lock-test"?"lock-project":"fixture-project"}/>);',resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'},loader:{".css":"empty"},plugins:[{name:"isolated-link",setup(b:any){b.onResolve({filter:/^next\/link$/},()=>({path:"link",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:'import React from "react";export default function Link(p){return React.createElement("a",p)}',loader:"js",resolveDir:process.cwd()}));}}]});
const script=bundled.outputFiles[0].contents;
const css=readFileSync("components/music-video.css");
const project={id:"fixture-project",ownerId:"staff:fixture",name:"Replay",songName:"Test song",songDurationMs:4000,songStartMs:0,songEndMs:4000,songPositionMs:0,songParts:null,trackMutes:{1:true,2:true,song:false},revision:0,createdAt:1,updatedAt:1,aspectRatio:"16:9"};
const assets=["first","second"].map(id=>({id,projectId:project.id,name:id,kind:"imported",role:id==="first"?"lip-sync":"b-roll",sourceKind:"uploaded",sourceId:"mp4",durationMs:4000,sourceStartMs:null,sourceEndMs:null,createdAt:1}));
const clips=[{id:"c1",assetId:"first",track:1,timelineStartMs:0,sourceInMs:250,sourceOutMs:1750,syncLocked:false},{id:"c2",assetId:"second",track:2,timelineStartMs:2000,sourceInMs:500,sourceOutMs:2000,syncLocked:false}];
let lockProject={...project,id:"lock-project"};
const lockAssets=assets.map(a=>({...a,projectId:"lock-project",sourceStartMs:a.id==="first"?500:null,sourceEndMs:a.id==="first"?3500:null}));
const initialLockClips=()=>clips.map(c=>({...c,positionLocked:false,showVideoName:false}));
let lockClips=initialLockClips();
let timelineRequests=0,assetRequests=0,secondPreparations=0,secondDownloads=0;
const server=createServer((req,res)=>{
 const url=new URL(req.url||"/","http://localhost"),p=url.pathname;
 const send=(data:Buffer|Uint8Array|string,type:string)=>{res.writeHead(200,{"content-type":type});res.end(data);};
 const json=(data:unknown)=>send(JSON.stringify(data),"application/json");
 const media=(bytes:Buffer,type:string)=>{
  let start=0,end=bytes.length-1,status=200;
  const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||"");
  if(range){start=Number(range[1]);end=range[2]?Math.min(end,Number(range[2])):end;status=206;}
  if(start>end){res.writeHead(416,{"content-range":"bytes */"+bytes.length});res.end();return;}
  res.writeHead(status,{"content-type":type,"content-length":end-start+1,"accept-ranges":"bytes",...(status===206?{"content-range":"bytes "+start+"-"+end+"/"+bytes.length}:{})});res.end(bytes.subarray(start,end+1));
 };
 if(p==="/"||p==="/add-test"||p==="/lock-test")return send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/editor.css"></head><body><div id="root"></div><script src="/editor.js"></script></body></html>',"text/html");
 if(p==="/editor.js")return send(script,"application/javascript");
 if(p==="/editor.css")return send(css,"text/css");
 if(p==="/api/music-video/fixture-project")return json({project,assets,clips});
 if(p==="/api/music-video/lock-project")return json({project:lockProject,assets:lockAssets,clips:lockClips});
 if(p==="/api/music-video/lock-project/clips"&&req.method==="PATCH"){
  let raw="";req.on("data",chunk=>raw+=chunk);req.on("end",()=>{lockClips=JSON.parse(raw).clips;lockProject={...lockProject,revision:lockProject.revision+1};json({project:lockProject,assets:lockAssets,clips:lockClips});});return;
 }
 if(p==="/api/music-video")return json({projects:[{id:"fixture-project",name:"My music video"}]});
 if(p==="/api/music-video/fixture-project/assets"&&req.method==="POST")return json({asset:{id:"fixture-added"}});
 if(p==="/api/session")return json({owner:"cms-staff-fixture"});
 if(p==="/api/music-video/fixture-project/lip-sync")return json({videos:Array.from({length:16},(_,i)=>({id:"lip-"+i,name:i===0?"Long video "+("UnbrokenName".repeat(25)):"Completed video "+i,durationMs:2000,sourceStartMs:0,sourceEndMs:2000}))});
 if(p.includes("/waveform"))return json({durationMs:4000,hasAudio:true,peaks:Array.from({length:200},(_,i)=>i<50?.2:i<100?.8:.1)});
 if(p.includes("/format/"))return json({width:320,height:180});
 if(p.includes("/timeline-preview")){timelineRequests++;res.writeHead(404);res.end();return;}
 if(p.endsWith("/song"))return media(song,"audio/mpeg");
 if(p.includes("/assets/")){assetRequests++;res.writeHead(403);res.end();return;}
 if(p.includes("/preview/")&&req.method==="POST"){
  if(p.endsWith("/second")){secondPreparations++;setTimeout(()=>json({ready:true,unsupported:false}),1250);return;}
  return json({ready:true,unsupported:false});
 }
 if(p.includes("/preview/")){if(p.endsWith("/second")&&!req.headers.range)secondDownloads++;return media(video,"video/mp4");}
 res.writeHead(404);res.end();
});
await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
const address=server.address();if(!address||typeof address==="string")throw Error("Missing fixture port");
const origin="http://127.0.0.1:"+address.port;
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined,args:["--autoplay-policy=no-user-gesture-required"]});
try{
 for(const mobile of [false,true]){
  const page=await browser.newPage(mobile?{isMobile:true,hasTouch:true,viewport:{width:390,height:844}}:{viewport:{width:1280,height:900}});
  await page.addInitScript(()=>{
   const state={starts:[] as {when:number;now:number;offset:number;duration:number}[],frames:[] as number[],sampleTimes:[] as number[],watchBuffer:false,bufferingFrames:0};
   Object.assign(window,{__frameEngineTest:state});
   const native=AudioBufferSourceNode.prototype.start;
   AudioBufferSourceNode.prototype.start=function(when=0,offset=0,duration?:number){state.starts.push({when,now:this.context.currentTime,offset,duration:duration??0});return duration===undefined?native.call(this,when,offset):native.call(this,when,offset,duration);};
   const observe=()=>{const canvas=document.querySelector<HTMLCanvasElement>('[data-frame-preview="true"]');if(canvas?.dataset.frame!==undefined){state.frames.push(Number(canvas.dataset.frame));if(canvas.dataset.sourceTime)state.sampleTimes.push(Number(canvas.dataset.sourceTime));}if(state.watchBuffer&&Array.from(document.querySelectorAll(".mv-player-controls [role=status]")).some(e=>e.textContent?.includes("Buffering")))state.bufferingFrames++;requestAnimationFrame(observe);};requestAnimationFrame(observe);
  });
  const prepareBefore=secondPreparations,downloadBefore=secondDownloads;
  await page.goto(origin);
  const play=page.getByRole("button",{name:"Play",exact:true}),pause=page.getByRole("button",{name:"Pause",exact:true}),seek=page.getByRole("slider",{name:"Seek timeline"}),canvas=page.locator("canvas[data-frame-preview=true]");
  await play.waitFor({timeout:10000});
  assert.equal(await page.locator("video,audio").count(),0);
  assert.equal(await page.getByRole("button",{name:"Synced review",exact:true}).count(),0);
  await page.waitForFunction(()=>document.querySelectorAll(".mv-clip .mv-clip-waveform[data-waveform=ready] .mv-wave-shape").length===2&&!!document.querySelector(".mv-song-block .mv-wave-shape"),{},{timeout:10000});
  assert.equal(await page.locator(".mv-lane.is-audio-muted .mv-wave-shape").count(),2);
  for(const shape of await page.locator(".mv-clip .mv-wave-shape,.mv-song-block .mv-wave-shape").all()){
   const style=await shape.evaluate(el=>{const s=getComputedStyle(el);return {fill:s.fill,stroke:s.stroke,cap:s.strokeLinecap};});
   assert.deepEqual(style,{fill:"none",stroke:"rgb(255, 255, 255)",cap:"round"});
  }
  const videoWave=await page.locator(".mv-clip .mv-waveform-bars").first().evaluate(el=>{
   const w=el.getBoundingClientRect(),c=el.parentElement!.getBoundingClientRect();return {ratio:w.width/c.width,offset:Math.abs(w.x+w.width/2-c.x-c.width/2)};
  });
  assert.ok(videoWave.ratio<.8&&videoWave.offset<1,"video waveform is compact and centered");
  const songWave=await page.locator(".mv-song-block .mv-waveform-bars").first().evaluate(el=>el.getBoundingClientRect().width/el.parentElement!.getBoundingClientRect().width);
  assert.ok(songWave>.95,"song waveform retains time-axis width");
  assert.equal(await page.locator(".mv-song-wave-title").textContent(),"Test song");
  const library=page.locator(".mv-library-heading");await library.click();
  const search=page.getByRole("searchbox",{name:"Search media"});await search.waitFor();
  const checkSearch=async()=>{const style=await search.evaluate(el=>({input:getComputedStyle(el).backgroundColor,wrapper:getComputedStyle(el.parentElement!).backgroundColor,shadow:getComputedStyle(el).boxShadow}));assert.deepEqual(style,{input:"rgba(0, 0, 0, 0)",wrapper:"rgb(19, 29, 43)",shadow:"none"});};
  await checkSearch();await search.focus();await checkSearch();await search.fill("first");assert.equal(await page.locator(".mv-media-card").count(),1);await search.fill("");await library.click();
  await page.waitForFunction(()=>{const c=document.querySelector<HTMLCanvasElement>('[data-frame-preview=true]');return c?.dataset.frame==="0"&&Math.abs(Number(c.dataset.sourceTime)-.25)<.04;},{},{timeout:15000});
  const pixel=()=>canvas.evaluate(c=>Array.from((c as HTMLCanvasElement).getContext("2d")!.getImageData(400,240,1,1).data));
  assert.ok((await pixel())[0]>200,"initial source frame is red");
  await page.waitForFunction(()=>document.querySelector<HTMLCanvasElement>('[data-frame-preview=true]')?.dataset.frame==="0");
  assert.ok(secondPreparations>prepareBefore,"the next clip begins preparing while the first frame is visible");
  const jump=async(ms:number)=>{await seek.evaluate((el,value)=>{const input=el as HTMLInputElement;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,String(value));input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));},ms);};
  // Rapid seeks while paused: last target wins, including the source trim.
  await seek.press("End");await seek.press("Home");await jump(900);
  await page.waitForFunction(()=>{const c=document.querySelector<HTMLCanvasElement>('[data-frame-preview=true]');return c?.dataset.frame==="27"&&Math.abs(Number(c.dataset.sourceTime)-1.15)<.04;},{},{timeout:15000});
  const green=await pixel();assert.ok(green[1]>100&&green[0]<50,"scrubbed frame is green");
  assert.equal(await play.count(),1);
  // Keep the pointer held throughout the forward and backward moves. Verify
  // the canvas changes at each location, not just after pointerup.
  const heldRuler=await page.locator(".mv-ruler").boundingBox();assert.ok(heldRuler);
  const y=heldRuler.y+heldRuler.height/2;
  await page.mouse.move(heldRuler.x+15,y);await page.mouse.down();
  const heldFrame=async()=>{
   await page.waitForFunction(()=>{
    const slider=document.querySelector<HTMLInputElement>('.mv-progress'),canvas=document.querySelector<HTMLCanvasElement>('[data-frame-preview=true]');
    return slider&&canvas?.dataset.frame===String(Math.min(119,Math.floor(Number(slider.value)*30/1000)));
   },{},{timeout:3000});
   return Number(await canvas.getAttribute("data-frame"));
  };
  const a=await heldFrame();
  await page.mouse.move(heldRuler.x+36,y,{steps:5});const b=await heldFrame();
  await page.mouse.move(heldRuler.x+23,y,{steps:5});const d=await heldFrame();
  assert.ok(a<b&&d<b&&d>a,"live preview follows both directions before pointer release");
  await page.mouse.up();
  assert.equal(await play.count(),1);
  // The intentionally slow next proxy is prepared while editing the first clip.
  await page.waitForTimeout(1500);
  assert.ok(secondDownloads>downloadBefore,"small upcoming clip downloaded as a complete local proxy");
  await seek.press("Home");await page.waitForFunction(()=>document.querySelector<HTMLCanvasElement>('[data-frame-preview=true]')?.dataset.frame==="0");
  await page.evaluate(()=>{const s=(window as any).__frameEngineTest;s.frames=[];s.sampleTimes=[];s.starts=[];});
  await play.click();
  await page.waitForFunction(()=>{const c=document.querySelector<HTMLCanvasElement>('[data-frame-preview=true]');return Number(c?.dataset.frame)>=18;},{},{timeout:15000});
  assert.equal(await pause.count(),1);
  const playback=await page.evaluate(()=>((window as any).__frameEngineTest) as {frames:number[];sampleTimes:number[];starts:{when:number;now:number;duration:number}[]});
  assert.ok(playback.starts.length>5,"actual Web Audio buffers scheduled");
  assert.ok(playback.starts.every(s=>s.when>=s.now-.005&&s.duration>0),"audio buffers scheduled on one future clock");
  assert.ok(playback.frames.every((n,i,a)=>i===0||n>=a[i-1]),"no backward frame replay");
  assert.ok(playback.sampleTimes.every((n,i,a)=>i===0||n>=a[i-1]),"no backward decoded timestamp at startup");
  await page.evaluate(()=>{const s=(window as any).__frameEngineTest;s.watchBuffer=true;s.bufferingFrames=0;});
  const cutStarted=Date.now();
  await page.waitForFunction(()=>Number(document.querySelector<HTMLCanvasElement>('[data-frame-preview=true]')?.dataset.frame)>=75,{},{timeout:4000});
  assert.ok(Date.now()-cutStarted<2700,"preloaded next clip crosses the gap/cut without a long buffer stall");
  const bufferFrames=await page.evaluate(()=>{const s=(window as any).__frameEngineTest;s.watchBuffer=false;return s.bufferingFrames;});
  assert.ok(bufferFrames<=6,"next-clip buffering must not interrupt playback visibly: "+bufferFrames+" animation frames");
  assert.equal(await pause.count(),1);
  await seek.press("Home");
  await page.waitForFunction(()=>{const f=Number(document.querySelector<HTMLCanvasElement>('[data-frame-preview=true]')?.dataset.frame);return f>=4&&f<=15;},{},{timeout:15000});
  assert.equal(await pause.count(),1);
  const ruler=await page.locator(".mv-ruler").boundingBox();assert.ok(ruler);
  await page.mouse.move(ruler.x+40,ruler.y+ruler.height/2);await page.mouse.down();
  const forward=await heldFrame();assert.equal(await pause.count(),1);
  await page.mouse.move(ruler.x+8,ruler.y+ruler.height/2,{steps:4});const backward=await heldFrame();assert.ok(backward<forward);assert.equal(await pause.count(),1);await page.mouse.up();
  await page.waitForFunction(()=>{const f=Number(document.querySelector<HTMLCanvasElement>('[data-frame-preview=true]')?.dataset.frame);return f>=4&&f<=20;},{},{timeout:15000});
  assert.equal(await pause.count(),1);
  await pause.click();await jump(1700);
  await page.waitForFunction(()=>document.querySelector<HTMLCanvasElement>('[data-frame-preview=true]')?.dataset.frame==="51");
  assert.deepEqual((await pixel()).slice(0,3),[0,0,0]);
  await jump(2450);
  await page.waitForFunction(()=>{const c=document.querySelector<HTMLCanvasElement>('[data-frame-preview=true]');return c?.dataset.frame==="73"&&Math.abs(Number(c.dataset.sourceTime)-.9333)<.04;});
  await page.waitForTimeout(250);assert.equal(await canvas.getAttribute("data-frame"),"73");assert.equal(await play.count(),1);
  await seek.press("End");await play.click();await pause.waitFor({timeout:10000});
  await page.waitForFunction(()=>{const f=Number(document.querySelector<HTMLCanvasElement>('[data-frame-preview=true]')?.dataset.frame);return f>=4&&f<=20;},{},{timeout:15000});
  assert.equal(timelineRequests,0);assert.equal(assetRequests,0);
  console.log("PASS: upcoming proxy prefetched and frames follow held pointer forward/backward before release on "+(mobile?"mobile":"desktop")+" Chromium");
  console.log("PASS: single WebCodecs/Web Audio editor paints exact source frames, gap and trim; playback is monotonic, scrub preserves intent, no server timeline render on "+(mobile?"mobile":"desktop")+" Chromium");
  await pause.click();
  const timeline=page.locator(".mv-scroll"),zoomLevel=page.getByLabel("Timeline zoom level");
  assert.ok((await page.locator(".mv-ruler .mv-tick-major").allTextContents()).includes("00:02"),"default ruler shows two-second steps");
  assert.ok(await page.locator(".mv-ruler .mv-tick-minor").count()>0);
  if(mobile){
   // Real Chromium touch input: pinch on the song, not on the playhead.
   const client=await page.context().newCDPSession(page);
   const songBlock=page.locator(".mv-song-block").first();await songBlock.scrollIntoViewIfNeeded();
   const rect=await timeline.boundingBox(),songRect=await songBlock.boundingBox();assert.ok(rect&&songRect);
   const cx=rect.x+Math.min(100,rect.width/2),cy=songRect.y+songRect.height/2;
   const touch=(type:"touchStart"|"touchMove"|"touchEnd",distance=0)=>client.send("Input.dispatchTouchEvent",{type,touchPoints:type==="touchEnd"?[]:[{x:cx-distance/2,y:cy,id:1},{x:cx+distance/2,y:cy,id:2}]});
   const original=Number((await zoomLevel.textContent())!.replace("×",""));
   const atBefore=await page.locator(".mv-progress").inputValue();
   await touch("touchStart",50);await touch("touchMove",110);await touch("touchMove",170);await touch("touchEnd");
   await page.waitForFunction(()=>Number(document.querySelector("output[aria-label='Timeline zoom level']")?.textContent?.replace("×",""))>2);
   const zoomed=Number((await zoomLevel.textContent())!.replace("×",""));
   assert.ok(zoomed>original*2);
   assert.equal(await page.locator(".mv-progress").inputValue(),atBefore,"pinch must not move playhead");
   const anchor=await timeline.evaluate(el=>el.scrollLeft);assert.ok(anchor>0,"pinch keeps midpoint time in view");
   await touch("touchStart",160);await touch("touchMove",80);await touch("touchEnd");
   await page.waitForFunction(z=>Number(document.querySelector("output[aria-label='Timeline zoom level']")?.textContent?.replace("×",""))<z,zoomed);
   assert.equal(await page.locator(".mv-progress").inputValue(),atBefore);
   await client.detach();
   console.log("PASS: two-finger timeline zoom in/out keeps playhead unchanged on mobile Chromium");
  }
  for(let i=0;i<12;i++){const plus=page.getByRole("button",{name:"Zoom in timeline"});if(await plus.isDisabled())break;await plus.click();}
  await page.waitForFunction(()=>Array.from(document.querySelectorAll(".mv-tick-major")).some(el=>el.textContent?.includes(".")));
  assert.ok(await page.locator(".mv-ruler .mv-tick-major").count()<20,"only viewport labels rendered");
  // Use a fast swipe on a blank track with the pointer released; actual
  // scrollLeft must continue to change, while the clip times stay untouched.
  await timeline.evaluate(el=>{el.scrollLeft=400;});
  const lane=page.locator(".mv-main-lane");await lane.scrollIntoViewIfNeeded();
  const viewport=await timeline.boundingBox(),laneBox=await lane.boundingBox();assert.ok(viewport&&laneBox);
  const sy=laneBox.y+laneBox.height/2,sx=viewport.x+viewport.width*.75;
  const before=await timeline.evaluate(el=>el.scrollLeft);
  if(mobile){
   const client=await page.context().newCDPSession(page);
   await client.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:sx,y:sy,id:3}]});
   await client.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:sx-35,y:sy,id:3}]});
   await client.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:sx-75,y:sy,id:3}]});
   const held=await timeline.evaluate(el=>el.scrollLeft);
   assert.ok(held>before+30,"swipe pans while held");
   await client.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
   await page.waitForFunction(x=>document.querySelector(".mv-scroll")!.scrollLeft>x+8,held,{timeout:2000});
   await client.detach();
   console.log("PASS: timeline swipe continues with bounded inertia after touch release on mobile Chromium");
  }
  assert.equal(await page.locator(".mv-clip").count(),2);
  // Reproduce a transformed editor ancestor and long names, then verify the
  // body-portal dialog stays inside the actual mobile viewport at 390/320px.
  if(!(await page.getByRole("button",{name:"Insert Lip Sync",exact:true}).isVisible()))await page.locator(".mv-library-heading").click();
  for(const width of mobile?[390,320]:[1280]){
   if(mobile)await page.setViewportSize({width,height:600});
   await page.evaluate(()=>{document.getElementById("root")!.style.transform="translateZ(0)";});
   await page.getByRole("button",{name:"Insert Lip Sync",exact:true}).click();
   const dialog=page.getByRole("dialog",{name:"Insert Lip Sync"});
   await dialog.getByRole("button",{name:/Long video/}).waitFor();
   assert.equal(await dialog.evaluate(el=>el.parentElement?.parentElement===document.body),true);
   assert.equal(await page.evaluate(()=>document.activeElement?.tagName),"DIV","opening must not summon the mobile keyboard");
   const bounds=await dialog.evaluate(el=>{const r=el.getBoundingClientRect(),v=window.visualViewport;return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:v?.width??innerWidth,height:v?.height??innerHeight,x:v?.offsetLeft??0,y:v?.offsetTop??0,overflow:el.scrollWidth>el.clientWidth+1};});
   assert.ok(bounds.left>=bounds.x-1&&bounds.right<=bounds.x+bounds.width+1&&bounds.top>=bounds.y-1&&bounds.bottom<=bounds.y+bounds.height+1&&!bounds.overflow,JSON.stringify(bounds));
   const search=dialog.getByRole("searchbox",{name:"Search Lip Sync videos"});await search.fill("Completed video 15");
   assert.equal(await dialog.locator(".mv-lip-list>button").count(),1);
   await dialog.getByRole("button",{name:"Close",exact:true}).click();await dialog.waitFor({state:"hidden"});
   console.log("PASS: Lip Sync dialog fits "+width+"px viewport with long names and a transformed editor; search and close work");
  }
  await page.close();
 }
 // Verify direct clip controls, durable settings, exact source time and empty selection.
 for(const width of [390,1280]){
  lockClips=initialLockClips();lockProject={...project,id:"lock-project"};
  const page=await browser.newPage({viewport:{width,height:844},isMobile:width<500,hasTouch:width<500});
  await page.goto(origin+"/lock-test");
  const second=page.getByLabel("Select video second",{exact:true}),first=page.getByLabel("Select video first",{exact:true});
  await second.waitFor();assert.equal(await page.locator(".mv-clip.is-selected,.mv-song-block.is-selected").count(),0);
  const select=async(clip:typeof second)=>{await clip.focus();await clip.press("Enter");};
  const save=()=>page.waitForResponse(r=>r.url().endsWith("/lock-project/clips")&&r.request().method()==="PATCH");
  await select(second);
  const appearance=await second.evaluate(el=>{
   const eye=el.querySelector(".mv-clip-display-toggle")!,lock=el.querySelector(".mv-clip-position-lock")!;
   const a=getComputedStyle(eye),b=getComputedStyle(lock);
   return {clip:getComputedStyle(el).backgroundColor,eye:a.backgroundColor,lock:b.backgroundColor,eyeBorder:a.borderTopWidth,lockBorder:b.borderTopWidth};
  });
  assert.deepEqual(appearance,{clip:"rgb(97, 51, 126)",eye:"rgba(0, 0, 0, 0)",lock:"rgba(0, 0, 0, 0)",eyeBorder:"0px",lockBorder:"0px"});
  const selectedStyle=await second.evaluate(el=>{const s=getComputedStyle(el);return {outline:s.outlineStyle,border:s.borderTopWidth,shadow:s.boxShadow};});
  assert.deepEqual(selectedStyle,{outline:"none",border:"1px",shadow:"none"});
  const locked=save();await second.getByRole("button",{name:"Lock clip position: second"}).click();await locked;
  assert.equal(lockClips[1].positionLocked,true);assert.equal(await page.getByRole("button",{name:"Switch track",exact:true}).isDisabled(),true);
  const named=save();await second.getByRole("button",{name:"Show video name: second"}).click();await named;
  assert.equal(lockClips[1].showVideoName,true);assert.equal(await second.locator(".mv-clip-title").textContent(),"second");
  assert.equal(await second.locator(".mv-clip-waveform").count(),0);
  await page.reload();await second.waitFor();await select(second);
  assert.equal(await second.getByRole("button",{name:"Unlock clip position: second"}).count(),1);
  assert.equal(await second.locator(".mv-clip-title").textContent(),"second");
  const unlocked=save();await second.getByRole("button",{name:"Unlock clip position: second"}).click();await unlocked;
  assert.equal(lockClips[1].positionLocked,false);
  const wave=save();await second.getByRole("button",{name:"Show waveform: second"}).click();await wave;
  assert.equal(lockClips[1].showVideoName,false);assert.equal(await second.locator(".mv-clip-title").count(),0);
  // Actual pointer gestures, not only inspector/button state. Drag the
  // lower middle of the unlocked clip, away from both corner controls.
  await select(second);await second.scrollIntoViewIfNeeded();
  const dragSecond=async(dx:number)=>{
   const b=await second.locator(".mv-clip-drag-surface").boundingBox();assert.ok(b);
   const x=Math.round(b.x+b.width/2),y=Math.floor(b.y+b.height-5);
   const hit=await page.evaluate(({x,y})=>{const el=document.elementFromPoint(x,y);return {target:el?.getAttribute("class"),clip:el?.closest(".mv-clip")?.getAttribute("aria-label")};},{x,y});
   assert.deepEqual(hit,{target:"mv-clip-drag-surface",clip:"Select video second"},"drag must hit the free clip body, not a control");
   if(width<500){
    const client=await page.context().newCDPSession(page);
    await page.evaluate(()=>{
     const events:unknown[]=[];Object.assign(window,{__clipPointerLog:events});
     for(const type of ["pointerdown","pointercancel","pointerup","touchstart","touchend"])document.addEventListener(type,e=>{const p=e as PointerEvent,t=e.target as Element;events.push({type,target:t?.getAttribute("class"),pointerType:p.pointerType,primary:p.isPrimary,button:p.button,x:p.clientX,y:p.clientY});},{capture:true,once:true});
    });
    await client.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y,id:1}]});
    if(!(await second.evaluate(el=>el.classList.contains("is-position-locked")))){
     await page.waitForFunction(()=>document.querySelector('.mv-clip[aria-label="Select video second"]')?.classList.contains("is-armed"),{},{timeout:3000});
    }else await page.waitForTimeout(430);
    for(let step=1;step<=4;step++)await client.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:x+dx*step/4,y,id:1}]});
    await client.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});await client.detach();
   }else{await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y,{steps:5});await page.mouse.up();}
  };
  const oldStart=lockClips[1].timelineStartMs;
  try{
   await Promise.all([save(),dragSecond(-28)]);
  }catch(e){
   console.error("CLIP_DRAG_DIAGNOSTIC",JSON.stringify(await second.evaluate(el=>({className:el.className,rect:{x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height},active:document.activeElement?.getAttribute("class"),error:document.querySelector(".mv-error")?.textContent,events:(window as any).__clipPointerLog}))));
   throw e;
  }
  assert.notEqual(lockClips[1].timelineStartMs,oldStart,"unlocked video must move with a pointer gesture");
  const protectedSave=save();await second.getByRole("button",{name:"Lock clip position: second"}).click();await protectedSave;
  const protectedStart=lockClips[1].timelineStartMs;await dragSecond(15);await page.waitForTimeout(800);
  assert.equal(lockClips[1].timelineStartMs,protectedStart,"locked video must not move");
  console.log("PASS: unlocked clip moves with "+(width<500?"touch hold":"mouse drag")+"; locked clip stays fixed");
  await select(first);const restored=save();await page.getByRole("button",{name:"Return to source time",exact:true}).click();await restored;
  assert.equal(lockClips[0].timelineStartMs,750);assert.equal(lockClips[0].syncLocked,true);
  // Restoring source timing must show a closed padlock, not an open one.
  await first.getByRole("button",{name:"Unlock clip position: first"}).waitFor();
  page.once("dialog",dialog=>dialog.accept());
  const syncUnlocked=save();await first.getByRole("button",{name:"Unlock clip position: first"}).click();await syncUnlocked;
  assert.equal(lockClips[0].syncLocked,false);assert.equal(lockClips[0].positionLocked,false);
  const song=page.getByRole("button",{name:"Select song",exact:true});await song.focus();await song.press("Enter");
  assert.equal(await song.getAttribute("aria-pressed"),"true");
  await page.locator(".mv-main-lane").click({position:{x:5,y:4}});
  assert.equal(await page.locator(".mv-clip.is-selected,.mv-song-block.is-selected").count(),0);
  assert.equal(await page.locator(".mv-inspector-body").count(),0);
  await page.close();console.log("PASS: direct clip eye/lock, save/reload, source restoration and empty selection at "+width+"px");
 }
 // Portal inherits a deliberately dark body foreground, as on the Videos page.
 for(const width of [320,390,1280]){
  const page=await browser.newPage({viewport:{width,height:600},isMobile:width<500,hasTouch:width<500});
  await page.goto(origin+"/add-test");await page.evaluate(()=>{document.body.style.color="#24243d";});
  await page.getByRole("button",{name:"Add to Project",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"Add video to music project"});
  const choice=dialog.getByRole("button",{name:"My music video"});await choice.waitFor();
  assert.equal(await choice.evaluate(el=>getComputedStyle(el).color),"rgb(255, 255, 255)");await choice.click();
  await dialog.getByRole("heading",{name:"Added to Project"}).waitFor();
  const status=dialog.getByRole("status").locator("p"),close=dialog.getByRole("button",{name:"Close",exact:true});
  assert.equal(await status.evaluate(el=>getComputedStyle(el).color),"rgb(227, 255, 242)");
  assert.equal(await dialog.getByRole("heading").evaluate(el=>getComputedStyle(el).color),"rgb(255, 255, 255)");
  assert.equal(await close.evaluate(el=>getComputedStyle(el).color),"rgb(255, 255, 255)");
  const box=await dialog.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=width+1&&box.y>=0&&box.y+box.height<=601);
  await close.click();await dialog.waitFor({state:"hidden"});await page.close();
  console.log("PASS: Add to Project dialog selection, success contrast and Close at "+width+"px");
 }
}finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(root,{recursive:true,force:true});}
