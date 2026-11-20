"use client";
import {useEffect,useState} from "react";
import {createPortal} from "react-dom";
import {FolderPlus,Plus} from "lucide-react";

type Target={id:string;name:string};
export function AddToMusicProject({sourceId,sourceKind,enabled,menu=false}:{
  sourceId:string;sourceKind:"live"|"paid";enabled?:boolean;menu?:boolean;
}){
  const [allowed,setAllowed]=useState(!!enabled),[open,setOpen]=useState(false);
  const [projects,setProjects]=useState<Target[]>([]),[error,setError]=useState("");
  const [busy,setBusy]=useState(false),[complete,setComplete]=useState(false);
  useEffect(()=>{
    if(enabled!==undefined)return;
    let active=true;
    void fetch("/api/music-video",{credentials:"same-origin",cache:"no-store"})
      .then(r=>{if(active)setAllowed(r.ok);}).catch(()=>{});
    return()=>{active=false;};
  },[enabled]);
  if(!(enabled??allowed))return null;
  async function show(){
    setError("");setComplete(false);setOpen(true);
    try{
      const r=await fetch("/api/music-video",{credentials:"same-origin",cache:"no-store"});
      const d=await r.json() as {projects?:Target[];error?:string};
      if(!r.ok)throw new Error(d.error||"Projects unavailable.");
      setProjects(d.projects||[]);
    }catch(e){setError(e instanceof Error?e.message:"Projects unavailable.");}
  }
  async function add(id:string){
    setBusy(true);setError("");
    try{
      const r=await fetch("/api/music-video/"+encodeURIComponent(id)+"/assets",{
        method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({sourceKind,sourceId})
      });
      const result=await r.json() as {error?:string};
      if(!r.ok)throw new Error(result.error||"Unable to add video.");
      setComplete(true);
    }catch(e){setError(e instanceof Error?e.message:"Unable to add video.");}
    finally{setBusy(false);}
  }
  return <>
    <button type="button" className={menu?"":"mv-outline"} onClick={()=>void show()}>
      <FolderPlus size={15}/> Add to Project
    </button>
    {open&&typeof document!=="undefined"&&createPortal(
      <div className="mv-dialog-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setOpen(false);}}>
        <div className="mv-dialog" role="dialog" aria-modal="true" aria-label="Add video to music project">
          <h2>Add to Project</h2>
          {complete?<p role="status">Video added to the selected project&apos;s Library. It has not been placed on the timeline.</p>:
            projects.length?<div style={{display:"grid",gap:9,maxHeight:350,overflowY:"auto"}}>
              {projects.map(p=><button type="button" key={p.id} disabled={busy} onClick={()=>void add(p.id)}
                style={{display:"flex",alignItems:"center",gap:9,padding:12,border:"1px solid #8952aa",borderRadius:10,background:"#2a173e",textAlign:"left",color:"#fff"}}>
                <Plus size={16}/> {p.name}
              </button>)}
            </div>:<p>No music video projects yet. Create one under Projects first.</p>}
          {error&&<p role="alert" style={{color:"#ffb8c6"}}>{error}</p>}
          <div className="mv-dialog-actions"><button type="button" disabled={busy} onClick={()=>setOpen(false)}>Close</button></div>
        </div>
      </div>,document.body)}
  </>;
}
