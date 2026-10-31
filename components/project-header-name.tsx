"use client";
import { useEffect, useState } from "react";
import { MoreVertical } from "lucide-react";
import { useRouter } from "next/navigation";
import { api, ensureSession } from "@/lib/client";
import type { StudioProject } from "@/lib/live/studio";

export function ProjectHeaderName({id}:{id:string}){
 const router=useRouter();
 const [name,setName]=useState("");
 const [edit,setEdit]=useState(false);
 const [draft,setDraft]=useState("");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 useEffect(()=>{
  if(!id.startsWith("live_"))return;
  let active=true;const key=id.slice(5);
  try{const local=localStorage.getItem("sm-live-project-name:"+key);if(local)setName(local);}catch{}
  void ensureSession().then(()=>api<StudioProject>("studio-live?id="+encodeURIComponent(key)))
   .then(p=>{if(active)setName(old=>old||p.projectName||p.artistName||"Untitled Project")}).catch(()=>{});
  return()=>{active=false};
 },[id]);
 if(!id.startsWith("live_"))return null;
 const startEdit=()=>{setDraft(name);setEdit(true);setError("")};
 const save=()=>{
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
  if(busy||!window.confirm("Permanently delete this generated project and its video? This cannot be undone. Active provider tasks cannot be deleted."))return;
  setBusy(true);setError("");
  try{
   await api("studio-live",{method:"POST",body:JSON.stringify({action:"delete",id:id.slice(5),confirmation:"DELETE "+id.slice(5)})});
   try{localStorage.removeItem("sm-live-project-name:"+id.slice(5));const old=JSON.parse(localStorage.getItem("sm-gallery-labels")||"{}");delete old[id];localStorage.setItem("sm-gallery-labels",JSON.stringify(old))}catch{}
   router.push("/?card=home");router.refresh();
  }catch(e){setError((e as Error).message);setBusy(false)}
 };
 return <div className="sm-header-project-name sm-output-project-name">
  {edit?<input className="flow-project-input" aria-label="Project name" autoFocus maxLength={80} value={draft} onChange={e=>setDraft(e.target.value)} onBlur={save} onKeyDown={e=>{if(e.key==="Enter")save();if(e.key==="Escape")setEdit(false)}}/>:<>
   <button type="button" className="flow-project-name" title="Click to rename project" onClick={startEdit}>{name||"Project"}</button>
   <details className="flow-menu"><summary aria-label="Project options"><MoreVertical size={19}/></summary>
    <div className="flow-popover"><button type="button" onClick={e=>{e.currentTarget.closest("details")!.open=false;startEdit()}}>Rename project</button><button type="button" disabled={busy} onClick={()=>void remove()}>{busy?"Deleting…":"Delete project"}</button></div>
   </details>
  </>}
  {error&&<span role="alert" className="sm-header-project-error">{error}</span>}
 </div>;
}
