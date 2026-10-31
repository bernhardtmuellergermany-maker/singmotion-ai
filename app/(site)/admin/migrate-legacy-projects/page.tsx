"use client";
import {useState} from "react";
type Result={owner?:string;metrics?:Record<string,number>;error?:string;detail?:string;migrated?:boolean};
export default function LegacyMigration(){
 const [preview,setPreview]=useState<Result|null>(null);
 const [result,setResult]=useState<Result|null>(null);
 const [busy,setBusy]=useState(false);
 const [confirmation,setConfirmation]=useState("");
 async function run(mode:"preview"|"execute"){
  setBusy(true);setResult(null);
  try{
   const res=await fetch("/api/admin/migrate-legacy-projects",{
    method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({mode,confirmation:mode==="execute"?confirmation:undefined})
   });
   const data=await res.json() as Result;
   if(!res.ok)throw Error(data.error+(data.detail?": "+data.detail:""));
   if(mode==="preview")setPreview(data);else setResult(data);
  }catch(e){setResult({error:(e as Error).message})}finally{setBusy(false)}
 }
 return <main style={{maxWidth:780,margin:"60px auto",padding:24,fontFamily:"system-ui",color:"#f3eefe",background:"#101524",borderRadius:16}}>
 <h1>STAGING: Restore legacy projects</h1>
 <p>Moves existing guest-owned projects, source assets, saved drafts and associated live attempts into the currently authenticated super-admin account. Never affects production.</p>
 <button disabled={busy} onClick={()=>void run("preview")}>Preview legacy project counts</button>
 {preview&&<section><h2>Preview: {preview.owner}</h2><pre>{JSON.stringify(preview.metrics,null,2)}</pre>
 <p>Confirm only if all historical guest projects on this staging environment belong to your workspace.</p>
 <label>Type <code>MIGRATE LEGACY STAGING PROJECTS</code> to proceed:
 <input value={confirmation} onChange={e=>setConfirmation(e.target.value)} style={{display:"block",width:"100%",padding:10,margin:"10px 0",color:"#111"}}/></label>
 <button disabled={busy||confirmation!=="MIGRATE LEGACY STAGING PROJECTS"} onClick={()=>void run("execute")}>Transfer all legacy projects to my super-admin account</button></section>}
 {result&&<pre role="status">{JSON.stringify(result,null,2)}</pre>}
 </main>;
}
