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
import {startMusicTimelinePreview,musicTimelinePreviewStatus,musicTimelinePreviewFile,musicExportFile} from "../lib/music-video/export.ts";
import type {MusicProject,MusicClip} from "../lib/music-video/core.ts";
const require=createRequire(import.meta.url);
// Use the existing tsx bundler dependency, including when npm nests it.
const {build}=createRequire(require.resolve("tsx/package.json"))("esbuild");
const root=mkdtempSync(path.join(tmpdir(),"projects-replay-"));
const mp4=path.join(root,"clip.mp4");
execFileSync("ffmpeg",["-nostdin","-v","error","-f","lavfi","-i","testsrc2=size=320x180:rate=30","-t","4","-an","-c:v","libx264","-threads","1","-pix_fmt","yuv420p","-profile:v","baseline","-g","15","-movflags","+faststart",mp4]);
const video=readFileSync(mp4);
const song=execFileSync("ffmpeg",["-nostdin","-v","error","-f","lavfi","-i","sine=frequency=440:sample_rate=44100","-t","4","-f","wav","pipe:1"],{maxBuffer:1024*1024});
const bundled=await build({stdin:{contents:'import React from "react";import {createRoot} from "react-dom/client";import {MusicVideoEditor} from "./components/music-video-editor";createRoot(document.getElementById("root")!).render(<MusicVideoEditor id="fixture-project"/>);',resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'},loader:{".css":"empty"},plugins:[{name:"isolated-link",setup(b:any){b.onResolve({filter:/^next\/link$/},()=>({path:"link",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:'import React from "react";export default function Link(p){return React.createElement("a",p)}',loader:"js",resolveDir:process.cwd()}));}}]});
const script=bundled.outputFiles[0].contents;
const css=readFileSync("components/music-video.css");
const project={id:"fixture-project",ownerId:"staff:fixture",name:"Replay",songName:"Test song",songDurationMs:4000,songStartMs:0,songEndMs:4000,songPositionMs:0,songParts:null,trackMutes:{1:true,2:true,song:false},revision:0,createdAt:1,updatedAt:1,aspectRatio:"16:9"};
const assets=["first","second"].map(id=>({id,projectId:project.id,name:id,kind:"imported",role:id==="first"?"lip-sync":"b-roll",sourceKind:"uploaded",sourceId:"mp4",durationMs:4000,sourceStartMs:null,sourceEndMs:null,createdAt:1}));
const clips=[{id:"c1",assetId:"first",track:1,timelineStartMs:0,sourceInMs:250,sourceOutMs:1750,syncLocked:false},{id:"c2",assetId:"second",track:2,timelineStartMs:2000,sourceInMs:500,sourceOutMs:2000,syncLocked:false}];
const songFile=path.join(root,"song.wav");
const {writeFileSync}=await import("node:fs");writeFileSync(songFile,song);
const fixtureOwner="staff:fixture";
const job=await startMusicTimelinePreview(fixtureOwner,project as MusicProject,clips as MusicClip[],new Map(assets.map(a=>[a.id,mp4])),songFile,async()=>{});
let status=job;
const deadline=Date.now()+60000;
while(status.state==="rendering"&&Date.now()<deadline){await new Promise(r=>setTimeout(r,100));status=(await musicTimelinePreviewStatus(fixtureOwner,project.id,project.revision,job.id))!;}
assert.equal(status.state,"ready");
const rendered=await musicTimelinePreviewFile(fixtureOwner,project.id,project.revision,job.id);assert.ok(rendered);
assert.equal(await musicTimelinePreviewFile("staff:other",project.id,project.revision,job.id),null);
assert.equal(await musicTimelinePreviewFile(fixtureOwner,project.id,1,job.id),null);
assert.equal(await musicExportFile(fixtureOwner,project.id,job.id),null);
const syncedBytes=readFileSync(rendered);
let previewRequests=0,reviewMediaRequests=0;
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
 if(p==="/")return send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/editor.css"></head><body><div id="root"></div><script src="/editor.js"></script></body></html>',"text/html");
 if(p==="/editor.js")return send(script,"application/javascript");
 if(p==="/editor.css")return send(css,"text/css");
 if(p==="/api/music-video/fixture-project")return json({project,assets,clips});
 if(p.includes("/waveform"))return json({durationMs:4000,hasAudio:true,peaks:Array.from({length:200},(_,i)=>i<50?.2:i<100?.8:.1)});
 if(p.includes("/format/"))return json({width:320,height:180});
 if(p.endsWith("/timeline-preview")&&req.method==="POST"){previewRequests++;return json(status);}
 if(p.endsWith("/timeline-preview/"+job.id)){
  if(!url.searchParams.has("media"))return json(status);
  reviewMediaRequests++;
  assert.equal(req.headers.range,undefined,"review must be fully downloaded, not range streamed");
  // Deliver a partial response first to exercise slow mobile downloads.
  const midpoint=Math.floor(syncedBytes.length/2);
  res.writeHead(200,{"content-type":"video/mp4","content-length":syncedBytes.length});
  res.write(syncedBytes.subarray(0,midpoint));
  setTimeout(()=>res.end(syncedBytes.subarray(midpoint)),350);return;
 }
 if(p.endsWith("/song"))return media(song,"audio/wav");
 if(p.includes("/preview/")&&req.method==="POST")return json({ready:true,unsupported:false});
 if(p.includes("/preview/")||p.includes("/assets/"))return media(video,"video/mp4");
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
   // Reproduce the paused Android decoder reporting only HAVE_CURRENT_DATA.
   const get=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,"readyState")!.get!;
   Object.defineProperty(HTMLVideoElement.prototype,"readyState",{get(){const actual=get.call(this);return this.paused?Math.min(actual,2):actual;}});
   // Reproduce a slow first audio startup. The visible picture must not run
   // ahead and then seek backwards when the native song clock finally starts.
   const nativePlay=HTMLMediaElement.prototype.play;
   const startup={armed:false,delayed:false,audioReleased:false,earlyVideoPlays:0,backwardSeeks:0};
   Object.assign(window,{__startupTest:startup});
   const clock=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,"currentTime")!;
   Object.defineProperty(HTMLMediaElement.prototype,"currentTime",{...clock,set(value){
    if(startup.armed&&this instanceof HTMLVideoElement&&this.dataset.clipId==="c1"&&value<clock.get!.call(this)-.025)startup.backwardSeeks++;
    clock.set!.call(this,value);
   }});
   HTMLMediaElement.prototype.play=function(){
    if(startup.armed&&this instanceof HTMLAudioElement&&!startup.delayed){
     startup.delayed=true;return new Promise<void>((resolve,reject)=>setTimeout(()=>{startup.audioReleased=true;nativePlay.call(this).then(resolve,reject);},260));
    }
    if(startup.armed&&this instanceof HTMLVideoElement&&this.dataset.clipId==="c1"&&!startup.audioReleased)startup.earlyVideoPlays++;
    return nativePlay.call(this);
   };
   // Native compositor callbacks, not only currentTime: inject a delayed
   // presentation timestamp once while the underlying media clock is normal.
   const native=HTMLVideoElement.prototype.requestVideoFrameCallback;
   if(native){
    const state={armed:false,injected:false,until:0,repairSeeks:0,frames:[] as number[]};
    Object.assign(window,{__frameTest:state});
    document.addEventListener("seeking",event=>{
     const el=event.target;
     if(state.injected&&el instanceof HTMLVideoElement&&el.dataset.clipId==="c1")state.repairSeeks++;
    },true);
    HTMLVideoElement.prototype.requestVideoFrameCallback=function(cb){
     return native.call(this,(now,meta)=>{
      const a=document.querySelector<HTMLAudioElement>("audio");
      if(this.dataset.clipId==="c1"&&this.getAttribute("aria-hidden")==="false"&&a&&!a.paused&&!this.paused&&!this.seeking){
       state.frames.push(Math.abs(a.currentTime+.25-meta.mediaTime));
       if(state.armed&&!state.injected&&a.currentTime>.35&&a.currentTime<.85){state.injected=true;state.until=performance.now()+240;}
      }
      cb(now,state.injected&&performance.now()<state.until&&this.dataset.clipId==="c1"?{...meta,mediaTime:Math.max(0,meta.mediaTime-.22)}:meta);
     });
    };
   }
  });
  await page.goto(origin);
  const play=page.getByRole("button",{name:"Play",exact:true}),pause=page.getByRole("button",{name:"Pause",exact:true});
  await play.waitFor({timeout:10000});
  assert.equal(await page.getByRole("button",{name:"Live",exact:true}).getAttribute("aria-pressed"),"true","live playback must be the default");
  const initialPreviewRequests=previewRequests;
  await page.waitForFunction(()=>document.querySelectorAll(".mv-clip .mv-clip-waveform[data-waveform=ready] .mv-wave-shape").length===2&&!!document.querySelector(".mv-song-block .mv-wave-shape"),{},{timeout:10000});
  assert.equal(await page.locator(".mv-lane.is-audio-muted .mv-wave-shape").count(),2);
  for(const shape of await page.locator(".mv-wave-shape").all())assert.equal(await shape.evaluate(el=>getComputedStyle(el).fill),"rgb(255, 255, 255)");
  const firstShape=await page.locator(".mv-clip .mv-wave-shape").first().getAttribute("d");
  assert.ok(firstShape&&firstShape.length>20);
  assert.equal(await page.locator(".mv-song-wave-title").textContent(),"Test song");
  const library=page.locator(".mv-library-heading");await library.click();
  const search=page.getByRole("searchbox",{name:"Search media"});
  await search.waitFor();
  const checkSearch=async()=>{const style=await search.evaluate(el=>({input:getComputedStyle(el).backgroundColor,wrapper:getComputedStyle(el.parentElement!).backgroundColor,shadow:getComputedStyle(el).boxShadow}));assert.deepEqual(style,{input:"rgba(0, 0, 0, 0)",wrapper:"rgb(19, 29, 43)",shadow:"none"});};
  await checkSearch();await search.focus();await checkSearch();await search.fill("first");assert.equal(await page.locator(".mv-media-card").count(),1);await search.fill("");await library.click();
  await page.waitForFunction(()=>{const v=document.querySelector<HTMLVideoElement>('video[aria-hidden="false"]'),a=document.querySelector<HTMLAudioElement>("audio");return v?.currentSrc.startsWith("blob:")&&v.readyState>=2&&!v.seeking&&Math.abs(v.currentTime-.25)<.05&&a&&a.readyState>=2;},{},{timeout:15000});
  const seek=page.getByRole("slider",{name:"Seek timeline"});
  await page.evaluate(()=>{(window as any).__startupTest.armed=true;});
  for(let i=0;i<3;i++){
   await play.click();
   await page.waitForFunction(()=>{const a=document.querySelector<HTMLAudioElement>("audio"),v=document.querySelector<HTMLVideoElement>('video[aria-hidden="false"]');return a&&v&&!a.paused&&!v.paused&&a.currentTime>.25&&Math.abs(v.currentTime-a.currentTime-.25)<.18;},{},{timeout:3000});
   assert.equal(await page.getByText("Buffering video…",{exact:true}).count(),0);
   if(i===0){const startup=await page.evaluate(()=>{const s=(window as any).__startupTest;s.armed=false;return s;});assert.equal(startup.delayed,true);assert.equal(startup.earlyVideoPlays,0,"picture must not run before the native song starts");assert.equal(startup.backwardSeeks,0,"startup must not replay frames");console.log("PASS: delayed audio startup does not replay visible video frames on "+(mobile?"mobile":"desktop")+" Chromium");}
   await pause.click();
   await seek.press("Home");
   await page.waitForFunction(()=>{const a=document.querySelector<HTMLAudioElement>("audio"),v=document.querySelector<HTMLVideoElement>('video[aria-hidden="false"]');return a&&v&&!a.seeking&&!v.seeking&&a.currentTime<.035&&Math.abs(v.currentTime-.25)<.04;},{},{timeout:3000});
  }
  const nativeFrames=await page.evaluate(()=>((window as any).__frameTest?.frames??[]) as number[]);
  if(await page.evaluate(()=>!!(window as any).__frameTest)){
   assert.ok(nativeFrames.length>3,"actual presentation callbacks must be observed");
   const sorted=nativeFrames.sort((a,b)=>a-b);
   assert.ok(sorted[Math.floor(sorted.length*.8)]<.14,"native frame/audio timestamp drift");
   await page.evaluate(()=>{(window as any).__frameTest.armed=true;});
   await play.click();
   await page.waitForFunction(()=>{const s=(window as any).__frameTest;return s.injected&&s.repairSeeks>0;},{},{timeout:5000});
   await page.waitForFunction(()=>{const a=document.querySelector<HTMLAudioElement>("audio"),v=document.querySelector<HTMLVideoElement>('video[aria-hidden="false"]');return a&&v&&!a.paused&&!v.paused&&!v.seeking&&a.currentTime>.6&&a.currentTime<1.5&&Math.abs(v.currentTime-a.currentTime-.25)<.10;},{},{timeout:4000});
   await pause.click();await seek.press("Home");
   await page.waitForFunction(()=>{const a=document.querySelector<HTMLAudioElement>("audio"),v=document.querySelector<HTMLVideoElement>('video[aria-hidden="false"]');return a&&v&&!a.seeking&&!v.seeking&&a.currentTime<.035&&Math.abs(v.currentTime-.25)<.04;},{},{timeout:3000});
   console.log("PASS: Lip-Sync editor detects delayed presented video frames and resumes with song on "+(mobile?"mobile":"desktop")+" Chromium");
  }
  // Natural EOF followed by Play must reset both clocks, not immediately end again.
  await play.click();await play.waitFor({timeout:10000});
  await play.click();
  await page.waitForFunction(()=>{const a=document.querySelector<HTMLAudioElement>("audio"),v=document.querySelector<HTMLVideoElement>('video[aria-hidden="false"]');return a&&v&&!a.paused&&!v.paused&&a.currentTime>.2&&a.currentTime<1.4&&Math.abs(v.currentTime-a.currentTime-.25)<.18;},{},{timeout:3000});
  await seek.press("Home");
  await page.waitForFunction(()=>{const a=document.querySelector<HTMLAudioElement>("audio");return a&&!a.paused&&a.currentTime>.12&&a.currentTime<.65;},{},{timeout:3000});
  assert.equal(await pause.count(),1,"quick-edit seek must retain Play");
  const ruler=await page.locator(".mv-ruler").boundingBox();assert.ok(ruler);
  await page.mouse.move(ruler.x+40,ruler.y+ruler.height/2);await page.mouse.down();
  await page.mouse.move(ruler.x+8,ruler.y+ruler.height/2,{steps:4});await page.mouse.up();
  await page.waitForFunction(()=>{const a=document.querySelector<HTMLAudioElement>("audio");return a&&!a.paused&&a.currentTime>.12&&a.currentTime<.8;},{},{timeout:3000});
  assert.equal(await pause.count(),1,"quick-edit drag must retain Play");
  console.log("PASS: actual Projects editor starts, seeks and replays from EOF on "+(mobile?"mobile":"desktop")+" Chromium with paused decoder at HAVE_CURRENT_DATA");
  await pause.click();
  assert.equal(previewRequests,initialPreviewRequests,"live editing never triggers server timeline render");
  await page.getByRole("button",{name:"Synced review",exact:true}).click();await seek.press("Home");
  const requestsBefore=previewRequests,mediaBefore=reviewMediaRequests;
  await play.click();
  const muxed=page.locator("video[data-synced-preview=true]");
  await page.getByText(/Loading preview locally…/).waitFor({timeout:10000});
  assert.equal(await muxed.count(),0,"do not play before complete download");
  await muxed.waitFor({timeout:10000});
  await page.waitForFunction(()=>{const v=document.querySelector<HTMLVideoElement>("video[data-synced-preview=true]");return v&&!v.paused&&!v.seeking&&v.currentTime>.2;},{},{timeout:5000});
  assert.equal(await page.locator("audio").count(),0);assert.equal(await page.locator(".mv-video-box video").count(),1);
  assert.ok((await muxed.getAttribute("src"))?.startsWith("blob:"),"review uses local blob");
  await page.route("**/timeline-preview/**",route=>route.abort());
  await pause.click();await seek.press("End");await seek.press("Home");
  await page.waitForFunction(()=>{const v=document.querySelector<HTMLVideoElement>("video[data-synced-preview=true]");return v&&!v.seeking&&v.currentTime<.04;});
  await play.click();await page.waitForFunction(()=>{const v=document.querySelector<HTMLVideoElement>("video[data-synced-preview=true]");return v&&!v.paused&&v.currentTime>.2;});
  await seek.press("Home");
  await page.waitForFunction(()=>{const v=document.querySelector<HTMLVideoElement>("video[data-synced-preview=true]");return v&&!v.paused&&!v.seeking&&v.currentTime>.1&&v.currentTime<.65;},{},{timeout:3000});
  assert.equal(await pause.count(),1,"synced seek must retain Play");
  const syncedRuler=await page.locator(".mv-ruler").boundingBox();assert.ok(syncedRuler);
  await page.mouse.move(syncedRuler.x+40,syncedRuler.y+syncedRuler.height/2);await page.mouse.down();
  await page.mouse.move(syncedRuler.x+8,syncedRuler.y+syncedRuler.height/2,{steps:4});await page.mouse.up();
  await page.waitForFunction(()=>{const v=document.querySelector<HTMLVideoElement>("video[data-synced-preview=true]");return v&&!v.paused&&!v.seeking&&v.currentTime>.12&&v.currentTime<.8;},{},{timeout:3000});
  assert.equal(await pause.count(),1,"synced drag must retain Play");
  await pause.click();await seek.press("Home");await page.waitForTimeout(250);
  assert.ok(await muxed.evaluate(el=>(el as HTMLVideoElement).paused));
  assert.equal(await play.count(),1,"explicit pause remains paused after seek");
  assert.equal(previewRequests,requestsBefore+1,"same saved revision reuses one muxed player");
  assert.equal(reviewMediaRequests,mediaBefore+1,"review seeks and replay never fetch the file again");
  console.log("PASS: synced review loads completely once and plays/seeks with network blocked on "+(mobile?"mobile":"desktop")+" Chromium");
  console.log("PASS: dragging or seeking backward retains Play in both preview modes; explicit Pause stays paused on "+(mobile?"mobile":"desktop")+" Chromium");
  console.log("PASS: exact rendered timeline uses one native A/V player across pause, seek and replay on "+(mobile?"mobile":"desktop")+" Chromium");
  await page.close();
 }
}finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(root,{recursive:true,force:true});}
