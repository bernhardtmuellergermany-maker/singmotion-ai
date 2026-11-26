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
