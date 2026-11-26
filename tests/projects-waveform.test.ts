import test from "node:test";
import assert from "node:assert/strict";
import {pcmWaveform,validWaveform,waveformShape,waveformPointCount,WAVEFORM_MAX_POINTS} from "../lib/music-video/waveform.ts";

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
