export const MIN_TIMELINE_ZOOM=20,MAX_TIMELINE_ZOOM=880;
export function clampTimelineZoom(value:number){
 return Math.max(MIN_TIMELINE_ZOOM,Math.min(MAX_TIMELINE_ZOOM,value));
}
export function anchoredScroll(anchorMs:number,zoom:number,viewportX:number){
 return Math.max(0,anchorMs*zoom/1000-viewportX);
}
/** Only generate visible tick marks plus a small overscan. Labels have enough
 * space even when displaying fractional seconds at high zoom. */
export function timelineGraduations(durationMs:number,zoom:number,scrollLeft:number,width:number){
 const step=[100,200,500,1000,2000,5000,10000].find(ms=>ms*zoom/1000>=(ms<1000?84:72))??10000;
 const minor=step/5;
 const start=Math.max(0,Math.floor((scrollLeft-100)*1000/zoom/minor)*minor);
 const end=Math.min(durationMs,Math.ceil((scrollLeft+Math.max(width,320)+100)*1000/zoom/minor)*minor);
 const ticks:{ms:number;major:boolean}[]=[];
 for(let ms=start;ms<=end;ms+=minor)ticks.push({ms,major:ms%step===0});
 return {step,ticks};
}
export function swipeVelocity(previous:number,delta:number,elapsedMs:number){
 if(!Number.isFinite(delta)||elapsedMs<=0)return previous;
 const instant=Math.max(-2.5,Math.min(2.5,delta/elapsedMs));
 return previous*.25+instant*.75;
}
/** Exponential deceleration, capped by the caller at 650 ms. */
export function inertiaStep(velocity:number,elapsedMs:number){
 const dt=Math.max(0,Math.min(40,elapsedMs));
 const next=velocity*Math.exp(-dt/145);
 return {delta:(velocity+next)/2*dt,velocity:next};
}
