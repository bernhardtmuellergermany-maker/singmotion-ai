"use client";
import {useEffect,useState} from "react";
import {CalendarDays,Check,Clock3,Copy,Hash,Pencil,Save,Timer,WandSparkles,X} from "lucide-react";
import {api} from "@/lib/client";
import type {StudioProject} from "@/lib/live/studio";
import {aiGenerationElapsed,projectCreatedLabel,sourceTimeLabel,videoTimecode} from "@/lib/video-project-metadata";

export type CompletedVideoMetadata={
 id:string;
 idLabel?:"Project ID"|"Order ID";
 name?:string|null;
 createdAt?:number|null;
 selectedDurationSeconds?:number|null;
 sourceStartSeconds?:number|null;
 sourceEndSeconds?:number|null;
 prompt?:string|null;
 generationStartedAt?:number|null;
 generationFinishedAt?:number|null;
 /** Only private Studio projects have the authenticated rename endpoint. */
 renameId?:string|null;
 renameOrderId?:string|null;
};
export function CompletedVideoDetails({data,measuredDurationSeconds}:{
 data:CompletedVideoMetadata;measuredDurationSeconds?:number|null;
}){
 const [name,setName]=useState(data.name?.trim()||"Untitled video");
 const [editedName,setEditedName]=useState("");
 const [editing,setEditing]=useState(false),[saving,setSaving]=useState(false);
 const [error,setError]=useState("");
 const [copied,setCopied]=useState<"prompt"|"id"|null>(null);
 useEffect(()=>{if(!editing&&!saving)setName(data.name?.trim()||"Untitled video")},[data.name,editing,saving]);
 const canRename=(!!data.renameId&&/^[a-f0-9-]{36}$/i.test(data.renameId))||
  (!!data.renameOrderId&&/^[a-f0-9-]{36}$/i.test(data.renameOrderId));
 const created=projectCreatedLabel(data.createdAt);
 const duration=videoTimecode(measuredDurationSeconds??data.selectedDurationSeconds);
 const source=sourceTimeLabel(data.sourceStartSeconds,data.sourceEndSeconds);
 const elapsed=aiGenerationElapsed(data.generationStartedAt,data.generationFinishedAt);
 const prompt=data.prompt?.trim()||"";
 async function copy(value:string,which:"prompt"|"id"){
  try{await navigator.clipboard.writeText(value);setCopied(which)}
  catch{setError("Copy unavailable. Select the text to copy it manually.")}
 }
 async function saveName(e:import("react").FormEvent<HTMLFormElement>){
  e.preventDefault();
  if(!canRename||saving)return;
  const next=editedName.trim();
  if(!next||next.length>80||/[\x00-\x1f\x7f]/.test(next)){
   setError("Enter a project name of up to 80 characters.");return;
  }
  setSaving(true);setError("");
  try{
   let updated=next;
   if(data.renameOrderId){
    const response=await fetch("/api/customer-orders",{
     method:"PATCH",credentials:"same-origin",
     headers:{"Content-Type":"application/json"},
     body:JSON.stringify({orderId:data.renameOrderId,name:next}),
    });
    const result=await response.json() as {error?:string;displayName?:string};
    if(!response.ok)throw Error(result.error||"Project name could not be updated.");
    updated=result.displayName||next;
   }else{
    const result=await api<StudioProject>("studio-live",{
     method:"POST",body:JSON.stringify({action:"rename",id:data.renameId,name:next}),
    });
    updated=result.projectName||next;
   }
   setName(updated);
   setEditing(false);
   window.dispatchEvent(new CustomEvent("sm-project-name-updated",{
    detail:{id:data.renameOrderId?"paid_"+data.renameOrderId:"live_"+data.renameId,name:updated},
   }));
  }catch(cause){setError(cause instanceof Error?cause.message:"The project name could not be saved.");}
  finally{setSaving(false)}
 }
 const show=(label:string,value:string|null,icon:React.ReactNode,detail?:string)=>
  <div className="sm-finished-field">
   <span className="sm-finished-field-icon" aria-hidden="true">{icon}</span>
   <div><span className="sm-finished-label">{label}</span>
    <strong>{value||"Not recorded"}</strong>{detail&&<small>{detail}</small>}
   </div>
  </div>;
 return <section className="sm-finished" aria-label="Completed video details">
  <div className="sm-finished-heading">
   <div><span className="sm-finished-eyebrow">YOUR FINISHED VIDEO</span><h2>Video details</h2></div>
   <span className="sm-finished-ready"><Check size={14}/> Ready</span>
  </div>
  <div className="sm-finished-name">
   <span className="sm-finished-label">Project name</span>
   {editing?<form onSubmit={e=>void saveName(e)} className="sm-finished-rename">
    <input autoFocus aria-label="Edit project name" maxLength={80} value={editedName}
     onChange={e=>setEditedName(e.target.value)} disabled={saving}/>
    <button type="submit" aria-label="Save project name" disabled={saving}><Save size={17}/></button>
    <button type="button" aria-label="Cancel rename" disabled={saving}
     onClick={()=>{setEditing(false);setError("")}}><X size={17}/></button>
   </form>:
   <div className="sm-finished-name-display"><strong>{name}</strong>
    {canRename&&<button type="button" aria-label="Rename project" title="Edit project name"
     onClick={()=>{setEditing(true);setEditedName(name);setError("")}}><Pencil size={16}/></button>}
   </div>}
   {error&&<p role="alert" className="sm-finished-error">{error}</p>}
  </div>
  <div className="sm-finished-fields">
   {show("Created",created,<CalendarDays size={18}/>)}
   {show(measuredDurationSeconds!==null&&measuredDurationSeconds!==undefined?"Video duration":"Selected duration",
     duration,<Clock3 size={18}/>)}
   {show("Source time",source,<WandSparkles size={18}/>,"Selected section of your original song")}
   {show("Time for AI video generation",elapsed,<Timer size={18}/>,
      "From generation submission to verified output")}
  </div>
  <div className="sm-finished-identifier">
   <span><Hash size={15}/> {data.idLabel||"Project ID"}</span>
   <div><code title={data.id}>{data.id}</code>
    <button type="button" title="Copy project ID" aria-label="Copy project ID"
      onClick={()=>void copy(data.id,"id")}>{copied==="id"?<Check size={15}/>:<Copy size={15}/>}
      <span>{copied==="id"?"Copied":"Copy"}</span></button>
   </div>
  </div>
  <details className="sm-finished-prompt">
   <summary><span><WandSparkles size={16}/> AI performance prompt</span><span>Show prompt</span></summary>
   <div className="sm-finished-prompt-body">
    <p>{prompt||"No prompt was recorded for this generation."}</p>
    <button type="button" onClick={()=>void copy(prompt,"prompt")} disabled={!prompt}>
     {copied==="prompt"?<Check size={16}/>:<Copy size={16}/>}
     {copied==="prompt"?"Copied":"Copy prompt"}
    </button>
   </div>
  </details>
 </section>;
}
