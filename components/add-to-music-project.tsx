"use client";
import {useEffect,useState} from "react";
import {createPortal} from "react-dom";
import {FolderPlus,Plus,CheckCircle2} from "lucide-react";
import "./music-video.css";

type Target={id:string;name:string};
export function AddToMusicProject({sourceId,sourceKind,enabled,menu=false}:{
  sourceId:string;sourceKind:"live"|"paid";enabled?:boolean;menu?:boolean;
}){
  const [allowed,setAllowed]=useState(!!enabled),[open,setOpen]=useState(false);
  const [projects,setProjects]=useState<Target[]>([]),[error,setError]=useState("");
  const [busy,setBusy]=useState(false),[complete,setComplete]=useState(false);
  useEffect(()=>{
    if(enabled!==undefined){setAllowed(enabled);return;}
    let active=true;
    void fetch("/api/music-video",{credentials:"same-origin",cache:"no-store"})
      .then(r=>{if(active)setAllowed(r.ok);}).catch(()=>{});
    return()=>{active=false;};
  },[enabled]);
  // Legacy paid-order files remain downloadable in Videos; direct export is not supported yet.
  if(!allowed||sourceKind==="paid")return null;
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
      <div className="mv-root mv-dialog-backdrop mv-add-project-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setOpen(false);}}>
        <div className="mv-dialog mv-add-project-dialog" role="dialog" aria-modal="true" aria-label="Add video to music project">
          <h2>{complete?"Added to Project":"Add to Project"}</h2>
          {complete?<div className="mv-add-project-success" role="status"><CheckCircle2 size={24} aria-hidden="true"/><p>The video was added to the selected project's Library. It has not been placed on the timeline yet.</p></div>:
            projects.length?<div className="mv-add-project-list">
              {projects.map(p=><button type="button" key={p.id} disabled={busy} onClick={()=>void add(p.id)}
                className="mv-add-project-choice">
                <Plus size={16}/> <span>{p.name}</span>
              </button>)}
            </div>:<p>No music video projects yet. Create one under Projects first.</p>}
          {error&&<p role="alert" className="mv-add-project-error">{error}</p>}
          <div className="mv-dialog-actions"><button className="mv-primary mv-add-project-close" type="button" disabled={busy} onClick={()=>setOpen(false)}>Close</button></div>
        </div>
      </div>,document.body)}
  </>;
}
