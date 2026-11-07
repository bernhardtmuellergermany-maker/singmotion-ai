"use client";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import {Search,X} from "lucide-react";
import {api,ensureSession} from "@/lib/client";
import type {StudioProject} from "@/lib/live/studio";
export function OutputProjectSearch(){
 const [open,setOpen]=useState(false),[query,setQuery]=useState(""),[projects,setProjects]=useState<StudioProject[]>([]);
 const host=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(!open)return;input.current?.focus();let alive=true;void ensureSession().then(()=>api<{projects:StudioProject[]}>("studio-live")).then(v=>{if(alive)setProjects(v.projects||[])}).catch(()=>{});return()=>{alive=false}},[open]);
 useEffect(()=>{if(!open)return;const close=(e:PointerEvent)=>{if(host.current&&!host.current.contains(e.target as Node))setOpen(false)};const key=(e:KeyboardEvent)=>{if(e.key==="Escape")setOpen(false)};document.addEventListener("pointerdown",close);document.addEventListener("keydown",key);return()=>{document.removeEventListener("pointerdown",close);document.removeEventListener("keydown",key)}},[open]);
 const matches=projects.filter(p=>(p.projectName+" "+p.artistName+" "+new Date(p.createdAt).toLocaleDateString()).toLowerCase().includes(query.toLowerCase())).slice(0,12);
 return <div ref={host} className={"sm-inline-search sm-output-search-wrap"+(open?" is-open":"")}>
 <button className="sm-inline-search-icon" type="button" aria-label="Search projects" aria-expanded={open} onClick={()=>setOpen(v=>!v)}><Search size={19}/></button>
 <input ref={input} type="search" tabIndex={open?0:-1} aria-label="Search projects" placeholder="Search cards, projects, dates..." value={query} onChange={e=>setQuery(e.target.value)}/><button type="button" className="sm-inline-search-close" aria-label="Close search" tabIndex={open?0:-1} onClick={()=>{setOpen(false);setQuery("")}}><X size={16}/></button>
 {open&&query.trim()&&<div className="sm-output-search-panel"><div className="sm-output-search-results">{matches.length?matches.map(p=><Link href={"/projects/live_"+encodeURIComponent(p.id)} key={p.id} onClick={()=>setOpen(false)}>{p.projectName||p.artistName||"Untitled Project"}</Link>):<span>No matching projects</span>}</div></div>}
 </div>;
}
