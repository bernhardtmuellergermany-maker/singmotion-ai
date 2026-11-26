export type SongRange={startMs:number;endMs:number};
export const MIN_SONG_RANGE_MS=100;
export function parseSongTime(text:string):number|null{
 const value=text.trim().replace(",",".");
 const clock=/^(\d{1,3}):([0-5]\d)(?:\.(\d{1,3}))?$/.exec(value);
 const seconds=/^(\d{1,4})(?:\.(\d{1,3}))?$/.exec(value);
 if(clock)return Number(clock[1])*60000+Number(clock[2])*1000+Number((clock[3]||"").padEnd(3,"0"));
 if(seconds)return Number(seconds[1])*1000+Number((seconds[2]||"").padEnd(3,"0"));
 return null;
}
export function validSongRange(start:unknown,end:unknown,duration:number):start is number{
 return typeof start==="number"&&typeof end==="number"&&Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&
  start>=0&&end<=duration&&end-start>=MIN_SONG_RANGE_MS;
}
export function moveSongEdge(range:SongRange,edge:"start"|"end",position:number,duration:number):SongRange{
 const ms=Math.round(position);
 return edge==="start"?{...range,startMs:Math.max(0,Math.min(range.endMs-MIN_SONG_RANGE_MS,ms))}:
  {...range,endMs:Math.min(duration,Math.max(range.startMs+MIN_SONG_RANGE_MS,ms))};
}

export const MAX_TIMELINE_MS=7200000;
export type SongPlacement=SongRange&{positionMs:number};
export const songOffset=(r:SongPlacement)=>r.positionMs-r.startMs;
export const songTimelineEnd=(r:SongPlacement)=>r.positionMs+r.endMs-r.startMs;
export function validSongPlacement(r:SongPlacement,duration:number):boolean{
 return validSongRange(r.startMs,r.endMs,duration)&&Number.isSafeInteger(r.positionMs)&&r.positionMs>=0&&songTimelineEnd(r)<=MAX_TIMELINE_MS;
}
export function trimSongPlacement(original:SongPlacement,range:SongRange):SongPlacement{
 return {...range,positionMs:Math.max(0,range.startMs+songOffset(original))};
}
export function shiftLockedClips<T extends {syncLocked:boolean;timelineStartMs:number;sourceInMs:number;sourceOutMs:number;track:number}>(clips:T[],delta:number):T[]|null{
 const moved=clips.map(c=>c.syncLocked?{...c,timelineStartMs:c.timelineStartMs+delta}:c);
 if(moved.some(c=>c.timelineStartMs<0||c.timelineStartMs+c.sourceOutMs-c.sourceInMs>MAX_TIMELINE_MS))return null;
 for(const track of [1,2]){
  const sorted=moved.filter(c=>c.track===track).sort((a,b)=>a.timelineStartMs-b.timelineStartMs);
  if(sorted.some((c,i)=>i>0&&c.timelineStartMs<sorted[i-1].timelineStartMs+sorted[i-1].sourceOutMs-sorted[i-1].sourceInMs))return null;
 }
 return moved;
}

/** Song times refer to the original recording, even after trimming or moving it. */
export const songTimeToTimeline=(ms:number,range:SongPlacement)=>ms+songOffset(range);
export const timelineToSongTime=(ms:number,range:SongPlacement)=>ms-songOffset(range);
export function parseRelativeSongTime(text:string):number|null{
 const trimmed=text.trim();
 if(!trimmed.startsWith("-"))return parseSongTime(trimmed);
 const value=parseSongTime(trimmed.slice(1));
 return value===null?null:-value;
}
type PositionedClip={id:string;track:number;timelineStartMs:number;sourceInMs:number;sourceOutMs:number;syncLocked:boolean};
export function positionVideoClip<T extends PositionedClip>(clips:readonly T[],clip:T,position:number):{status:"ok";clip:T}|{status:"bounds"|"collision"|"locked"}{
 const length=clip.sourceOutMs-clip.sourceInMs;
 if(!Number.isSafeInteger(position)||position<0||length<=0||position+length>MAX_TIMELINE_MS)return {status:"bounds"};
 if(clip.syncLocked&&position!==clip.timelineStartMs)return {status:"locked"};
 if(clips.some(c=>c.id!==clip.id&&c.track===clip.track&&position<c.timelineStartMs+c.sourceOutMs-c.sourceInMs&&position+length>c.timelineStartMs))return {status:"collision"};
 return {status:"ok",clip:{...clip,timelineStartMs:position}};
}

/** Trim without changing the source-to-timeline mapping; clamp to neighboring clips. */
export function trimVideoClip<T extends PositionedClip>(clips:readonly T[],clip:T,edge:"start"|"end",deltaMs:number,sourceDuration:number,timelineLimit=MAX_TIMELINE_MS):T{
 const min=Math.min(100,clip.sourceOutMs-clip.sourceInMs);
 const end=clip.timelineStartMs+clip.sourceOutMs-clip.sourceInMs;
 const others=clips.filter(c=>c.id!==clip.id&&c.track===clip.track);
 const previous=Math.max(0,...others.filter(c=>c.timelineStartMs+c.sourceOutMs-c.sourceInMs<=clip.timelineStartMs).map(c=>c.timelineStartMs+c.sourceOutMs-c.sourceInMs));
 const following=Math.min(timelineLimit,...others.filter(c=>c.timelineStartMs>=end).map(c=>c.timelineStartMs));
 const delta=Math.round(deltaMs);
 if(edge==="start"){
  const lower=Math.max(0,clip.sourceInMs+previous-clip.timelineStartMs);
  const upper=clip.sourceOutMs-min;
  const sourceInMs=Math.min(upper,Math.max(lower,clip.sourceInMs+delta));
  return {...clip,sourceInMs,timelineStartMs:clip.timelineStartMs+sourceInMs-clip.sourceInMs};
 }
 const upper=Math.min(sourceDuration,clip.sourceInMs+following-clip.timelineStartMs);
 const lower=clip.sourceInMs+min;
 return {...clip,sourceOutMs:Math.max(lower,Math.min(upper,clip.sourceOutMs+delta))};
}
export function transferVideoClip<T extends PositionedClip>(clips:readonly T[],clip:T,track:T["track"],position:number):{status:"ok";clip:T}|{status:"bounds"|"collision"|"locked"}{
 if(track!==1&&track!==2)return {status:"bounds"};
 return positionVideoClip(clips,{...clip,track},clip.syncLocked?clip.timelineStartMs:position);
}

/** Marker uses actual timeline milliseconds, not the offset within the source song. */
export function trimSongAtPlayhead(range:SongPlacement,atMs:number,edge:"start"|"end"):SongPlacement|null{
 const at=Math.round(atMs),source=timelineToSongTime(at,range);
 if(!Number.isSafeInteger(at)||source-range.startMs<MIN_SONG_RANGE_MS||range.endMs-source<MIN_SONG_RANGE_MS)return null;
 return edge==="start"?{...range,startMs:source,positionMs:at}:{...range,endMs:source};
}
export function splitVideoAtPlayhead<T extends PositionedClip>(clip:T,atMs:number,rightId:string):[T,T]|null{
 const at=Math.round(atMs),inPoint=clip.sourceInMs+at-clip.timelineStartMs;
 if(!Number.isSafeInteger(at)||inPoint-clip.sourceInMs<100||clip.sourceOutMs-inPoint<100)return null;
 return [{...clip,sourceOutMs:inPoint},{...clip,id:rightId,timelineStartMs:at,sourceInMs:inPoint}];
}
export function snapPlayhead(ms:number,limit:number,markers:readonly number[],threshold:number):number{
 const value=Math.max(0,Math.min(limit,Math.round(ms)));
 const nearest=markers.filter(n=>n>=0&&n<=limit).reduce((a,b)=>Math.abs(b-value)<Math.abs(a-value)?b:a,Infinity);
 return Math.abs(nearest-value)<=threshold?nearest:value;
}

/** One clamped timeline value drives the readout, scrubber and its visible fill. */
export function timelineProgress(atMs:number,durationMs:number):{positionMs:number;percent:number}{
 const end=Number.isFinite(durationMs)?Math.max(0,Math.round(durationMs)):0;
 const positionMs=Number.isFinite(atMs)?Math.max(0,Math.min(end,Math.round(atMs))):0;
 return {positionMs,percent:end>0?positionMs/end*100:0};
}

/** Exact end edit: preserve source start and sync; reject rather than silently clamp. */
export function setVideoEnd<T extends PositionedClip>(clips:readonly T[],clip:T,endMs:number,sourceDuration:number):T|null{
 const oldEnd=clip.timelineStartMs+clip.sourceOutMs-clip.sourceInMs;
 if(!Number.isSafeInteger(endMs)||endMs<clip.timelineStartMs+Math.min(100,clip.sourceOutMs-clip.sourceInMs)||endMs>MAX_TIMELINE_MS)return null;
 const next=trimVideoClip(clips,clip,"end",endMs-oldEnd,sourceDuration);
 return next.timelineStartMs+next.sourceOutMs-next.sourceInMs===endMs?next:null;
}
export const MEDIA_HOLD_MS=350;
export const MEDIA_PAN_THRESHOLD=7;
export function mediaPanAxis(dx:number,dy:number):"x"|"y"|null{
 if(Math.max(Math.abs(dx),Math.abs(dy))<MEDIA_PAN_THRESHOLD)return null;
 return Math.abs(dx)>=Math.abs(dy)?"x":"y";
}

/** Song parts keep the common original-song offset, so edits do not ripple lip sync. */
export function validSongParts(parts:unknown,range:SongPlacement):parts is SongRange[]{
 if(!Array.isArray(parts)||parts.length<1||parts.length>100)return false;
 return parts.every((p,i)=>p&&validSongRange(p.startMs,p.endMs,range.endMs)&&p.startMs>=range.startMs&&
  (i===0||p.startMs>=parts[i-1].endMs));
}
export const effectiveSongParts=(range:SongPlacement,parts:SongRange[]|null):SongRange[]=>parts??[{startMs:range.startMs,endMs:range.endMs}];
export function splitSongPart(range:SongPlacement,parts:SongRange[]|null,at:number):SongRange[]|null{
 const source=timelineToSongTime(Math.round(at),range),list=effectiveSongParts(range,parts);
 if(list.length>=100)return null;
 const i=list.findIndex(p=>source-p.startMs>=MIN_SONG_RANGE_MS&&p.endMs-source>=MIN_SONG_RANGE_MS);
 if(i<0)return null;
 const p=list[i];
 return [...list.slice(0,i),{startMs:p.startMs,endMs:source},{startMs:source,endMs:p.endMs},...list.slice(i+1)];
}
export function songPartAt(range:SongPlacement,parts:SongRange[]|null,at:number):SongPlacement|null{
 const source=timelineToSongTime(at,range);
 const p=effectiveSongParts(range,parts).find(p=>source>=p.startMs&&source<p.endMs);
 return p?{...p,positionMs:songTimeToTimeline(p.startMs,range)}:null;
}
export function songPartsEnd(range:SongPlacement,parts:SongRange[]|null):number{
 return songTimeToTimeline(effectiveSongParts(range,parts).at(-1)!.endMs,range);
}

/** Adjacent split parts are still a continuous recording until a gap is created. */
export function continuousSongParts(range:SongPlacement,parts:SongRange[]|null):SongRange[]{
 const runs:SongRange[]=[];
 for(const p of effectiveSongParts(range,parts)){
  const last=runs.at(-1);
  if(last&&last.endMs===p.startMs)last.endMs=p.endMs;
  else runs.push({...p});
 }
 return runs;
}

/** One source clock for preview and render. No rounding to whole frames here. */
export function clipSourceTimeMs(clip:{sourceInMs:number;sourceOutMs:number;timelineStartMs:number},atMs:number):number{
 return Math.max(clip.sourceInMs,Math.min(clip.sourceOutMs,clip.sourceInMs+atMs-clip.timelineStartMs));
}
/** A visible clip owns its own audio. Only a covered, audible clip needs another decoder.
 * When the song is muted, prefer an audible media clock, then the visible picture. */
export function previewMediaPlan<T extends {id:string;track:1|2;timelineStartMs:number;sourceInMs:number;sourceOutMs:number}>(clips:readonly T[],at:number,mutes:{1:boolean;2:boolean}){
 const end=(c:T)=>c.timelineStartMs+c.sourceOutMs-c.sourceInMs;
 const active=clips.filter(c=>at>=c.timelineStartMs&&at<end(c));
 const one=active.find(c=>c.track===1),two=active.find(c=>c.track===2);
 const visible=two??one;
 const audio1=!mutes[1]&&one&&one!==visible?one:undefined;
 const audio2=!mutes[2]&&two&&two!==visible?two:undefined;
 const clock=visible&&!mutes[visible.track]?visible:audio2??audio1??visible;
 const nextBoundaryMs=clips.reduce((next,c)=>Math.min(next,c.timelineStartMs>at?c.timelineStartMs:Infinity,end(c)>at?end(c):Infinity),Infinity);
 return {visible,audio1,audio2,clock,nextBoundaryMs};
}

/** Find the next change of visible picture rather than just the next clip start.
 * A lower track can reappear partway through its original source after an overlay.
 * Gaps are permitted; callers choose a bounded preloading window. */
export function nextVisibleClipTransition<T extends {id:string;track:1|2;timelineStartMs:number;sourceInMs:number;sourceOutMs:number}>(clips:readonly T[],atMs:number,boundaries:readonly number[],mutes:{1:boolean;2:boolean}):{clip:T;atMs:number}|undefined{
 const active=previewMediaPlan(clips,atMs,mutes).visible;
 for(const boundary of boundaries){
  if(boundary<=atMs)continue;
  const candidate=previewMediaPlan(clips,boundary,mutes).visible;
  if(candidate&&candidate.id!==active?.id)return {clip:candidate,atMs:boundary};
 }
 return undefined;
}

/** Use a half-open timeline interval in both the media clock and the rendered clip.
 * Rounding up before a boundary would unmount the media driving that boundary. */
export function publishedPlaybackMs(at:number):number{
 return Math.max(0,Math.floor(at));
}
export function nativeClipClockStep(clip:{timelineStartMs:number;sourceInMs:number;sourceOutMs:number},at:number,sourceSeconds:number,boundary:number,ended:boolean):number{
 const end=clip.timelineStartMs+clip.sourceOutMs-clip.sourceInMs;
 if(ended)return Math.min(end,boundary);
 if(!Number.isFinite(sourceSeconds))return at;
 return Math.min(boundary,Math.max(at,clip.timelineStartMs+sourceSeconds*1000-clip.sourceInMs));
}
/** Seek large errors; gently correct smaller drift without repeatedly seeking a playing decoder. */
export function mediaSyncDecision(expectedSeconds:number,actualSeconds:number,playing:boolean,paused:boolean,seeking:boolean):{seek:boolean;rate:number}{
 const error=expectedSeconds-actualSeconds,drift=Math.abs(error);
 if(!Number.isFinite(drift))return {seek:false,rate:1};
 if(seeking)return {seek:false,rate:1};
 if(!playing)return {seek:drift>0.001,rate:1};
 if(paused)return {seek:drift>0.025,rate:1};
 // Normal decoder/timestamp jitter is not a reason to discard buffered frames.
 if(drift>0.120)return {seek:true,rate:1};
 if(drift<=0.020)return {seek:false,rate:1};
 return {seek:false,rate:Math.round(Math.max(0.95,Math.min(1.05,1+error))*100)/100};
}

/** Auto follows the first actually visible output frame, not library order. */
export function firstVisibleVideo<T extends {track:number;timelineStartMs:number;sourceInMs:number;sourceOutMs:number}>(clips:readonly T[]):T|undefined{
 const frame=(ms:number)=>Math.ceil(ms*30/1000);
 return clips.filter(c=>frame(c.timelineStartMs+c.sourceOutMs-c.sourceInMs)>frame(c.timelineStartMs))
  .sort((a,b)=>frame(a.timelineStartMs)-frame(b.timelineStartMs)||b.track-a.track)[0];
}
export function aspectFromDimensions(size:{width:number;height:number}):"9:16"|"16:9"{
 return size.height>size.width?"9:16":"16:9";
}
