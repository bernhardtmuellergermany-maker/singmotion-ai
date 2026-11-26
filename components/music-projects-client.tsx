"use client";
import Link from "next/link";
import {useCallback,useEffect,useState} from "react";
import {Clapperboard,Plus,Search,MoreHorizontal,Trash2,Pencil,Music2,ChevronDown,RefreshCw,ArrowUpDown,HardDrive} from "lucide-react";
import type {ProjectStorage} from "@/lib/music-video/storage";
import type {MusicProject,MusicProjectSummary,ProjectAspectRatio} from "@/lib/music-video/core";
import "./music-video.css";

type Payload={projects:MusicProjectSummary[];storage?:ProjectStorage|null;error?:string};
const size=(bytes:number)=>bytes>=1e9?(bytes/1e9).toFixed(2)+" GB":(bytes/1e6).toFixed(1)+" MB";
async function api<T>(url:string,init?:RequestInit):Promise<T>{
  const response=await fetch(url,{credentials:"same-origin",cache:"no-store",...init});
  const data=await response.json() as T & {error?:string};
  if(!response.ok)throw new Error(data.error||"Unable to load projects.");
  return data;
}
const duration=(ms:number)=>String(Math.floor(ms/60000))+":"+String(Math.floor((ms%60000)/1000)).padStart(2,"0");
export function MusicProjectsClient(){
  const [projects,setProjects]=useState<MusicProjectSummary[]>([]);
  const [storage,setStorage]=useState<ProjectStorage|null>(null);
  const [search,setSearch]=useState("");
  const [projectFilter,setProjectFilter]=useState<"all"|"auto"|"9:16"|"16:9">("all");
  const [newest,setNewest]=useState(true),[refreshing,setRefreshing]=useState(false);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  const [creating,setCreating]=useState(false);
  const [busy,setBusy]=useState(false);
  const [name,setName]=useState("");
  const [aspectRatio,setAspectRatio]=useState<ProjectAspectRatio>("auto");
  const [song,setSong]=useState<File|null>(null);
  const refresh=useCallback(async()=>{
    setRefreshing(true);
    try{const data=await api<Payload>("/api/music-video");setProjects(data.projects||[]);setStorage(data.storage??null);setError("");}
    catch(e){setStorage(null);setError(e instanceof Error?e.message:"Projects unavailable.");}
    finally{setLoading(false);setRefreshing(false);}
  },[]);
  useEffect(()=>{void refresh();},[refresh]);
  useEffect(()=>{
    const opened=()=>document.querySelectorAll<HTMLDetailsElement>('.mv-projects .mv-card-more[open]');
    const outside=(event:Event)=>{
      const target=event.target;
      if(!(target instanceof Node))return;
      opened().forEach(menu=>{if(!menu.contains(target))menu.open=false;});
    };
    const escape=(event:KeyboardEvent)=>{
      if(event.key!=="Escape")return;
      opened().forEach(menu=>{const focused=menu.contains(document.activeElement);menu.open=false;if(focused)menu.querySelector("summary")?.focus();});
    };
    document.addEventListener("pointerdown",outside,true);
    document.addEventListener("click",outside,true);
    document.addEventListener("keydown",escape);
    return()=>{document.removeEventListener("pointerdown",outside,true);document.removeEventListener("click",outside,true);document.removeEventListener("keydown",escape);};
  },[]);

  async function create(e:React.FormEvent){
    e.preventDefault();
    if(!song||!name.trim()||busy)return;
    setBusy(true);setError("");
    try{
      const body=new FormData();body.set("name",name);body.set("song",song);body.set("aspectRatio",aspectRatio);
      const result=await api<{project:MusicProject}>("/api/music-video",{method:"POST",body});
      window.location.assign("/projects/"+result.project.id);
    }catch(e){setError(e instanceof Error?e.message:"Could not create project.");setBusy(false);}
  }
  async function rename(p:MusicProject){
    const next=window.prompt("Rename project",p.name);
    if(!next||next.trim()===p.name)return;
    try{await api("/api/music-video/"+p.id,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:next})});await refresh();}
    catch(e){setError(e instanceof Error?e.message:"Rename failed.");}
  }
  async function remove(p:MusicProject){
    if(!window.confirm("Delete project '"+p.name+"' and its project uploads? Original videos in Videos will not be deleted."))return;
    try{await api("/api/music-video/"+p.id,{method:"DELETE"});await refresh();}
    catch(e){setError(e instanceof Error?e.message:"Delete failed.");}
  }
  const filtered=projects.filter(p=>(projectFilter==="all"||p.aspectRatio===projectFilter)&&(p.name+" "+(p.songName||"")).toLowerCase().includes(search.trim().toLowerCase())).sort((a,b)=>newest?b.updatedAt-a.updatedAt:a.updatedAt-b.updatedAt);
  return <main id="content" className="mv-root mv-projects">
    <div className="mv-heading"><div><div className="mv-heading-title"><Clapperboard size={30}/><h1>Projects</h1></div>
      <p>Your music video projects, all in one place.</p></div>
      <button className="mv-primary" type="button" onClick={()=>setCreating(true)}><Plus size={17}/> New Project</button>
    </div>
    <section className="mv-storage" aria-label="Project storage">
      <div className="mv-storage-title"><HardDrive size={20} aria-hidden="true"/><div><h2>Project storage</h2><p>Local project files · linked original videos are not duplicated here.</p></div><strong>{storage?size(storage.totalBytes):"—"}</strong></div>
      {storage&&<><div className="mv-storage-track" aria-hidden="true">{([["audio",storage.audioBytes],["video",storage.videoBytes],["other",storage.otherBytes]] as const).map(([key,value])=><span key={key} className={"mv-storage-"+key} style={{flexGrow:value}}/>)}</div>
      <div className="mv-storage-breakdown"><span>Audio <b>{size(storage.audioBytes)}</b></span><span>Uploaded clips <b>{size(storage.videoBytes)}</b></span><span>Other / previews <b>{size(storage.otherBytes)}</b></span></div>
      {storage.partial&&<p role="status">Partial estimate; some files could not be counted.</p>}</>}
      {!storage&&!loading&&<p>Storage figures are currently unavailable.</p>}
      <p>Delete unneeded project uploads using the existing project controls. Original videos in Videos are not deleted by removing a project.</p>
    </section>
    <div className="mv-browse-toolbar">
      <label className="mv-browse-search"><Search size={16}/><input type="search" aria-label="Search projects" placeholder="Search projects…" value={search} onChange={e=>setSearch(e.target.value)}/></label>
      <label className="mv-browse-filter"><select aria-label="Filter projects by format" value={projectFilter} onChange={e=>setProjectFilter(e.target.value as typeof projectFilter)}>
        {(["all","9:16","16:9","auto"] as const).map(f=><option key={f} value={f}>{f==="all"?"All projects":f==="auto"?"Auto format":f} ({projects.filter(p=>f==="all"||p.aspectRatio===f).length})</option>)}
      </select><ChevronDown size={15} aria-hidden="true"/></label>
      <button type="button" className="mv-browse-control" disabled={refreshing} onClick={()=>void refresh()} aria-label="Refresh projects" title="Refresh projects"><RefreshCw size={15}/></button>
      <button type="button" className="mv-browse-control" onClick={()=>setNewest(v=>!v)} aria-label={newest?"Sort oldest first":"Sort newest first"}><ArrowUpDown size={15}/><span>{newest?"Newest first":"Oldest first"}</span></button>
    </div>
    {error&&<p role="alert" className="mv-error">{error}</p>}
    {loading?<p role="status">Loading projects…</p>:filtered.length?<div className="mv-project-grid">
      {filtered.map(p=><article key={p.id} className="mv-project-card">
        <Link href={"/projects/"+p.id} className="mv-project-link">
          <div className="mv-project-art"><Music2 size={38}/>{p.thumbnailAssetId&&<img key={p.thumbnailAssetId} src={"/api/music-video/"+p.id+"/thumbnail/"+p.thumbnailAssetId} alt="" loading="lazy" decoding="async" draggable={false} onError={e=>{e.currentTarget.style.display="none";}}/>}<span>{p.aspectRatio==="auto"?"Auto":p.aspectRatio}</span></div>
          <strong>{p.name}</strong><p>{duration(p.songDurationMs)} · Edited {new Date(p.updatedAt).toLocaleDateString("en-GB")}</p>
        </Link>
        <details className="mv-card-more"><summary aria-label={"Project options for "+p.name}><MoreHorizontal size={18}/></summary>
          <div><Link href={"/projects/"+p.id}><Pencil size={14}/> Edit</Link><button onClick={()=>void rename(p)}><Pencil size={14}/> Rename</button>
          <button onClick={()=>void remove(p)}><Trash2 size={14}/> Delete</button></div>
        </details>
      </article>)}
    </div>:<div className="mv-empty"><Clapperboard size={34}/><h2>{projects.length?"No matching projects":"Create your first music video project"}</h2><p>Start with one song, then arrange your videos on two tracks.</p>
      <button className="mv-primary" onClick={()=>setCreating(true)}>New Project</button></div>}
    {creating&&<div role="presentation" className="mv-dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setCreating(false);}}>
      <form className="mv-dialog" onSubmit={e=>void create(e)} aria-label="New music video project">
        <h2>New Project</h2><label>Project Name<input autoFocus required maxLength={80} value={name} onChange={e=>setName(e.target.value)} placeholder="My Music Video"/></label>
        <label>Upload Song (MP3, WAV or M4A)<input required type="file" accept=".mp3,.wav,.m4a,audio/*" onChange={e=>setSong(e.target.files?.[0]||null)}/></label>
        <div className="mv-format-controls" role="group" aria-label="Project video format"><span>Format</span>{(["auto","9:16","16:9"] as const).map(ratio=><button key={ratio} type="button" aria-pressed={aspectRatio===ratio} disabled={busy} onClick={()=>setAspectRatio(ratio)}>{ratio==="auto"?"Auto":ratio}</button>)}</div>
        <div className="mv-dialog-actions"><button type="button" disabled={busy} onClick={()=>setCreating(false)}>Cancel</button><button type="submit" className="mv-primary" disabled={!name.trim()||!song||busy}>{busy?"Creating…":"Create Project"}</button></div>
      </form>
    </div>}
  </main>;
}
