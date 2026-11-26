/** Isolated real Chromium A/V transport test using the editor's shared gate. */
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {stripTypeScriptTypes} from "node:module";
import {chromium} from "@playwright/test";
const wav=execFileSync("ffmpeg",["-nostdin","-v","error","-f","lavfi","-i","sine=frequency=440:sample_rate=44100","-t","4","-f","wav","pipe:1"],{maxBuffer:1024*1024});
const webm=execFileSync("ffmpeg",["-nostdin","-v","error","-f","lavfi","-i","color=c=blue:s=160x90:r=30","-t","4","-c:v","libvpx","-threads","1","-f","webm","pipe:1"],{maxBuffer:1024*1024});
const code=stripTypeScriptTypes(readFileSync("lib/music-video/song-range.ts","utf8"),{mode:"transform"});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined,args:["--autoplay-policy=no-user-gesture-required"]});
try{
 for(const mobile of [false,true]){
  const page=await browser.newPage(mobile?{isMobile:true,hasTouch:true,viewport:{width:390,height:844}}:{});
  await page.setContent('<audio id="song" preload="auto"></audio><video id="picture" muted playsinline preload="auto"></video>');
  const result=await page.evaluate(async({code,wav,webm})=>{
   const url=URL.createObjectURL(new Blob([code],{type:"text/javascript"}));
   const {pictureSyncGate}=await import(url);
   const song=document.querySelector<HTMLAudioElement>("#song")!,video=document.querySelector<HTMLVideoElement>("#picture")!;
   const delay=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
   const ready=(m:HTMLMediaElement)=>new Promise<void>((resolve,reject)=>{if(m.readyState>=3)resolve();else{m.addEventListener("canplay",()=>resolve(),{once:true});m.addEventListener("error",()=>reject(Error("Media error")),{once:true});setTimeout(()=>reject(Error("Media timeout")),5000);}});
   song.src=wav;await ready(song);
   assertGate(pictureSyncGate(0,video,false)==="wait");
   await delay(150);const before=song.currentTime;
   video.src=webm;await ready(video);
   assertGate(pictureSyncGate(0,video,false)==="ready");
   await Promise.all([song.play(),video.play()]);await delay(250);
   // Force a decoder stall and verify the common transport holds.
   video.pause();await delay(200);
   assertGate(pictureSyncGate(song.currentTime,video,true)==="align");
   song.pause();const held=song.currentTime;video.currentTime=held;
   if(video.seeking)await new Promise<void>(resolve=>video.addEventListener("seeked",()=>resolve(),{once:true}));
   await ready(video);await delay(200);
   const stationary=Math.abs(song.currentTime-held)<0.015;
   assertGate(pictureSyncGate(held,video,false)==="ready");
   await Promise.all([song.play(),video.play()]);await delay(300);
   const drift=Math.abs(song.currentTime-video.currentTime),resumed=song.currentTime-held;
   URL.revokeObjectURL(url);
   return {before,stationary,drift,resumed,rate:song.playbackRate};
   function assertGate(ok:boolean){if(!ok)throw Error("Unexpected picture gate");}
  },{code,wav:"data:audio/wav;base64,"+wav.toString("base64"),webm:"data:video/webm;base64,"+webm.toString("base64")});
  assert.equal(result.before,0);assert.equal(result.stationary,true);assert.ok(result.drift<0.12);assert.ok(result.resumed>0.18);assert.equal(result.rate,1);
  console.log("PASS: synchronized preview waits and resumes at 1x on "+(mobile?"mobile":"desktop")+" Chromium");
  await page.close();
 }
}finally{await browser.close();}
