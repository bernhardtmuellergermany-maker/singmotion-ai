export type SongRange={startMs:number;endMs:number};
export const MIN_SONG_RANGE_MS=100;
export function parseSongTime(text:string):number|null{
 const value=text.trim().replace(",",".");
 const clock=/^(\d{1,2}):([0-5]\d)(?:\.(\d{1,3}))?$/.exec(value);
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
