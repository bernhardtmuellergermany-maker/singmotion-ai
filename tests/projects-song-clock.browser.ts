/** Real Chromium audio continuity under a deliberately stalled picture. */
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {stripTypeScriptTypes} from "node:module";
import {chromium} from "@playwright/test";
const audio=execFileSync("ffmpeg",["-nostdin","-v","error","-f","lavfi","-i","sine=frequency=440:sample_rate=44100","-t","3","-f","wav","pipe:1"],{maxBuffer:1024*1024});
const code=stripTypeScriptTypes(readFileSync("lib/music-video/song-range.ts","utf8"),{mode:"transform"});
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({isMobile:true,hasTouch:true,viewport:{width:390,height:844}});
 await page.setContent('<audio id="song" preload="auto"></audio><button id="play">Play</button><video id="picture" muted playsinline></video>');
 await page.evaluate(({src})=>{const song=document.querySelector<HTMLAudioElement>("#song")!;song.src=src;document.querySelector("#play")!.addEventListener("click",()=>void song.play());},{src:"data:audio/wav;base64,"+audio.toString("base64")});
 await page.click("#play");
 const result=await page.evaluate(async({code})=>{
  const url=URL.createObjectURL(new Blob([code],{type:"text/javascript"}));const {songOwnsPreviewClock,mobileVideoSyncDecision}=await import(url);
  const song=document.querySelector<HTMLAudioElement>("#song")!,range={startMs:0,endMs:3000,positionMs:0};let pauses=0,seeks=0,rateChanges=0;
  song.addEventListener("pause",()=>pauses++);song.addEventListener("seeking",()=>seeks++);song.addEventListener("ratechange",()=>rateChanges++);
  const before=song.currentTime;
  for(let i=0;i<12;i++){
   await new Promise(r=>setTimeout(r,75));
   if(!songOwnsPreviewClock(range,null,song.currentTime*1000,false))throw Error("song lost master clock");
   const decision=mobileVideoSyncDecision(song.currentTime,0,true,true,false);
   if(i>=6&&!decision.seek)throw Error("stalled picture needs correction");
  }
  URL.revokeObjectURL(url);return {elapsed:song.currentTime-before,paused:song.paused,pauses,seeks,rateChanges,rate:song.playbackRate};
 },{code});
 assert.ok(result.elapsed>0.6);assert.equal(result.paused,false);assert.equal(result.pauses,0);assert.equal(result.seeks,0);assert.equal(result.rateChanges,0);assert.equal(result.rate,1);
 console.log("PASS: audible song keeps playing at 1x during stalled mobile picture");
}finally{await browser.close();}
