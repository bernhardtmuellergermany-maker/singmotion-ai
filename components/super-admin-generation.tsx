"use client";
import {useEffect,useState} from "react";
import {api,ensureSession,resetSession} from "@/lib/client";
import type {StudioProject} from "@/lib/live/studio";
import {GenerationStatusView,type GenerationProgress} from "./generation-status-view";

export function SuperAdminGeneration({id}:{id:string}){
 const [project,setProject]=useState<StudioProject|null>(null);
 const [error,setError]=useState("");
 useEffect(()=>{
   // Reconcile a stale customer/guest session with the CMS staff identity.
   resetSession();
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
 // The polling endpoint persists fixed-format provider read diagnostics while
 // preserving the original paid task. Never display a generic "Generating"
 // animation when the most recent status check actually failed.
 const pollDiagnostic=project?.stage?.match(/^\[([A-Z][A-Z0-9_]{2,79})\]/)?.[1];
 let progress:GenerationProgress="unavailable";
 if(project){
   progress=project.outputReady?"ready":project.state==="failed"?"failed":
     pollDiagnostic?"review":
     project.state==="uncertain"||project.state==="output_observed"?"review":
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
     reuseHref={project?.outputReady?`/studio?copy=live_${encodeURIComponent(id)}`:null}
     note={error||(!project?.outputReady&&project?.stage?project.stage:"")}/>

   {project?.state==="prepared"&&<p className="sm-gen-extra-message">This project is prepared, but its generation request has not been confirmed. Return to the authorized Studio review to submit; this status page cannot start another task.</p>}
 </main>;
}
