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
const bundled=await build({stdin:{contents:'import React from "react";import {createRoot} from "react-dom/client";import {MusicVideoEditor} from "./components/music-video-editor";createRoot(document.getElementById("root")!).render(<MusicVideoEditor id="fixture-project"/>);',resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'},loader:{".css":"empty"},plugins:[{name:"isolated-link",setup(b:any){b.onResolve({filter:/^next\/link$/},()=>({path:"link",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:'import React from "react";export default function Link(p){return React.createElement("a",p)}',loader:"js",resolveDir:process.cwd()}));}}]});
const script=bundled.outputFiles[0].contents;
const css=readFileSync("components/music-video.css");
const project={id:"fixture-project",ownerId:"staff:fixture",name:"Replay",songName:"Test song",songDurationMs:4000,songStartMs:0,songEndMs:4000,songPositionMs:0,songParts:null,trackMutes:{1:true,2:true,song:false},revision:0,createdAt:1,updatedAt:1,aspectRatio:"16:9"};
const assets=["first","second"].map(id=>({id,projectId:project.id,name:id,kind:"imported",role:id==="first"?"lip-sync":"b-roll",sourceKind:"uploaded",sourceId:"mp4",durationMs:4000,sourceStartMs:null,sourceEndMs:null,createdAt:1}));
const clips=[{id:"c1",assetId:"first",track:1,timelineStartMs:0,sourceInMs:250,sourceOutMs:1750,syncLocked:false},{id:"c2",assetId:"second",track:2,timelineStartMs:2000,sourceInMs:500,sourceOutMs:2000,syncLocked:false}];
let timelineRequests=0,assetRequests=0;
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
 if(p.includes("/timeline-preview")){timelineRequests++;res.writeHead(404);res.end();return;}
 if(p.endsWith("/song"))return media(song,"audio/mpeg");
 if(p.includes("/assets/")){assetRequests++;res.writeHead(403);res.end();return;}
 if(p.includes("/preview/")&&req.method==="POST")return json({ready:true,unsupported:false});
 if(p.includes("/preview/"))return media(video,"video/mp4");
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
   const state={starts:[] as {when:number;now:number;offset:number;duration:number}[],frames:[] as number[],sampleTimes:[] as number[]};
   Object.assign(window,{__frameEngineTest:state});
   const native=AudioBufferSourceNode.prototype.start;
   AudioBufferSourceNode.prototype.start=function(when=0,offset=0,duration?:number){state.starts.push({when,now:this.context.currentTime,offset,duration:duration??0});return duration===undefined?native.call(this,when,offset):native.call(this,when,offset,duration);};
   const observe=()=>{const canvas=document.querySelector<HTMLCanvasElement>('[data-frame-preview="true"]');if(canvas?.dataset.frame!==undefined){state.frames.push(Number(canvas.dataset.frame));if(canvas.dataset.sourceTime)state.sampleTimes.push(Number(canvas.dataset.sourceTime));}requestAnimationFrame(observe);};requestAnimationFrame(observe);
  });
  await page.goto(origin);
  const play=page.getByRole("button",{name:"Play",exact:true}),pause=page.getByRole("button",{name:"Pause",exact:true}),seek=page.getByRole("slider",{name:"Seek timeline"}),canvas=page.locator("canvas[data-frame-preview=true]");
  await play.waitFor({timeout:10000});
  assert.equal(await page.locator("video,audio").count(),0);
  assert.equal(await page.getByRole("button",{name:"Synced review",exact:true}).count(),0);
  await page.waitForFunction(()=>document.querySelectorAll(".mv-clip .mv-clip-waveform[data-waveform=ready] .mv-wave-shape").length===2&&!!document.querySelector(".mv-song-block .mv-wave-shape"),{},{timeout:10000});
  assert.equal(await page.locator(".mv-lane.is-audio-muted .mv-wave-shape").count(),2);
  for(const shape of await page.locator(".mv-wave-shape").all())assert.equal(await shape.evaluate(el=>getComputedStyle(el).fill),"rgb(255, 255, 255)");
  assert.equal(await page.locator(".mv-song-wave-title").textContent(),"Test song");
  const library=page.locator(".mv-library-heading");await library.click();
  const search=page.getByRole("searchbox",{name:"Search media"});await search.waitFor();
  const checkSearch=async()=>{const style=await search.evaluate(el=>({input:getComputedStyle(el).backgroundColor,wrapper:getComputedStyle(el.parentElement!).backgroundColor,shadow:getComputedStyle(el).boxShadow}));assert.deepEqual(style,{input:"rgba(0, 0, 0, 0)",wrapper:"rgb(19, 29, 43)",shadow:"none"});};
  await checkSearch();await search.focus();await checkSearch();await search.fill("first");assert.equal(await page.locator(".mv-media-card").count(),1);await search.fill("");await library.click();
  await page.waitForFunction(()=>{const c=document.querySelector<HTMLCanvasElement>('[data-frame-preview=true]');return c?.dataset.frame==="0"&&Math.abs(Number(c.dataset.sourceTime)-.25)<.04;},{},{timeout:15000});
  const pixel=()=>canvas.evaluate(c=>Array.from((c as HTMLCanvasElement).getContext("2d")!.getImageData(400,240,1,1).data));
  assert.ok((await pixel())[0]>200,"initial source frame is red");
  const jump=async(ms:number)=>{await seek.evaluate((el,value)=>{const input=el as HTMLInputElement;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,String(value));input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));},ms);};
  // Rapid seeks while paused: last target wins, including the source trim.
  await seek.press("End");await seek.press("Home");await jump(900);
  await page.waitForFunction(()=>{const c=document.querySelector<HTMLCanvasElement>('[data-frame-preview=true]');return c?.dataset.frame==="27"&&Math.abs(Number(c.dataset.sourceTime)-1.15)<.04;},{},{timeout:15000});
  const green=await pixel();assert.ok(green[1]>100&&green[0]<50,"scrubbed frame is green");
  assert.equal(await play.count(),1);
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
  await seek.press("Home");
  await page.waitForFunction(()=>{const f=Number(document.querySelector<HTMLCanvasElement>('[data-frame-preview=true]')?.dataset.frame);return f>=4&&f<=15;},{},{timeout:15000});
  assert.equal(await pause.count(),1);
  const ruler=await page.locator(".mv-ruler").boundingBox();assert.ok(ruler);
  await page.mouse.move(ruler.x+40,ruler.y+ruler.height/2);await page.mouse.down();
  await page.mouse.move(ruler.x+8,ruler.y+ruler.height/2,{steps:4});await page.mouse.up();
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
  console.log("PASS: single WebCodecs/Web Audio editor paints exact source frames, gap and trim; playback is monotonic, scrub preserves intent, no server timeline render on "+(mobile?"mobile":"desktop")+" Chromium");
  await page.close();
 }
}finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(root,{recursive:true,force:true});}
