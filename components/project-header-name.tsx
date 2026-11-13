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
 const saving=useRef(false);
 useEffect(()=>{const dismiss=(e:PointerEvent)=>{if(menu.current&&!menu.current.contains(e.target as Node))menu.current.open=false};const escape=(e:KeyboardEvent)=>{if(e.key==="Escape"&&menu.current)menu.current.open=false};document.addEventListener("pointerdown",dismiss);document.addEventListener("keydown",escape);return()=>{document.removeEventListener("pointerdown",dismiss);document.removeEventListener("keydown",escape)}},[]);
 useEffect(()=>{
  if(!id.startsWith("live_"))return;
  let active=true;const key=id.slice(5);
  void ensureSession().then(()=>api<StudioProject>("studio-live?id="+encodeURIComponent(key),{cache:"no-store"}))
   .then(async p=>{
    if(!active)return;
    let current=p;
    // Migrate the desktop-only title once; never overwrite a newer server
    // rename that may already have been made on another device.
    let oldLabel="";
    try{
     const labels=JSON.parse(localStorage.getItem("sm-gallery-labels")||"{}") as Record<string,string>;
     oldLabel=localStorage.getItem("sm-live-project-name:"+key)||labels[id]||"";
    }catch{}
    if(!p.displayName&&oldLabel.trim()&&oldLabel.trim().length<=80){
     try{
      current=await api<StudioProject>("studio-live",{method:"POST",
       body:JSON.stringify({action:"rename",id:key,name:oldLabel.trim()})});
      localStorage.removeItem("sm-live-project-name:"+key);
      const labels=JSON.parse(localStorage.getItem("sm-gallery-labels")||"{}") as Record<string,string>;
      delete labels[id];localStorage.setItem("sm-gallery-labels",JSON.stringify(labels));
     }catch{if(active)setError("Your old desktop project name could not sync. Please save it again.");}
    }
    if(active){setName(current.projectName||current.artistName||"Untitled Project");setProjectState(current.state)}
   }).catch(()=>{if(active)setError("Could not load the saved project name.");});
  return()=>{active=false};
 },[id]);
 // Mobile Safari may restore an old project header from its back/forward
 // cache. Always re-read the server title when the page becomes visible;
 // never overwrite a name while the user is editing or saving it.
 useEffect(()=>{
  if(!id.startsWith("live_")||edit||busy)return;
  let active=true,inFlight=false;
  const reload=async()=>{
   if(!active||inFlight||document.hidden||saving.current)return;
   inFlight=true;
   try{
    await ensureSession();
    const project=await api<StudioProject>("studio-live?id="+encodeURIComponent(id.slice(5)),{cache:"no-store"});
    if(active&&!saving.current){
     setName(project.projectName||project.artistName||"Untitled Project");
     setProjectState(project.state);
     setError("");
    }
   }catch{
    if(active)setError("Project name could not sync. Check that this device is signed into the same account, then reopen the project.");
   }finally{inFlight=false;}
  };
  const onFocus=()=>{void reload();};
  const onVisibility=()=>{if(!document.hidden)void reload();};
  window.addEventListener("focus",onFocus);
  window.addEventListener("pageshow",onFocus);
  window.addEventListener("sm-project-name-updated",onFocus);
  document.addEventListener("visibilitychange",onVisibility);
  return()=>{
   active=false;
   window.removeEventListener("focus",onFocus);
   window.removeEventListener("pageshow",onFocus);
   window.removeEventListener("sm-project-name-updated",onFocus);
   document.removeEventListener("visibilitychange",onVisibility);
  };
 },[id,edit,busy]);
 if(!id.startsWith("live_"))return null;
 const startEdit=()=>{cancelEdit.current=false;setDraft(name);setEdit(true);setError("")};
 const save=async()=>{
  if(cancelEdit.current){cancelEdit.current=false;setEdit(false);return;}
  if(saving.current)return;
  const value=draft.trim();
  if(!value||value.length>80){setError("Enter a project name of up to 80 characters.");return;}
  saving.current=true;setBusy(true);setError("");
  try{
   const updated=await api<StudioProject>("studio-live",{method:"POST",
     body:JSON.stringify({action:"rename",id:id.slice(5),name:value})});
   setName(updated.projectName);
   try{
    localStorage.removeItem("sm-live-project-name:"+id.slice(5));
    const previous=JSON.parse(localStorage.getItem("sm-gallery-labels")||"{}") as Record<string,string>;
    delete previous[id];
    localStorage.setItem("sm-gallery-labels",JSON.stringify(previous));
   }catch{}
   window.dispatchEvent(new CustomEvent("sm-project-name-updated",{detail:{id,name:value}}));
   setEdit(false);
  }catch(cause){setError(cause instanceof Error?cause.message:"Could not save project name.")}
  finally{saving.current=false;setBusy(false)}
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
  {edit?<input className="flow-project-input" aria-label="Project name" autoFocus maxLength={80} value={draft} onChange={e=>setDraft(e.target.value)} onBlur={()=>void save()} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();void save();}if(e.key==="Escape"){cancelEdit.current=true;setEdit(false)}}}/>:<>
   <button type="button" className="flow-project-name" title="Click to rename project" onClick={startEdit}>{name||"Project"}</button>
   <details ref={menu} className="flow-menu"><summary aria-label="Project options"><MoreVertical size={19}/></summary>
    <div className="flow-popover"><button type="button" onClick={e=>{e.currentTarget.closest("details")!.open=false;startEdit()}}>Rename project</button><button type="button" disabled={busy} onClick={()=>void remove()}>{busy?"Removing…":projectState===null||!["prepared","completed","failed"].includes(projectState)?"Remove from My Videos":"Delete project"}</button></div>
   </details>
  </>}
  {error&&<span role="alert" className="sm-header-project-error">{error}</span>}
 </div>;
}
