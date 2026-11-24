"use client";
import {useState,useRef} from "react";
import {ArrowRight} from "lucide-react";
import {useRouter} from "next/navigation";
import {api,ensureSession} from "@/lib/client";
import type {StudioDraftExport} from "@/lib/studio-draft";

export function NextAudioSegmentButton({id,className="sm-gen-reuse"}:{id:string;className?:string}){
 const router=useRouter();
 const pending=useRef(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 async function next(){
  if(pending.current)return;
  pending.current=true;setBusy(true);setError("");
  try{
   await ensureSession();
   const source=await api<{selection:StudioDraftExport;projectName:string}>("studio-live?id="+encodeURIComponent(id)+"&next=1");
   const draftId=crypto.randomUUID();
   // Save an independent audio-only draft BEFORE navigation. Do not upload
   // the song again, copy the image, or submit a paid generation.
   await api("studio-drafts",{method:"POST",body:JSON.stringify({
    id:draftId,selection:source.selection,artistName:"My artist",
    projectName:source.projectName,step:0
   })});
   try{sessionStorage.removeItem("sm-credit-checkout-resume");sessionStorage.removeItem("sm-studio-account-resume");}catch{}
   router.push("/studio?draft="+encodeURIComponent(draftId));
  }catch(e){setError(e instanceof Error?e.message:"Unable to open the next audio segment.");pending.current=false;setBusy(false);}
 }
 return <><button type="button" className={className} disabled={busy} onClick={e=>{e.stopPropagation();void next();}}>
  <ArrowRight size={16}/>{busy?"Preparing next segment…":"Continue with next segment"}
 </button>{error&&<p role="alert" className="sm-gen-reuse-note">{error}</p>}</>;
}
