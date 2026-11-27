import {clipSourceTimeMs,effectiveSongParts,songOffset,songPartsEnd,type SongPlacement,type SongRange} from "./song-range.ts";

export const TIMELINE_FPS=30;
export type FrameClip={id:string;assetId:string;track:1|2;timelineStartMs:number;sourceInMs:number;sourceOutMs:number};
export type FrameSpan<C extends FrameClip=FrameClip>={startFrame:number;endFrame:number;clip:C|null;sourceMs:number};
export type AudioSpan={assetId:string;timelineStartMs:number;timelineEndMs:number;sourceStartMs:number;lane:"song"|1|2};
export type FrameTarget<C extends FrameClip=FrameClip>={frame:number;timelineMs:number;clip:C|null;sourceMs:number|null};
export type FrameTimeline<C extends FrameClip=FrameClip>={durationMs:number;frames:number;spans:FrameSpan<C>[];audio:AudioSpan[]};

/** Identical half-open output-frame intervals to export.ts videoRenderSpans.
 * Audio stays at its exact millisecond position; only the picture is quantized. */
export function makeFrameTimeline<C extends FrameClip>(clips:readonly C[],range:SongPlacement,parts:SongRange[]|null,mutes:{song:boolean;1:boolean;2:boolean}):FrameTimeline<C>{
 const durationMs=songPartsEnd(range,parts),frames=Math.ceil(durationMs*TIMELINE_FPS/1000);
 const end=(c:C)=>c.timelineStartMs+c.sourceOutMs-c.sourceInMs;
 const frame=(ms:number)=>Math.min(frames,Math.max(0,Math.ceil(ms*TIMELINE_FPS/1000)));
 const bounds=[...new Set([0,frames,...clips.flatMap(c=>[frame(c.timelineStartMs),frame(end(c))])])].sort((a,b)=>a-b);
 const spans:FrameSpan<C>[]=[];
 for(let i=0;i<bounds.length-1;i++){
  const startFrame=bounds[i],endFrame=bounds[i+1],at=startFrame*1000/TIMELINE_FPS;
  const clip=clips.filter(c=>frame(c.timelineStartMs)<=startFrame&&frame(end(c))>startFrame).sort((a,b)=>b.track-a.track)[0]??null;
  const previous=spans.at(-1);
  if(previous&&previous.clip?.id===clip?.id){previous.endFrame=endFrame;continue;}
  spans.push({startFrame,endFrame,clip,sourceMs:clip?clipSourceTimeMs(clip,at):0});
 }
 const audio:AudioSpan[]=[];
 if(!mutes.song)for(const p of effectiveSongParts(range,parts)){
  audio.push({assetId:"song",timelineStartMs:p.startMs+songOffset(range),timelineEndMs:p.endMs+songOffset(range),sourceStartMs:p.startMs,lane:"song"});
 }
 for(const c of clips)if(!mutes[c.track]&&c.timelineStartMs<durationMs){
  audio.push({assetId:c.assetId,timelineStartMs:c.timelineStartMs,timelineEndMs:Math.min(durationMs,end(c)),sourceStartMs:c.sourceInMs,lane:c.track});
 }
 return {durationMs,frames,spans,audio};
}
/** Compare only data that determines decoded pictures and mixed audio.
 * Editor-only metadata (role, sync lock, name visibility) does not invalidate media. */
export function sameFrameTimeline(a:FrameTimeline,b:FrameTimeline):boolean{
 if(a.durationMs!==b.durationMs||a.frames!==b.frames||a.spans.length!==b.spans.length||a.audio.length!==b.audio.length)return false;
 return a.spans.every((s,i)=>{
  const t=b.spans[i],c=s.clip,d=t.clip;
  return s.startFrame===t.startFrame&&s.endFrame===t.endFrame&&s.sourceMs===t.sourceMs&&
   (c===null||d===null?c===d:c.id===d.id&&c.assetId===d.assetId&&c.track===d.track&&c.timelineStartMs===d.timelineStartMs&&c.sourceInMs===d.sourceInMs&&c.sourceOutMs===d.sourceOutMs);
 })&&a.audio.every((s,i)=>{const t=b.audio[i];return s.assetId===t.assetId&&s.lane===t.lane&&s.timelineStartMs===t.timelineStartMs&&s.timelineEndMs===t.timelineEndMs&&s.sourceStartMs===t.sourceStartMs;});
}
/** Map any scrub position to the frame the export would show there.
 * At EOF retain the last output frame for paused inspection. */
export function frameTarget<C extends FrameClip>(timeline:FrameTimeline<C>,ms:number):FrameTarget<C>|null{
 if(!Number.isFinite(ms)||timeline.frames===0)return null;
 const frame=Math.max(0,Math.min(timeline.frames-1,Math.floor(ms*TIMELINE_FPS/1000)));
 let lo=0,hi=timeline.spans.length-1;
 while(lo<=hi){
  const mid=(lo+hi)>>>1,span=timeline.spans[mid];
  if(frame<span.startFrame)hi=mid-1;
  else if(frame>=span.endFrame)lo=mid+1;
  else{const timelineMs=frame*1000/TIMELINE_FPS;return {frame,timelineMs,clip:span.clip,sourceMs:span.clip?clipSourceTimeMs(span.clip,timelineMs):null};}
 }
 return null;
}
/** Audio offsets are never quantized to the display frame rate. */
export function audioAt(timeline:FrameTimeline,ms:number){
 return timeline.audio.filter(a=>ms>=a.timelineStartMs&&ms<a.timelineEndMs).map(a=>({...a,sourceMs:a.sourceStartMs+ms-a.timelineStartMs}));
}
/** Use one output-audio clock for transport and frame selection. A seek changes
 * the anchor, never the user's play/pause intent. Clock readings cannot rewind
 * the position during ordinary playback. */
export class TimelineClock{
 private position=0;
 private anchor=0;
 private running=false;
 private last=0;
 private readonly durationMs:number;
 private readonly readAudioClock:()=>number;
 constructor(durationMs:number,readAudioClock:()=>number){this.durationMs=durationMs;this.readAudioClock=readAudioClock;}
 get playing(){return this.running;}
 at(){
  const next=this.running?Math.min(this.durationMs,this.position+Math.max(0,this.readAudioClock()-this.anchor)*1000):this.position;
  this.last=Math.max(this.last,next);
  return this.last;
 }
 play(){if(this.running)return;this.position=this.last;this.anchor=this.readAudioClock();this.running=true;}
 pause(){this.position=this.at();this.running=false;}
 seek(ms:number){if(!Number.isFinite(ms))return;this.position=this.last=Math.max(0,Math.min(this.durationMs,ms));this.anchor=this.readAudioClock();}
}
/** Latest scrub wins; stale decoder output must never replace a newer picture.
 * The presentation callback is synchronous. The caller owns decoder resources. */
export class FrameRequestGate<T>{
 private generation=0;
 invalidate(){this.generation++;}
 async select(decode:()=>Promise<T>,present:(frame:T)=>void,release:(frame:T)=>void):Promise<boolean>{
  const generation=++this.generation;
  const frame=await decode();
  try{if(generation!==this.generation)return false;present(frame);return true;}
  finally{release(frame);}
 }
}
