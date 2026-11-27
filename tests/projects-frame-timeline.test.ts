import assert from "node:assert/strict";
import test from "node:test";
import {makeFrameTimeline,frameTarget,audioAt,TimelineClock,FrameRequestGate} from "../lib/music-video/frame-timeline.ts";
import {videoRenderSpans} from "../lib/music-video/export.ts";
import type {MusicClip} from "../lib/music-video/core.ts";

const range={startMs:800,endMs:5500,positionMs:1500};
const parts=[{startMs:800,endMs:2600},{startMs:3000,endMs:5500}];
const clips:MusicClip[]=[
 {id:"base",assetId:"lip",track:1,timelineStartMs:1500,sourceInMs:800,sourceOutMs:4400,syncLocked:true},
 {id:"overlay",assetId:"broll",track:2,timelineStartMs:2137,sourceInMs:512,sourceOutMs:1462,syncLocked:false},
 {id:"tail",assetId:"lip2",track:1,timelineStartMs:5201,sourceInMs:250,sourceOutMs:1000,syncLocked:false}
];
test("frame timeline exactly follows existing export spans including non-frame-aligned cuts and gaps",()=>{
 const timeline=makeFrameTimeline(clips,range,parts,{song:false,1:true,2:true});
 assert.deepEqual(timeline.spans,videoRenderSpans(clips,timeline.durationMs));
 for(let ms=0;ms<timeline.durationMs;ms++){
  const frame=frameTarget(timeline,ms)!;
  const span=videoRenderSpans(clips,timeline.durationMs).find(s=>frame.frame>=s.startFrame&&frame.frame<s.endFrame)!;
  assert.equal(frame.clip?.id,span.clip?.id);
  if(span.clip)assert.ok(Math.abs(frame.sourceMs!-(span.sourceMs+(frame.frame-span.startFrame)*1000/30))<.000001);
 }
 assert.equal(frameTarget(timeline,2137)?.clip?.id,"base");
 assert.equal(frameTarget(timeline,2167)?.clip?.id,"overlay");
 assert.equal(frameTarget(timeline,3100)?.clip?.id,"base");
 assert.equal(frameTarget(timeline,5150)?.clip,null);
 assert.equal(frameTarget(timeline,0)?.clip,null);
});
test("audio uses the same unrounded timeline, including trimmed/moved song and muted lanes",()=>{
 const timeline=makeFrameTimeline(clips,range,parts,{song:false,1:true,2:false});
 assert.equal(audioAt(timeline,2139).find(a=>a.lane==="song")?.sourceMs,1439);
 assert.equal(audioAt(timeline,2139).find(a=>a.lane===2)?.sourceMs,514);
 assert.equal(audioAt(timeline,3400).some(a=>a.lane==="song"),false);
 assert.equal(audioAt(timeline,3701).find(a=>a.lane==="song")?.sourceMs,3001);
 assert.equal(audioAt(timeline,2139).some(a=>a.lane===1),false);
});
test("one clock retains play intent during a backwards seek and paused seeks stay paused",()=>{
 let audio=10;const clock=new TimelineClock(10000,()=>audio);
 clock.seek(8923);clock.play();audio+=.1;assert.ok(Math.abs(clock.at()-9023)<.00001);
 clock.seek(1234);assert.equal(clock.playing,true);audio+=.08;assert.ok(Math.abs(clock.at()-1314)<.00001);
 audio-=.03;assert.ok(Math.abs(clock.at()-1314)<.00001);
 clock.pause();clock.seek(567);audio+=2;assert.equal(clock.at(),567);assert.equal(clock.playing,false);
 clock.play();audio+=.1;assert.ok(Math.abs(clock.at()-667)<.00001);
});
test("out-of-order frame decoding never paints the previous scrub position",async()=>{
 const gate=new FrameRequestGate<string>(),painted:string[]=[],released:string[]=[];
 let complete!:(value:string)=>void;
 const old=gate.select(()=>new Promise(resolve=>{complete=resolve}),frame=>painted.push(frame),frame=>released.push(frame));
 const latest=await gate.select(async()=>"new",frame=>painted.push(frame),frame=>released.push(frame));
 complete("old");
 assert.equal(latest,true);assert.equal(await old,false);
 assert.deepEqual(painted,["new"]);assert.deepEqual(released,["new","old"]);
});
