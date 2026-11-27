import test from "node:test";
import assert from "node:assert/strict";
import {pcmWaveform,validWaveform,waveformShape,waveformBars,timelineWaveformBars,waveformPointCount,WAVEFORM_MAX_POINTS} from "../lib/music-video/waveform.ts";

test("real waveform peaks retain source timing, including silence and short audio streams",()=>{
 const pcm=Buffer.alloc(2000*2);
 for(let i=500;i<1000;i++)pcm.writeInt16LE(16384,i*2);
 const wave=pcmWaveform(pcm,2000);
 assert.equal(wave.peaks.length,100);
 assert.ok(validWaveform(wave,2000));
 assert.ok(wave.peaks.slice(0,12).every(v=>v===0));
 assert.equal(wave.peaks[13],.5);
 assert.ok(wave.peaks.slice(25).every(v=>v===0));
 assert.ok(!waveformShape(wave,0,200,100).includes("26.50"));
 assert.ok(waveformShape(wave,260,480,100).includes("26.50"));
 assert.ok(!waveformShape(wave,600,2000,100).includes("26.50"));
 assert.equal(waveformShape(wave,300,300,100),"");
 assert.equal(waveformShape({durationMs:2000,hasAudio:false,peaks:[]},0,2000,100),"");
 assert.ok(validWaveform({durationMs:2000,hasAudio:false,peaks:[]}));
 assert.ok(!validWaveform({durationMs:2000,hasAudio:true,peaks:[]}));
 assert.equal(waveformPointCount(7200000),WAVEFORM_MAX_POINTS);
});

test("FFmpeg extracts real video sound and distinguishes a video without an audio track",async()=>{
 const {execFileSync}=await import("node:child_process");
 const {mkdtempSync,rmSync}=await import("node:fs");
 const {tmpdir}=await import("node:os");
 const path=await import("node:path");
 const {extractMediaWaveform}=await import("../lib/music-video/waveform-extract.ts");
 const root=mkdtempSync(path.join(tmpdir(),"sm-waveform-"));
 try{
  const silent=path.join(root,"silent.mp4"),audible=path.join(root,"audible.mp4");
  execFileSync("ffmpeg",["-nostdin","-v","error","-f","lavfi","-i","color=c=black:s=64x64:r=10","-t","2","-an","-c:v","mpeg4","-threads","1",silent]);
  execFileSync("ffmpeg",["-nostdin","-v","error","-i",silent,"-f","lavfi","-i","sine=frequency=440:sample_rate=44100:duration=1","-c:v","copy","-c:a","aac","-t","2",audible]);
  const noAudio=await extractMediaWaveform(silent,2000),sound=await extractMediaWaveform(audible,2000);
  assert.deepEqual(noAudio,{durationMs:2000,peaks:[],hasAudio:false});
  assert.ok(validWaveform(sound,2000));
  assert.ok(sound.peaks.slice(5,40).some(v=>v>.05));
  assert.ok(sound.peaks.slice(65).every(v=>v===0));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test("Lip-Sync clip audio from the same song aligns on the timeline after source trimming and song movement",async()=>{
 const {execFileSync}=await import("node:child_process");
 const {mkdtempSync,rmSync,writeFileSync}=await import("node:fs");
 const {tmpdir}=await import("node:os");
 const path=await import("node:path");
 const {extractMediaWaveform}=await import("../lib/music-video/waveform-extract.ts");
 const {songTimeToTimeline,clipSourceTimeMs}=await import("../lib/music-video/song-range.ts");
 const root=mkdtempSync(path.join(tmpdir(),"sm-wave-alignment-"));
 try{
  // Deterministic musical transients, with silence between them, not fake display peaks.
  const sr=16000,duration=6000,pulses=[1400,2100,3500,4400];
  const pcm=Buffer.alloc(sr*6*2);
  for(let i=0;i<sr*6;i++){
   const ms=i*1000/sr;
   if(pulses.some(t=>ms>=t&&ms<t+120))pcm.writeInt16LE(Math.round(23000*Math.sin(2*Math.PI*440*i/sr)),i*2);
  }
  const raw=path.join(root,"song.raw"),mp3=path.join(root,"song.mp3"),mp4=path.join(root,"lip-sync.mp4");
  writeFileSync(raw,pcm);
  const audioInput=["-f","s16le","-ar",String(sr),"-ac","1","-i",raw];
  execFileSync("ffmpeg",["-nostdin","-v","error",...audioInput,"-c:a","libmp3lame","-b:a","128k",mp3]);
  execFileSync("ffmpeg",["-nostdin","-v","error","-f","lavfi","-i","color=c=black:s=64x64:r=10","-ss","1.2",...audioInput,"-map","0:v:0","-map","1:a:0","-t","3.6","-c:v","mpeg4","-threads","1","-c:a","aac",mp4]);
  const song=await extractMediaWaveform(mp3,duration),video=await extractMediaWaveform(mp4,3600);
  assert.ok(validWaveform(song,duration)&&validWaveform(video,3600));
  const onsets=(wave:typeof song)=>wave.peaks.flatMap((v,i)=>v>.2&&(i===0||wave.peaks[i-1]<=.2)?[i*wave.durationMs/wave.peaks.length]:[]);
  const songOnsets=onsets(song),videoOnsets=onsets(video);
  assert.equal(songOnsets.length,4);assert.equal(videoOnsets.length,4);
  // The generated video's first frame corresponds to source song time 1.2s.
  // Its first 400ms are trimmed; song itself begins at source 800ms, placed at 1500ms.
  const range={startMs:800,endMs:5500,positionMs:1500};
  const sourceStart=1200;
  const clip={sourceInMs:400,sourceOutMs:3400,timelineStartMs:songTimeToTimeline(sourceStart+400,range)};
  for(let i=1;i<pulses.length;i++){
   const songAt=songTimeToTimeline(songOnsets[i],range);
   const videoAt=clip.timelineStartMs+videoOnsets[i]-clip.sourceInMs;
   assert.ok(Math.abs(songAt-videoAt)<=40,"audio transient timeline alignment: "+songAt+" vs "+videoAt);
   assert.ok(Math.abs(clipSourceTimeMs(clip,songAt)-videoOnsets[i])<=40);
  }
  // Validate rendered coordinates against the very same clock, after trimming.
  const firstPeak=(wave:typeof song,from:number,to:number,width:number)=>{
   const shape=waveformShape(wave,from,to,width);
   const points=[...shape.matchAll(/(?:M| L)([0-9.]+),([0-9.]+)/g)];
   const upper=points.find(p=>Number(p[2])<40);
   assert.ok(upper);
   return from+Number(upper[1])/1000*(to-from);
  };
  for(const zoom of [44,120,240]){
   const songFrom=sourceStart+clip.sourceInMs,songTo=sourceStart+clip.sourceOutMs;
   const width=(clip.sourceOutMs-clip.sourceInMs)/1000*zoom;
   const songAt=firstPeak(song,songFrom,songTo,width);
   const videoAt=firstPeak(video,clip.sourceInMs,clip.sourceOutMs,width)+sourceStart;
   assert.ok(Math.abs(songAt-videoAt)<=Math.max(40,2000/zoom),"rendered peak alignment at zoom "+zoom);
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});

test("Lip-Sync presentation gate catches displayed frames that lag despite identical media clocks",async()=>{
 const {lipSyncFrameDecision,presentedFrameError}=await import("../lib/music-video/presented-frame-sync.ts");
 const frame={mediaTime:1.82,displayTime:1000,observedAt:1000};
 assert.equal(lipSyncFrameDecision(2,2,frame,1000,250,true).outOfSync,true);
 assert.equal(lipSyncFrameDecision(2,2,{...frame,mediaTime:1.97},1000,250,true).outOfSync,false);
 assert.equal(lipSyncFrameDecision(2,2,{...frame,mediaTime:2.12},1000,250,true).outOfSync,true);
 assert.equal(lipSyncFrameDecision(2,2,frame,1000,50,true).outOfSync,false);
 assert.equal(lipSyncFrameDecision(2,1.89,null,1000,250,true).outOfSync,true);
 assert.equal(lipSyncFrameDecision(2,1.96,null,1000,250,true).rate,1.06);
 assert.equal(lipSyncFrameDecision(2,2.04,null,1000,250,true).rate,.94);
 assert.ok(Math.abs(presentedFrameError(2,{...frame,mediaTime:2.016,displayTime:1016},1000,true)!)<.00001);
});

test("rounded clip bars use real source peaks and bounded time-proportional sampling",()=>{
 const wave={durationMs:1000,hasAudio:true,peaks:[0,0,.5,1,0,0,0,0,0,0]};
 const bars=waveformBars(wave,0,1000,100);
 assert.equal(bars.match(/M/g)?.length,10);
 assert.ok(bars.includes("M350.00,5.00 V95.00"));
 assert.ok(!waveformBars(wave,400,1000,100).includes("5.00 V95.00"));
 assert.equal(waveformBars({...wave,hasAudio:false},0,1000,100),"");
 assert.equal(waveformBars(wave,500,500,100),"");
});

test("song and video bars share one absolute timeline sampling grid",()=>{
 const peaks=Array.from({length:500},(_,i)=>i%7/7);
 const song={durationMs:10000,hasAudio:true,peaks};
 const clip={durationMs:4000,hasAudio:true,peaks:peaks.slice(100,300)};
 const read=(shape:string,start:number,duration:number)=>[...shape.matchAll(/M([0-9.]+),([0-9.]+) V([0-9.]+)/g)].map(m=>({at:Math.round(start+Number(m[1])/1000*duration),height:Number(m[3])-Number(m[2])}));
 const all=read(timelineWaveformBars(song,0,10000,0,100),0,10000);
 const local=read(timelineWaveformBars(clip,0,4000,2000,100),2000,4000);
 assert.deepEqual(local,all.filter(b=>b.at>=2000&&b.at<6000));
 assert.ok(timelineWaveformBars(clip,0,4000,2037,100).startsWith("M3.250,"));
});
