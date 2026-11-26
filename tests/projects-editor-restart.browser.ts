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
execFileSync("ffmpeg",["-nostdin","-v","error","-f","lavfi","-i","testsrc2=size=320x180:rate=30","-t","4","-an","-c:v","libx264","-threads","1","-pix_fmt","yuv420p","-profile:v","baseline","-g","15","-movflags","+faststart",mp4]);
const video=readFileSync(mp4);
const song=execFileSync("ffmpeg",["-nostdin","-v","error","-f","lavfi","-i","sine=frequency=440:sample_rate=44100","-t","4","-f","wav","pipe:1"],{maxBuffer:1024*1024});
const bundled=await build({stdin:{contents:'import React from "react";import {createRoot} from "react-dom/client";import {MusicVideoEditor} from "./components/music-video-editor";createRoot(document.getElementById("root")!).render(<MusicVideoEditor id="fixture-project"/>);',resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'},loader:{".css":"empty"},plugins:[{name:"isolated-link",setup(b:any){b.onResolve({filter:/^next\/link$/},()=>({path:"link",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:'import React from "react";export default function Link(p){return React.createElement("a",p)}',loader:"js",resolveDir:process.cwd()}));}}]});
const script=bundled.outputFiles[0].contents;
const css=readFileSync("components/music-video.css");
const project={id:"fixture-project",ownerId:"staff:fixture",name:"Replay",songName:"Test song",songDurationMs:4000,songStartMs:0,songEndMs:4000,songPositionMs:0,songParts:null,trackMutes:{1:true,2:true,song:false},revision:0,createdAt:1,updatedAt:1,aspectRatio:"16:9"};
const assets=["first","second"].map(id=>({id,projectId:project.id,name:id,kind:"imported",role:"b-roll",sourceKind:"uploaded",sourceId:"mp4",durationMs:4000,sourceStartMs:null,sourceEndMs:null,createdAt:1}));
const clips=[{id:"c1",assetId:"first",track:1,timelineStartMs:0,sourceInMs:250,sourceOutMs:1750,syncLocked:false},{id:"c2",assetId:"second",track:2,timelineStartMs:2000,sourceInMs:500,sourceOutMs:2000,syncLocked:false}];
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
 if(p.endsWith("/waveform"))return json({peaks:[.2,.5,.2]});
 if(p.includes("/format/"))return json({width:320,height:180});
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
  });
  await page.goto(origin);
  const play=page.getByRole("button",{name:"Play",exact:true}),pause=page.getByRole("button",{name:"Pause",exact:true});
  await play.waitFor({timeout:10000});
  await page.waitForFunction(()=>{const v=document.querySelector<HTMLVideoElement>('video[aria-hidden="false"]'),a=document.querySelector<HTMLAudioElement>("audio");return v?.currentSrc.startsWith("blob:")&&v.readyState>=2&&!v.seeking&&Math.abs(v.currentTime-.25)<.05&&a&&a.readyState>=2;},{},{timeout:15000});
  const seek=page.getByRole("slider",{name:"Seek timeline"});
  for(let i=0;i<3;i++){
   await play.click();
   await page.waitForFunction(()=>{const a=document.querySelector<HTMLAudioElement>("audio"),v=document.querySelector<HTMLVideoElement>('video[aria-hidden="false"]');return a&&v&&!a.paused&&!v.paused&&a.currentTime>.25&&Math.abs(v.currentTime-a.currentTime-.25)<.18;},{},{timeout:3000});
   assert.equal(await page.getByText("Buffering video…",{exact:true}).count(),0);
   await pause.click();
   await seek.press("Home");
   await page.waitForFunction(()=>{const a=document.querySelector<HTMLAudioElement>("audio"),v=document.querySelector<HTMLVideoElement>('video[aria-hidden="false"]');return a&&v&&!a.seeking&&!v.seeking&&a.currentTime<.035&&Math.abs(v.currentTime-.25)<.04;},{},{timeout:3000});
  }
  // Natural EOF followed by Play must reset both clocks, not immediately end again.
  await play.click();await play.waitFor({timeout:10000});
  await play.click();
  await page.waitForFunction(()=>{const a=document.querySelector<HTMLAudioElement>("audio"),v=document.querySelector<HTMLVideoElement>('video[aria-hidden="false"]');return a&&v&&!a.paused&&!v.paused&&a.currentTime>.2&&a.currentTime<1.4&&Math.abs(v.currentTime-a.currentTime-.25)<.18;},{},{timeout:3000});
  console.log("PASS: actual Projects editor starts, seeks and replays from EOF on "+(mobile?"mobile":"desktop")+" Chromium with paused decoder at HAVE_CURRENT_DATA");
  await page.close();
 }
}finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(root,{recursive:true,force:true});}
