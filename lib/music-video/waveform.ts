/** Shared bounded waveform geometry; timestamps refer to the original media clock. */
export const WAVEFORM_SAMPLE_RATE=2000;
export const WAVEFORM_MAX_POINTS=18000;
export type MediaWaveform={durationMs:number;peaks:number[];hasAudio:boolean};
export function waveformPointCount(durationMs:number){
 return Math.max(1,Math.min(WAVEFORM_MAX_POINTS,Math.ceil(durationMs/20)));
}
export function pcmWaveform(pcm:Uint8Array,durationMs:number):MediaWaveform{
 if(!Number.isFinite(durationMs)||durationMs<=0||durationMs>7200000)throw Error("Invalid waveform duration");
 const count=waveformPointCount(durationMs),peaks=Array<number>(count).fill(0);
 const view=new DataView(pcm.buffer,pcm.byteOffset,pcm.byteLength);
 const samples=Math.min(Math.floor(pcm.byteLength/2),Math.ceil(durationMs*WAVEFORM_SAMPLE_RATE/1000));
 for(let i=0;i<samples;i++){
  const bin=Math.min(count-1,Math.floor(i*count/(durationMs*WAVEFORM_SAMPLE_RATE/1000)));
  peaks[bin]=Math.max(peaks[bin],Math.abs(view.getInt16(i*2,true))/32768);
 }
 return {durationMs,hasAudio:true,peaks:peaks.map(v=>Math.round(v*1000)/1000)};
}
export function validWaveform(value:unknown,durationMs?:number):value is MediaWaveform{
 if(!value||typeof value!=="object")return false;
 const w=value as MediaWaveform;
 return Number.isFinite(w.durationMs)&&w.durationMs>0&&w.durationMs<=7200000&&(durationMs===undefined||w.durationMs===durationMs)&&typeof w.hasAudio==="boolean"&&Array.isArray(w.peaks)&&
 (w.hasAudio?w.peaks.length===waveformPointCount(w.durationMs)&&w.peaks.every(v=>Number.isFinite(v)&&v>=0&&v<=1):w.peaks.length===0);
}
/** Sample only the selected source interval, with bounded geometry even for long clips. */
export function waveformShape(w:MediaWaveform,sourceInMs:number,sourceOutMs:number,width:number):string{
 if(!w.hasAudio||!w.peaks.length||sourceOutMs<=sourceInMs||width<=0)return "";
 const from=Math.max(0,Math.min(w.durationMs,sourceInMs)),to=Math.max(from,Math.min(w.durationMs,sourceOutMs));
 if(to<=from)return "";
 const points=Math.max(2,Math.min(1200,Math.ceil(width/2),Math.ceil((to-from)/w.durationMs*w.peaks.length)));
 const top:string[]=[],bottom:string[]=[];
 for(let i=0;i<=points;i++){
  const at=from+(to-from)*i/points;
  const half=(to-from)/points/2;
  const first=Math.max(0,Math.min(w.peaks.length-1,Math.floor(Math.max(from,at-half)/w.durationMs*w.peaks.length)));
  const last=Math.max(first,Math.min(w.peaks.length-1,Math.ceil(Math.min(to,at+half)/w.durationMs*w.peaks.length)-1));
  let peak=0;for(let j=first;j<=last;j++)peak=Math.max(peak,w.peaks[j]);
  const x=(i/points*1000).toFixed(2),height=peak*47;
  top.push(x+","+(50-height).toFixed(2));bottom.push(x+","+(50+height).toFixed(2));
 }
 return "M"+top.join(" L")+" L"+bottom.reverse().join(" L")+" Z";
}

/** Rounded individual bars, sampled from the actual source interval. The x
 * coordinate remains proportional to media time, including silent sections. */
export function waveformBars(w:MediaWaveform,sourceInMs:number,sourceOutMs:number,width:number):string{
 if(!w.hasAudio||!w.peaks.length||sourceOutMs<=sourceInMs||width<=0)return "";
 const from=Math.max(0,Math.min(w.durationMs,sourceInMs)),to=Math.max(from,Math.min(w.durationMs,sourceOutMs));
 if(to<=from)return "";
 const points=Math.max(1,Math.min(1200,Math.floor(width/4),Math.ceil((to-from)/w.durationMs*w.peaks.length)));
 const bars:string[]=[];
 for(let i=0;i<points;i++){
  const a=from+(to-from)*i/points,b=from+(to-from)*(i+1)/points;
  const first=Math.max(0,Math.min(w.peaks.length-1,Math.floor(a/w.durationMs*w.peaks.length)));
  const last=Math.max(first,Math.min(w.peaks.length-1,Math.ceil(b/w.durationMs*w.peaks.length)-1));
  let peak=0;for(let j=first;j<=last;j++)peak=Math.max(peak,w.peaks[j]);
  const x=((i+.5)/points*1000).toFixed(2),height=Math.max(.7,peak*45);
  bars.push("M"+x+","+(50-height).toFixed(2)+" V"+(50+height).toFixed(2));
 }
 return bars.join(" ");
}

/** Both song and clip use the same absolute timeline grid, so the bar
 * centers and sampling windows do not drift with independent clip widths.
 * The source PCM remains real; amplitude differences are not fabricated. */
export function timelineWaveformBars(w:MediaWaveform,sourceInMs:number,sourceOutMs:number,timelineStartMs:number,gridMs:number):string{
 const duration=sourceOutMs-sourceInMs;
 if(!w.hasAudio||!w.peaks.length||duration<=0||!Number.isFinite(gridMs)||gridMs<=0||!Number.isFinite(timelineStartMs))return "";
 const end=timelineStartMs+duration,step=gridMs;
 const bars:string[]=[];
 for(let i=Math.max(0,Math.floor(timelineStartMs/step));i*step<end&&bars.length<1202;i++){
  const center=(i+.5)*step;
  if(center<timelineStartMs||center>=end)continue;
  const from=Math.max(0,sourceInMs,sourceInMs+i*step-timelineStartMs);
  const to=Math.min(w.durationMs,sourceOutMs,sourceInMs+(i+1)*step-timelineStartMs);
  if(to<=from)continue;
  const first=Math.max(0,Math.min(w.peaks.length-1,Math.floor(from/w.durationMs*w.peaks.length)));
  const last=Math.max(first,Math.min(w.peaks.length-1,Math.ceil(to/w.durationMs*w.peaks.length)-1));
  let peak=0;for(let j=first;j<=last;j++)peak=Math.max(peak,w.peaks[j]);
  const x=((center-timelineStartMs)/duration*1000).toFixed(3),height=Math.max(.7,peak*45);
  bars.push("M"+x+","+(50-height).toFixed(2)+" V"+(50+height).toFixed(2));
 }
 return bars.join(" ");
}
