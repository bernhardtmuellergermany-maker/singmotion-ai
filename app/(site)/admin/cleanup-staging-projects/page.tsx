"use client";
import {useState} from "react";
type Project={id:string;state:string};
type Result={failed?:Project[];uncertain?:Project[];preservedCount?:number;deletedFailed?:number;uncertainProtected?:string[];errors?:string[];error?:string};
export default function Cleanup(){
 const [result,setResult]=useState<Result|null>(null),[busy,setBusy]=useState(false);
 const [confirm,setConfirm]=useState("");
 async function run(mode:"preview"|"execute"){
  setBusy(true);
  try{const r=await fetch("/api/admin/cleanup-staging-projects",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode,confirmation:confirm})});
   const v=await r.json() as Result;setResult(v);
  }catch(e){setResult({error:(e as Error).message})}finally{setBusy(false)}
 }
 return <main style={{maxWidth:780,margin:"60px auto",padding:24,background:"#101524",color:"white",borderRadius:14,fontFamily:"system-ui"}}>
  <h1>STAGING: Cleanup failed projects</h1>
  <p>Completed projects and drafts remain untouched. Uncertain, submitted or processing provider tasks cannot be safely deleted and are listed separately.</p>
  <button disabled={busy} onClick={()=>void run("preview")}>Preview project statuses</button>
  {result&&<pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{JSON.stringify(result,null,2)}</pre>}
  {result?.failed&&<><p>Enter <code>DELETE FAILED STAGING PROJECTS</code> to permanently delete failed project records.</p>
   <input style={{width:"100%",padding:10}} value={confirm} onChange={e=>setConfirm(e.target.value)}/>
   <button disabled={busy||confirm!=="DELETE FAILED STAGING PROJECTS"} onClick={()=>void run("execute")}>Delete failed projects</button></>}
 </main>;
}
