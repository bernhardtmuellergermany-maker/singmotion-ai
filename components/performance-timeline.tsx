"use client";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { Plus, Trash2, Clock3, Play, Pause, RotateCcw, GripHorizontal, ChevronDown } from "lucide-react";
import { cameras, cameraHelp } from "../lib/domain";

export type PerformanceSection={id:string;start:number;end:number;camera:string;emotion:string;instructions:string;color?:string};
const cameraModes=["Static","Orbit left","Orbit right","Push-in","Pull-out","Pan left","Pan right"];
const emotions=["Neutral","Emotional","Smile","Happy","Sad","Intense","Calm"];
const palette=["#a43afb","#64748b","#00c6eb","#e89047","#e66ca3"];

const round=(n:number)=>Math.round(n*10)/10;
const MIN=0.5;
export function timelinePrompt(sections:PerformanceSection[]) {
  return sections.slice().sort((a,b)=>a.start-b.start).map(s=>
    `${s.start.toFixed(1)}-${s.end.toFixed(1)}s: Camera ${s.camera}; Expression ${s.emotion}.${s.instructions.trim()?" "+s.instructions.trim():""}`
  ).join("\n");
}
export function findFreeSection(sections:PerformanceSection[],duration:number):{start:number;end:number}|null {
  let cursor=0;
  for(const section of [...sections].sort((a,b)=>a.start-b.start)){
    if(section.start-cursor>=MIN) return {start:round(cursor),end:round(Math.min(section.start,cursor+2))};
    cursor=Math.max(cursor,section.end);
  }
  return duration-cursor>=MIN?{start:round(cursor),end:round(Math.min(duration,cursor+2))}:null;
}
export function validInterval(sections:PerformanceSection[],id:string,start:number,end:number,duration:number) {
  return Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end<=duration+0.00001&&
    end-start>=MIN-0.00001&&sections.every(s=>s.id===id||end<=s.start+0.00001||start>=s.end-0.00001);
}
type Drag={id:string;mode:"move"|"left"|"right";x:number;start:number;end:number;width:number};
export function PerformanceTimeline({duration,sections,onChange,audioUrl,audioStart=0}:{
  duration:number;sections:PerformanceSection[];onChange:(value:PerformanceSection[])=>void;audioUrl?:string;audioStart?:number;
}) {
  const seconds=Math.max(0.5,Math.min(300,duration));
  const [playing,setPlaying]=useState(false);
  const [position,setPosition]=useState(0);
  const player=useRef<HTMLAudioElement>(null);
  const playbackFrame=useRef<number|null>(null);
  const [notice,setNotice]=useState("");
  const [selected,setSelected]=useState<string|null>(null);
  const [dragging,setDragging]=useState<string|null>(null);
  const [dropTarget,setDropTarget]=useState<string|null>(null);
  const [ghost,setGhost]=useState<{id:string;x:number;y:number;kind:"card"|"timeline"}|null>(null);
  const drag=useRef<Drag|null>(null);
  const track=useRef<HTMLDivElement>(null);
  const latest=useRef(sections);latest.current=sections;
  const colors=useRef<Record<string,string>>({});
  for(const item of [...sections].sort((a,b)=>a.start-b.start)){
    if(!colors.current[item.id]){const used=new Set(Object.values(colors.current));colors.current[item.id]=item.color||palette.find(color=>!used.has(color))||palette[Object.keys(colors.current).length%palette.length];}
  }
  const colorFor=(id:string)=>colors.current[id]||palette[0];
  const orderedSections=[...sections].sort((a,b)=>a.start-b.start);
  const update=(id:string,patch:Partial<PerformanceSection>)=>{
    const next=latest.current.map(s=>s.id===id?{...s,...patch}:s);
    latest.current=next;onChange(next);
  };
  function changeTime(id:string,start:number,end:number){
    start=round(start);end=round(end);
    if(!validInterval(latest.current,id,start,end,seconds)){setNotice("Sections cannot overlap or extend beyond the audio selection.");return;}
    setNotice("");update(id,{start,end});
  }
  function add(){
    const free=findFreeSection(latest.current,seconds);
    if(!free){setNotice("No free time section available.");return;}
    const id=crypto.randomUUID();const used=new Set(Object.values(colors.current));const color=palette.find(value=>!used.has(value))||palette[Object.keys(colors.current).length%palette.length];colors.current[id]=color;
    const next={id,...free,camera:"Static",emotion:"Neutral",instructions:"",color};
    latest.current=[...latest.current,next];onChange(latest.current);setSelected(next.id);setNotice("");
  }
  function onDown(e:ReactPointerEvent<HTMLDivElement>,s:PerformanceSection,mode:Drag["mode"]){
    if(e.button!==0||!track.current)return;
    e.preventDefault();e.stopPropagation();setSelected(s.id);setDragging(s.id);
    if(mode==="move")setGhost({id:s.id,x:e.clientX,y:e.clientY,kind:"timeline"});
    drag.current={id:s.id,mode,x:e.clientX,start:s.start,end:s.end,width:track.current.getBoundingClientRect().width};
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onMove(e:ReactPointerEvent<HTMLDivElement>){
    const d=drag.current;if(!d||d.width<=0)return;
    const delta=round((e.clientX-d.x)/d.width*seconds);
    if(d.mode==="move")setGhost({id:d.id,x:e.clientX,y:e.clientY,kind:"timeline"});
    if(d.mode==="move"&&track.current){const bounds=track.current.getBoundingClientRect();const cursor=Math.max(0,Math.min(seconds,(e.clientX-bounds.left)/bounds.width*seconds));const candidate=latest.current.find(item=>item.id!==d.id&&cursor>=item.start&&cursor<=item.end);setDropTarget(candidate?.id??null);}
    if(d.mode==="move")return;
    const sorted=latest.current.filter(s=>s.id!==d.id);
    const prev=Math.max(0,...sorted.filter(s=>s.end<=d.start+0.0001).map(s=>s.end));
    const next=Math.min(seconds,...sorted.filter(s=>s.start>=d.end-0.0001).map(s=>s.start));
    let start=d.start,end=d.end;
    if(d.mode==="move"){const pos=Math.max(prev,Math.min(next-(d.end-d.start),round(d.start+delta)));start=round(pos);end=round(pos+d.end-d.start);}
    else if(d.mode==="left")start=round(Math.max(prev,Math.min(d.end-MIN,d.start+delta)));
    else end=round(Math.min(next,Math.max(d.start+MIN,d.end+delta)));
    if(validInterval(latest.current,d.id,start,end,seconds))update(d.id,{start,end});
  }
  function onCardDown(e:ReactPointerEvent<HTMLButtonElement>,s:PerformanceSection){
    if(e.button!==0||!track.current)return;
    e.preventDefault();
    setSelected(s.id);setDragging(s.id);
    setGhost({id:s.id,x:e.clientX,y:e.clientY,kind:"card"});
    drag.current={id:s.id,mode:"move",x:e.clientX,start:s.start,end:s.end,width:track.current.getBoundingClientRect().width};
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onCardMove(e:ReactPointerEvent<HTMLButtonElement>){
    if(!drag.current)return;
    setGhost({id:drag.current.id,x:e.clientX,y:e.clientY,kind:"card"});
    const beneath=document.elementFromPoint(e.clientX,e.clientY)?.closest("[data-performance-section-id]");
    const target=beneath?.getAttribute("data-performance-section-id")??null;
    setDropTarget(target===drag.current.id?null:target);
    // Keep card and timeline stable while dragging; commit both only on drop.
  }
  function finishMove(clientX:number,clientY:number,fromCard:boolean){
    const current=drag.current;
    drag.current=null;
    setDragging(null);setDropTarget(null);setGhost(null);
    if(!current||current.mode!=="move"||!track.current)return;
    const ordered=[...latest.current].sort((a,b)=>a.start-b.start);
    const moving=ordered.find(item=>item.id===current.id);
    if(!moving)return;
    const before=ordered.findIndex(item=>item.id===current.id);
    const remaining=ordered.filter(item=>item.id!==current.id);
    let destination=before;
    if(fromCard){
      const element=document.elementFromPoint(clientX,clientY);
      const target=element?.closest("[data-performance-section-id]")?.getAttribute("data-performance-section-id");
      const index=remaining.findIndex(item=>item.id===target);
      if(index>=0)destination=index;
      else {
        // Card drags can end outside another card: fall back to horizontal movement.
        const dx=clientX-current.x;
        destination=Math.max(0,Math.min(remaining.length,before+Math.round(dx/180)));
      }
    }else{
      const rect=track.current.getBoundingClientRect();
      const time=Math.max(0,Math.min(seconds,(clientX-rect.left)/rect.width*seconds));
      destination=remaining.filter(item=>(item.start+item.end)/2<time).length;
    }
    if(destination===before)return;
    remaining.splice(destination,0,moving);
    // Preserve each section's duration and instructions; repack chronologically.
    // When the destination gap is too small, adjacent sections move as a group.
    const total=remaining.reduce((sum,item)=>sum+(item.end-item.start),0);
    if(total>seconds+0.00001){setNotice("Not enough audio duration to reorder these sections.");return;}
    let cursor=0;
    const packed=remaining.map(item=>{
      const length=item.end-item.start;
      const next={...item,color:colorFor(item.id),start:round(cursor),end:round(cursor+length)};
      cursor+=length;
      return next;
    });
    latest.current=packed;
    onChange(packed);
    setSelected(current.id);
    setNotice("Sections reordered. Times updated to fit the selected audio.");
  }
  function onKey(e:ReactKeyboardEvent<HTMLDivElement>,s:PerformanceSection,mode:Drag["mode"]){
    if(e.key!=="ArrowLeft"&&e.key!=="ArrowRight")return;
    e.preventDefault();const delta=e.key==="ArrowRight"?0.1:-0.1;
    if(mode==="move")changeTime(s.id,s.start+delta,s.end+delta);
    else if(mode==="left")changeTime(s.id,s.start+delta,s.end);
    else changeTime(s.id,s.start,s.end+delta);
  }
  useEffect(()=>{
    const audio=player.current;
    return ()=>{
      if(playbackFrame.current!==null)cancelAnimationFrame(playbackFrame.current);
      playbackFrame.current=null;
      audio?.pause();
    };
  },[audioUrl,audioStart,seconds]);
  async function togglePlayback(){
    const audio=player.current;if(!audio)return;
    if(!audio.paused){audio.pause();setPlaying(false);if(playbackFrame.current!==null)cancelAnimationFrame(playbackFrame.current);return;}
    if(position>=seconds-0.015||audio.currentTime<audioStart||audio.currentTime>=audioStart+seconds)audio.currentTime=audioStart;
    try{
      await audio.play();setPlaying(true);
      const tick=()=>{
        const at=Math.max(0,Math.min(seconds,audio.currentTime-audioStart));
        setPosition(at);
        if(at>=seconds-0.015){audio.pause();setPlaying(false);playbackFrame.current=null;return;}
        if(!audio.paused)playbackFrame.current=requestAnimationFrame(tick);
      };
      playbackFrame.current=requestAnimationFrame(tick);
    }catch{setNotice("Audio playback is unavailable.");}
  }
  async function replay(){
    const audio=player.current;if(!audio)return;
    if(playbackFrame.current!==null)cancelAnimationFrame(playbackFrame.current);
    playbackFrame.current=null;
    audio.pause();
    audio.currentTime=audioStart;
    setPosition(0);
    try{
      await audio.play();setPlaying(true);
      const tick=()=>{
        const at=Math.max(0,Math.min(seconds,audio.currentTime-audioStart));
        setPosition(at);
        if(at>=seconds-0.015){audio.pause();setPlaying(false);playbackFrame.current=null;return;}
        if(!audio.paused)playbackFrame.current=requestAnimationFrame(tick);
      };
      playbackFrame.current=requestAnimationFrame(tick);
    }catch{setPlaying(false);setNotice("Audio playback is unavailable.");}
  }
  const ticks=Array.from({length:Math.min(Math.ceil(seconds),15)+1},(_,i)=>round(i*seconds/Math.min(Math.ceil(seconds),15)));
  return <section className="sm-timeline" aria-label="Performance Timeline">
    <div className="sm-timeline-heading"><Clock3 size={29}/><div><h2>Performance Timeline <span>Optional</span></h2><p>Define camera movements, emotions, actions and instructions for each time section.</p></div><div className="sm-timeline-playback">{audioUrl&&<><audio ref={player} src={audioUrl} preload="metadata"/><button type="button" aria-label={playing?"Pause selected audio":"Play selected audio"} onClick={()=>void togglePlayback()}>{playing?<Pause size={17}/>:<Play size={17}/>}</button><button type="button" aria-label="Replay selected audio from start" title="Replay from start" onClick={()=>void replay()}><RotateCcw size={17}/></button></>}<strong>Duration: {seconds.toFixed(2)} seconds</strong></div></div>
    <div className="sm-timeline-ruler">{ticks.map((t,i)=><span key={i}>{t}s</span>)}</div>
    <div className="sm-timeline-track" ref={track} aria-label="Editable timeline">
      {orderedSections.map((s,i)=><div key={s.id} className={"sm-timeline-segment"+(selected===s.id?" is-selected":"")+(dragging===s.id?" is-dragging":"")+(dropTarget===s.id?" is-drop-target":"")} style={{left:`${100*s.start/seconds}%`,width:`${100*(s.end-s.start)/seconds}%`,background:colorFor(s.id)}} title={`${s.start.toFixed(1)}–${s.end.toFixed(1)}s`}>
        <div className="sm-timeline-handle" role="slider" tabIndex={0} aria-label={`Resize start of section ${i+1}`} aria-valuemin={0} aria-valuemax={s.end-MIN} aria-valuenow={s.start} onPointerDown={e=>onDown(e,s,"left")} onPointerMove={onMove} onPointerUp={()=>{drag.current=null;setDragging(null);setDropTarget(null);}} onPointerCancel={()=>{drag.current=null;setDragging(null);setDropTarget(null);}} onKeyDown={e=>onKey(e,s,"left")}/>
        <div className="sm-timeline-segment-body" role="slider" tabIndex={0} aria-label={`Move section ${i+1}`} aria-valuemin={0} aria-valuemax={seconds-(s.end-s.start)} aria-valuenow={s.start} onPointerDown={e=>onDown(e,s,"move")} onPointerMove={onMove} onPointerUp={e=>finishMove(e.clientX,e.clientY,false)} onPointerCancel={()=>{drag.current=null;setDragging(null);setDropTarget(null);setGhost(null);}} onKeyDown={e=>onKey(e,s,"move")}><span>{s.camera}{s.emotion!=="Neutral"?" + "+s.emotion:""} · {s.start.toFixed(1)}–{s.end.toFixed(1)}s</span></div>
        <div className="sm-timeline-handle" role="slider" tabIndex={0} aria-label={`Resize end of section ${i+1}`} aria-valuemin={s.start+MIN} aria-valuemax={seconds} aria-valuenow={s.end} onPointerDown={e=>onDown(e,s,"right")} onPointerMove={onMove} onPointerUp={()=>drag.current=null} onPointerCancel={()=>drag.current=null} onKeyDown={e=>onKey(e,s,"right")}/>
      </div>)}
      {audioUrl&&<div className="sm-timeline-playhead" aria-hidden="true" style={{left:`${100*position/seconds}%`}}/>}
    </div>
    {!sections.length?<div className="sm-timeline-empty"><Plus size={32}/><strong>No sections yet</strong><p>Add a section to direct the performance, or continue without one.</p><button type="button" onClick={add}><Plus size={17}/> Add Section</button></div>:
    <div className="sm-timeline-cards">{orderedSections.map((s,i)=><article key={s.id} data-performance-section-id={s.id} className={(selected===s.id?"is-selected ":"")+(dragging===s.id?"is-dragging ":"")+(dropTarget===s.id?"is-drop-target":"")} style={{borderColor:colorFor(s.id)}} onClick={()=>setSelected(s.id)}>
      <header className="sm-timeline-card-header"><button type="button" className="sm-timeline-card-grip" title="Drag to move section in timeline" aria-label={`Drag section ${i+1} to reorder it`} onPointerDown={e=>onCardDown(e,s)} onPointerMove={onCardMove} onPointerUp={e=>finishMove(e.clientX,e.clientY,true)} onPointerCancel={()=>drag.current=null}><GripHorizontal size={14}/></button><span className="sm-timeline-dot" style={{background:colorFor(s.id)}}/><strong>{s.start.toFixed(1)}–{s.end.toFixed(1)}s</strong><label>Start<input aria-label={`Section ${i+1} start`} type="number" min={0} max={s.end-MIN} step="0.1" value={s.start} onChange={e=>changeTime(s.id,Number(e.target.value),s.end)}/></label><label>End<input aria-label={`Section ${i+1} end`} type="number" min={s.start+MIN} max={seconds} step="0.1" value={s.end} onChange={e=>changeTime(s.id,s.start,Number(e.target.value))}/></label><button type="button" aria-label="Remove section" onClick={()=>{const next=latest.current.filter(x=>x.id!==s.id);latest.current=next;onChange(next);}}><Trash2 size={16}/></button></header>
      <div className="sm-timeline-add-camera"><details className="flow-camera-menu"><summary aria-label="Add camera movement"><Plus size={15}/><span>Add camera</span><ChevronDown size={14}/></summary><div className="flow-camera-options" role="group" aria-label="Camera movements">{cameras.map(option=><button key={option} type="button" onClick={e=>{const field=e.currentTarget.closest("article")?.querySelector<HTMLTextAreaElement>("textarea");const pos=field?.selectionStart??s.instructions.length;const insert=`Camera movement: ${option}.`;const before=s.instructions.slice(0,pos),after=s.instructions.slice(pos);const next=(before+(before&&!before.endsWith("\n")?"\n":"")+insert+(after&&!after.startsWith("\n")?"\n":"")+after);if(next.length>500){setNotice("Section instructions cannot exceed 500 characters.");return;}update(s.id,{camera:option,instructions:next});e.currentTarget.closest("details")!.open=false;}} title={cameraHelp[option]}><strong>{option}</strong><small>{cameraHelp[option]}</small></button>)}</div></details></div>
      <label>Emotion / Expression<select value={s.emotion} onChange={e=>update(s.id,{emotion:e.target.value})}>{emotions.map(x=><option key={x}>{x}</option>)}</select></label>
      <label>Custom Instructions<textarea maxLength={500} rows={2} value={s.instructions} placeholder="Describe what the singer or speaker should do..." onChange={e=>update(s.id,{instructions:e.target.value})}/><small className="sm-timeline-counter">{s.instructions.length}/500</small></label>
    </article>)}</div>}
    {!!sections.length&&<button type="button" className="sm-timeline-add" onClick={add}><Plus size={17}/> Add Section</button>}
    {ghost&&(()=>{const item=latest.current.find(section=>section.id===ghost.id);return item?<div className={"sm-section-drag-ghost sm-section-drag-ghost-"+ghost.kind} style={{left:ghost.x,top:ghost.y,borderColor:colorFor(item.id),backgroundColor:"#15213a"}} aria-hidden="true"><span className="sm-timeline-dot" style={{background:colorFor(item.id)}}/><GripHorizontal size={16}/><strong>{item.start.toFixed(1)}–{item.end.toFixed(1)}s</strong><span>{item.camera}</span></div>:null;})()}
    {notice&&<p role="status" className="sm-timeline-notice">{notice}</p>}
  </section>;
}
