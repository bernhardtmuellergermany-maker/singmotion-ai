/** Customer-facing, verified-project metadata formatting. Missing timestamps
 * must be displayed as unavailable, never inferred from the current clock.
 */
export function videoTimecode(seconds:number|null|undefined,milliseconds=false):string|null{
 if(typeof seconds!=="number"||!Number.isFinite(seconds)||seconds<0||seconds>24*3600)return null;
 const ms=Math.round(seconds*1000);
 const h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000),s=Math.floor(ms%60000/1000);
 const base=(h?String(h).padStart(2,"0")+":":"")+String(m).padStart(2,"0")+":"+String(s).padStart(2,"0");
 return milliseconds?base+"."+String(ms%1000).padStart(3,"0"):base;
}
export function sourceTimeLabel(start:number|null|undefined,end:number|null|undefined):string|null{
 if(start===null||end===null||start===undefined||end===undefined||end<start)return null;
 const from=videoTimecode(start,true),to=videoTimecode(end,true);
 return from&&to?from+" – "+to:null;
}
export function aiGenerationElapsed(startedAt:number|null|undefined,finishedAt:number|null|undefined):string|null{
 if(typeof startedAt!=="number"||typeof finishedAt!=="number"||
    !Number.isSafeInteger(startedAt)||!Number.isSafeInteger(finishedAt)||
    startedAt<=0||finishedAt<startedAt||finishedAt-startedAt>7*24*3600000)return null;
 const total=Math.max(0,Math.floor((finishedAt-startedAt)/1000));
 const hours=Math.floor(total/3600),mins=Math.floor(total%3600/60),secs=total%60;
 return (hours?hours+"h ":"")+(mins?mins+"m ":"")+(secs+"s");
}
export function projectCreatedLabel(createdAt:number|null|undefined):string|null{
 if(typeof createdAt!=="number"||!Number.isSafeInteger(createdAt)||createdAt<946684800000||
    createdAt>Date.now()+24*3600000)return null;
 return new Intl.DateTimeFormat("en-GB",{
  year:"numeric",month:"short",day:"2-digit",hour:"2-digit",minute:"2-digit",
 }).format(new Date(createdAt));
}
