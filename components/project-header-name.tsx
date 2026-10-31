"use client";
import { useEffect, useState } from "react";
import { MoreVertical } from "lucide-react";
import { api, ensureSession } from "@/lib/client";
import type { StudioProject } from "@/lib/live/studio";
export function ProjectHeaderName({id}:{id:string}){
 const [name,setName]=useState("");
 const [edit,setEdit]=useState(false);
 const [draft,setDraft]=useState("");
 useEffect(()=>{if(!id.startsWith("live_"))return;let active=true;const key=id.slice(5);
  try{const local=localStorage.getItem("sm-live-project-name:"+key);if(local)setName(local);}catch{}
  void ensureSession().then(()=>api<StudioProject>("studio-live?id="+encodeURIComponent(key))).then(p=>{if(!active)return;setName(old=>old||p.projectName||p.artistName||"Untitled project");}).catch(()=>{});
  return()=>{active=false};
 },[id]);
 if(!id.startsWith("live_"))return null;
 const save=()=>{const value=draft.trim().slice(0,80);if(value){setName(value);try{
   localStorage.setItem("sm-live-project-name:"+id.slice(5),value);
   const previous=JSON.parse(localStorage.getItem("sm-gallery-labels")||"{}") as Record<string,string>;
   localStorage.setItem("sm-gallery-labels",JSON.stringify({...previous,[id]:value}));
   window.dispatchEvent(new CustomEvent("sm-project-name-updated",{detail:{id,name:value}}));
 }catch{}}setEdit(false);};
 return <div className="sm-header-project-name">
  {edit?<form onSubmit={e=>{e.preventDefault();save()}}><input aria-label="Project name" autoFocus maxLength={80} value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Escape")setEdit(false)}}/><button type="submit">Save</button></form>:<>
   <span title={name}>{name||"Project"}</span>
   <button type="button" title="Rename project" aria-label="Rename project" onClick={()=>{setDraft(name);setEdit(true)}}><MoreVertical size={19}/></button>
  </>}
 </div>;
}
