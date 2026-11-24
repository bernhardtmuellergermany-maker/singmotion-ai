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
