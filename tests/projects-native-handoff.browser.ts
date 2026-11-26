/** Isolated real Chromium decoder regression, no account data or external network. */
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {stripTypeScriptTypes} from "node:module";
import {chromium} from "@playwright/test";

const media=execFileSync("ffmpeg",["-nostdin","-hide_banner","-loglevel","error","-f","lavfi","-i","color=c=blue:s=160x90:r=25","-t","0.6","-c:v","libvpx","-threads","1","-f","webm","pipe:1"],{maxBuffer:1024*1024});
const moduleCode=stripTypeScriptTypes(readFileSync("lib/music-video/song-range.ts","utf8"),{mode:"transform"});
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();
 await page.setContent('<video id="first" muted playsinline preload="auto"></video><video id="second" muted playsinline preload="auto"></video>');
 const result=await page.evaluate(async({uri,moduleCode})=>{
  const url=URL.createObjectURL(new Blob([moduleCode],{type:"text/javascript"}));
  const {nativeClockAction,nativeClipClockStep}=await import(url);
  const first=document.querySelector<HTMLVideoElement>("#first")!,second=document.querySelector<HTMLVideoElement>("#second")!;
  for(const v of [first,second]){v.muted=true;v.src=uri;}
  await Promise.all([first,second].map(v=>new Promise<void>((resolve,reject)=>{if(v.readyState>=2)resolve();else{v.addEventListener("loadeddata",()=>resolve(),{once:true});v.addEventListener("error",()=>reject(Error("decoder error")),{once:true});}})));
  const clip={timelineStartMs:0,sourceInMs:0,sourceOutMs:700};
  let at=0,restarts=0;
  await first.play();
  await new Promise<void>((resolve,reject)=>{
   const deadline=performance.now()+5000;
   function tick(){
    if(performance.now()>deadline){reject(Error("first clip failed to advance"));return;}
    const action=nativeClockAction(first,true);
    if(action==="play"){restarts++;void first.play();}
    if(action==="ended"){at=nativeClipClockStep(clip,at,first.currentTime,700,true);resolve();return;}
    if(action==="running")at=nativeClipClockStep(clip,at,first.currentTime,700,false);
    requestAnimationFrame(tick);
   }
   tick();
  });
  if(nativeClockAction(second,true)!=="play")throw Error("next decoder not ready");
  await second.play();
  await new Promise<void>((resolve,reject)=>{if(second.ended)resolve();else{second.addEventListener("ended",()=>resolve(),{once:true});setTimeout(()=>reject(Error("second did not end")),5000);}});
  URL.revokeObjectURL(url);
  return {at,restarts,firstEnded:first.ended,secondEnded:second.ended};
 },{uri:"data:video/webm;base64,"+media.toString("base64"),moduleCode});
 assert.deepEqual(result,{at:700,restarts:0,firstEnded:true,secondEnded:true});
 console.log("PASS: native decoder EOF advances to the next preloaded video without replay or a second user gesture");
}finally{await browser.close();}
