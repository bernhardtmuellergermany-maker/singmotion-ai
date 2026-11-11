"use client";
import {useEffect,useState} from "react";
import {api,ensureSession} from "@/lib/client";
import type {StudioProject} from "@/lib/live/studio";
import {GenerationStatusView,type GenerationProgress} from "./generation-status-view";

export function SuperAdminGeneration({id}:{id:string}){
 const [project,setProject]=useState<StudioProject|null>(null);
 const [error,setError]=useState("");
 const [checking,setChecking]=useState(false);
 useEffect(()=>{
   let live=true;
   let timer:ReturnType<typeof setTimeout>;
   async function refresh(){
     if(document.visibilityState!=="hidden"){
       try{
         await ensureSession();
         const result=await api<StudioProject>(`studio-live?id=${encodeURIComponent(id)}`);
         if(live){setProject(result);setError("");}
       }catch(e){
         if(live)setError(e instanceof Error?e.message:"Unable to refresh project.");
       }
     }
     if(live)timer=setTimeout(refresh,5000);
   }
   void refresh();
   return()=>{live=false;clearTimeout(timer)};
 },[id]);
 async function checkStatus(){
   if(checking||!project||!["submitted","processing"].includes(project.state))return;
   setChecking(true);setError("");
   try{
     const updated=await api<StudioProject>("studio-live",{
       method:"POST",
       body:JSON.stringify({action:"poll",id})
     });
     setProject(updated);
   }catch(e){setError(e instanceof Error?e.message:"Status refresh unavailable.");}
   finally{setChecking(false);}
 }
 let progress:GenerationProgress="unavailable";
 if(project){
   progress=project.outputReady?"ready":project.state==="failed"?"failed":
     project.state==="processing"?"processing":
     project.state==="submitted"?"queued":
     project.state==="prepared"?"prepared":"unavailable";
 }
 const link=`/api/studio-live?id=${encodeURIComponent(id)}&video=1`;
 return <main id="content" className="sm-super-admin-generation">
   <GenerationStatusView progress={progress} paymentMode="super-admin"
     providerSeconds={project?.durationSeconds??null}
     photoUrl={project?.imageId?`/api/assets/${encodeURIComponent(project.imageId)}`:null}
     format={project?.selection.outputFormat}
     videoUrl={project?.outputReady?link:null}
     downloadUrl={project?.outputReady?link+"&download=1":null}
     note={error||(project?.state==="failed"?project.stage:"")}/>
   {project&&!project.outputReady&&["submitted","processing"].includes(project.state)&&
     <div className="sm-gen-extra-controls"><button type="button" disabled={checking} onClick={()=>void checkStatus()}>{checking?"Checking…":"Check provider status"}</button></div>}
   {project?.state==="prepared"&&<p className="sm-gen-extra-message">This project is prepared, but its BytePlus submission has not been confirmed. Return to the authorized Studio review to submit; this status page cannot start another task.</p>}
 </main>;
}
