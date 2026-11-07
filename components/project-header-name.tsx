"use client";
import { useEffect, useRef, useState } from "react";
import { MoreVertical } from "lucide-react";
import { useRouter } from "next/navigation";
import { api, ensureSession } from "@/lib/client";
import type { StudioProject } from "@/lib/live/studio";

export function ProjectHeaderName({id}:{id:string}){
 const router=useRouter();
 const [name,setName]=useState("");
 const [projectState,setProjectState]=useState<StudioProject["state"]|null>(null);
 const [edit,setEdit]=useState(false);
 const [draft,setDraft]=useState("");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const menu=useRef<HTMLDetailsElement>(null);
 const cancelEdit=useRef(false);
 useEffect(()=>{const dismiss=(e:PointerEvent)=>{if(menu.current&&!menu.current.contains(e.target as Node))menu.current.open=false};const escape=(e:KeyboardEvent)=>{if(e.key==="Escape"&&menu.current)menu.current.open=false};document.addEventListener("pointerdown",dismiss);document.addEventListener("keydown",escape);return()=>{document.removeEventListener("pointerdown",dismiss);document.removeEventListener("keydown",escape)}},[]);
 useEffect(()=>{
  if(!id.startsWith("live_"))return;
  let active=true;const key=id.slice(5);
  try{const local=localStorage.getItem("sm-live-project-name:"+key);if(local)void Promise.resolve().then(()=>{if(active)setName(local)});}catch{}
  void ensureSession().then(()=>api<StudioProject>("studio-live?id="+encodeURIComponent(key)))
   .then(p=>{if(active){setName(old=>old||p.projectName||p.artistName||"Untitled Project");setProjectState(p.state)}}).catch(()=>{});
  return()=>{active=false};
 },[id]);
 if(!id.startsWith("live_"))return null;
 const startEdit=()=>{cancelEdit.current=false;setDraft(name);setEdit(true);setError("")};
 const save=()=>{
  if(cancelEdit.current){cancelEdit.current=false;setEdit(false);return;}
  const value=draft.trim().slice(0,80);
  if(value){setName(value);try{
    localStorage.setItem("sm-live-project-name:"+id.slice(5),value);
    const previous=JSON.parse(localStorage.getItem("sm-gallery-labels")||"{}") as Record<string,string>;
    localStorage.setItem("sm-gallery-labels",JSON.stringify({...previous,[id]:value}));
    window.dispatchEvent(new CustomEvent("sm-project-name-updated",{detail:{id,name:value}}));
  }catch{}}
  setEdit(false);
 };
 const remove=async()=>{
  const active=projectState===null||!["prepared","completed","failed"].includes(projectState);
  const message=active
   ? "Remove this project from My Videos? The original provider task, billing record and recovery evidence will be retained. No new generation will be started."
   : "Permanently remove this generated project and any finished video? This cannot be undone. Billing and provider audit records will be retained.";
  if(busy||!window.confirm(message))return;
  setBusy(true);setError("");
  try{
   const key=id.slice(5);
   await api("studio-live",{method:"POST",body:JSON.stringify(active
     ? {action:"hide",id:key,confirmation:"HIDE "+key}
     : {action:"delete",id:key,confirmation:"DELETE "+key})});
   try{localStorage.removeItem("sm-live-project-name:"+id.slice(5));const old=JSON.parse(localStorage.getItem("sm-gallery-labels")||"{}");delete old[id];localStorage.setItem("sm-gallery-labels",JSON.stringify(old))}catch{}
   router.push("/?card=home");router.refresh();
  }catch(e){setError((e as Error).message);setBusy(false)}
 };
 return <div className="sm-header-project-name sm-output-project-name">
  {edit?<input className="flow-project-input" aria-label="Project name" autoFocus maxLength={80} value={draft} onChange={e=>setDraft(e.target.value)} onBlur={save} onKeyDown={e=>{if(e.key==="Enter")save();if(e.key==="Escape"){cancelEdit.current=true;setEdit(false)}}}/>:<>
   <button type="button" className="flow-project-name" title="Click to rename project" onClick={startEdit}>{name||"Project"}</button>
   <details ref={menu} className="flow-menu"><summary aria-label="Project options"><MoreVertical size={19}/></summary>
    <div className="flow-popover"><button type="button" onClick={e=>{e.currentTarget.closest("details")!.open=false;startEdit()}}>Rename project</button><button type="button" disabled={busy} onClick={()=>void remove()}>{busy?"Removing…":projectState===null||!["prepared","completed","failed"].includes(projectState)?"Remove from My Videos":"Delete project"}</button></div>
   </details>
  </>}
  {error&&<span role="alert" className="sm-header-project-error">{error}</span>}
 </div>;
}
