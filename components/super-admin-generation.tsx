"use client";
import {useEffect,useState} from "react";
import {api,ensureSession,resetSession} from "@/lib/client";
import type {StudioProject} from "@/lib/live/studio";
import {GenerationStatusView,type GenerationProgress} from "./generation-status-view";

export function SuperAdminGeneration({id}:{id:string}){
 const [project,setProject]=useState<StudioProject|null>(null);
 const [error,setError]=useState("");
 const [availableCredits,setAvailableCredits]=useState<number|null>(null);
 useEffect(()=>{
   // Reconcile a stale customer/guest session with the CMS staff identity.
   resetSession();
   let live=true;
   let timer:ReturnType<typeof setTimeout>;
   let statusReads=0;
   async function refresh(){
     if(document.visibilityState!=="hidden"){
       try{
         await ensureSession();
         let result=await api<StudioProject>(`studio-live?id=${encodeURIComponent(id)}`);
         if(live){setProject(result);setError("");}
         if(["submitted","processing"].includes(result.state)&&++statusReads>=6){
           statusReads=0;
           if(navigator.onLine){
             try{
               result=await api<StudioProject>("studio-live",{
                 method:"POST",body:JSON.stringify({action:"poll",id}),
               });
               if(live){setProject(result);setError("");}
             }catch{
               // Only retry the same read later; never submit a second paid job.
             }
           }
         }
         if(!["submitted","processing"].includes(result.state))statusReads=0;
         // Balance is read only from the authenticated wallet API. If it is
         // unavailable, retain the truthful prepared state rather than guessing.
         if(result.state==="prepared"&&result.creditCharge?.status==="estimated"){
           try{
             const response=await fetch("/api/credit-balance",{cache:"no-store",credentials:"same-origin"});
             const body=await response.json() as {availableCredits?:number};
             if(live)setAvailableCredits(response.ok&&typeof body.availableCredits==="number"&&Number.isSafeInteger(body.availableCredits)&&body.availableCredits>=0?body.availableCredits:null);
           }catch{if(live)setAvailableCredits(null)}
         }else if(live)setAvailableCredits(null);
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
 const shortage=!!project&&project.state==="prepared"&&project.creditCharge?.status==="estimated"&&
   typeof availableCredits==="number"&&availableCredits<project.creditCharge.credits;
 if(shortage)progress="credits-needed";
 const resumeDraft=project?.sourceDraftId&&/^[A-Za-z0-9_-]{1,80}$/.test(project.sourceDraftId)
   ?project.sourceDraftId:null;
 const resumeHref=resumeDraft?"/studio?draft="+encodeURIComponent(resumeDraft)+"&resume=review":null;
 const creditsHref=resumeDraft&&project?.creditCharge?.credits
   ?"/credits?resumeDraft="+encodeURIComponent(resumeDraft)+"&requiredCredits="+project.creditCharge.credits+"#buy-credits":"/credits#buy-credits";
 const link=`/api/studio-live?id=${encodeURIComponent(id)}&video=1`;
 return <main id="content" className="sm-super-admin-generation">
   {!project&&!error?<p role="status" className="sm-gen-extra-message">Loading the saved video status…</p>:<GenerationStatusView progress={progress} paymentMode="super-admin"
     creditCharge={project?.creditCharge}
     availableCredits={availableCredits}
     photoUrl={project?.imageId?`/api/assets/${encodeURIComponent(project.imageId)}`:null}
     format={project?.selection.outputFormat}
     videoUrl={project?.outputReady?link:null}
     downloadUrl={project?.outputReady?link+"&download=1":null}
     editHref={project?.state==="prepared"?resumeHref:project?.state==="failed"&&/^[a-f0-9-]{36}$/i.test(id)?`/studio?copy=live_${encodeURIComponent(id)}`:null}
     creditTopupHref={creditsHref}
     reuseHref={project?.outputReady?`/studio?copy=live_${encodeURIComponent(id)}`:null}
     note={error||(!project?.outputReady&&project?.stage?project.stage:"")}/>}

   {project?.state==="prepared"&&<div className="sm-gen-extra-message">
      {resumeHref?<a className="sm-gen-reuse" href={resumeHref}>Return to Studio · Step 4 to continue generation</a>:
        <a className="sm-gen-reuse" href={`/studio?copy=live_${encodeURIComponent(id)}`}>Edit a new version in Studio</a>}
      {!shortage&&<p>Your saved project has not been submitted. Confirm generation from the Studio review; this status page never starts a second task.</p>}
    </div>}
 </main>;
}
