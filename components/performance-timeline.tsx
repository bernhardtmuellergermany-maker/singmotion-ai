"use client";
import { useState } from "react";
import { Plus, Trash2, Clock3 } from "lucide-react";

export type PerformanceSection = {id:string;start:number;end:number;camera:string;emotion:string;instructions:string};
const cameraModes=["Static","Orbit left","Orbit right","Push-in","Pull-out","Pan left","Pan right"];
const emotions=["Neutral","Emotional","Smile","Happy","Sad","Intense","Calm"];
const palette=["#a43afb","#64748b","#00c6eb","#e89047","#e66ca3"];
export function timelinePrompt(sections: PerformanceSection[]) {
  return sections.slice().sort((a,b)=>a.start-b.start).map(s=>
    `${s.start.toFixed(1)}-${s.end.toFixed(1)}s: Camera ${s.camera}; Expression ${s.emotion}.${s.instructions.trim()?" "+s.instructions.trim():""}`
  ).join("\n");
}
export function PerformanceTimeline({duration,sections,onChange}:{
  duration:number;sections:PerformanceSection[];onChange:(value:PerformanceSection[])=>void;
}) {
  const seconds=Math.max(1,Math.min(300,Math.ceil(duration)));
  const [notice,setNotice]=useState("");
  function add() {
    const sorted=[...sections].sort((a,b)=>a.start-b.start);
    let cursor=0;
    for(const section of sorted) {
      if(section.start-cursor>=0.5)break;
      cursor=Math.max(cursor,section.end);
    }
    if(seconds-cursor<0.5){setNotice("All time sections are assigned. Edit or remove one to make space.");return;}
    const end=Math.min(seconds,cursor+Math.min(3,seconds-cursor));
    onChange([...sections,{id:crypto.randomUUID(),start:cursor,end,camera:"Static",emotion:"Neutral",instructions:""}]);
    setNotice("");
  }
  function patch(id:string,change:Partial<PerformanceSection>) {
    onChange(sections.map(s=>s.id===id?{...s,...change}:s));
  }
  const ticks=Array.from({length:Math.min(seconds,15)+1},(_,i)=>i);
  return <section className="sm-timeline" aria-label="Performance Timeline">
    <div className="sm-timeline-heading"><Clock3 size={29}/><div><h2>Performance Timeline <span>Optional</span></h2><p>Define camera movements, emotions, actions and instructions for each time section.</p></div><strong>Duration: {seconds} seconds</strong></div>
    <div className="sm-timeline-ruler">{ticks.map(i=><span key={i}>{i}s</span>)}</div>
    <div className="sm-timeline-track">
      {sections.map((s,i)=><div key={s.id} title={`${s.start}–${s.end}s: ${s.camera}`} style={{left:`${100*s.start/seconds}%`,width:`${100*(s.end-s.start)/seconds}%`,background:palette[i%palette.length]}}>{s.camera}{s.emotion!=="Neutral"?" + "+s.emotion:""}</div>)}
    </div>
    {!sections.length?<div className="sm-timeline-empty"><Plus size={42}/><strong>No sections yet</strong><p>Add your first section to direct your singer's performance.</p><button type="button" onClick={add}><Plus size={19}/> Add Section</button></div>:
      <div className="sm-timeline-cards">{sections.map((s,i)=><article key={s.id} style={{borderColor:palette[i%palette.length]}}>
        <header><strong>{s.start.toFixed(1)} – {s.end.toFixed(1)} s</strong><button type="button" aria-label="Remove section" onClick={()=>onChange(sections.filter(x=>x.id!==s.id))}><Trash2 size={17}/></button></header>
        <label>Start (seconds)<input type="number" min={0} max={s.end-0.5} step={0.5} value={s.start} onChange={e=>{const n=Number(e.target.value);if(n>=0&&n<=s.end-0.5)patch(s.id,{start:n});}}/></label>
        <label>End (seconds)<input type="number" min={s.start+0.5} max={seconds} step={0.5} value={s.end} onChange={e=>{const n=Number(e.target.value);if(n>=s.start+0.5&&n<=seconds)patch(s.id,{end:n});}}/></label>
        <label>Camera movement<select value={s.camera} onChange={e=>patch(s.id,{camera:e.target.value})}>{cameraModes.map(x=><option key={x}>{x}</option>)}</select></label>
        <label>Emotion / Expression<select value={s.emotion} onChange={e=>patch(s.id,{emotion:e.target.value})}>{emotions.map(x=><option key={x}>{x}</option>)}</select></label>
        <label>Custom instructions<textarea maxLength={500} rows={3} value={s.instructions} placeholder="Describe the action…" onChange={e=>patch(s.id,{instructions:e.target.value})}/></label>
      </article>)}</div>}
    {!!sections.length&&<button type="button" className="sm-timeline-add" onClick={add}><Plus size={17}/> Add Section</button>}
    {notice&&<p role="status">{notice}</p>}
  </section>;
}
