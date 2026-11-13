"use client";
import {useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {ArrowDownToLine,ArrowUpDown,CalendarDays,Check,ChevronDown,
 Clapperboard,Clock3,Eye,Film,FolderOpen,Image as ImageIcon,
 MoreHorizontal,Plus,Search,SquarePen,Video,Trash2,Copy} from "lucide-react";
import {api,ensureSession} from "@/lib/client";
import type {StudioProject} from "@/lib/live/studio";
import "./my-projects-gallery.css";

type Tab="all"|"draft"|"processing"|"completed";
type ProjectStatus="draft"|"processing"|"completed"|"review"|"awaiting-payment";
type SavedDraft={
 id:string;projectName?:string;artistName:string;
 selection:{imageId?:string;outputFormat?:string;start:number;end:number;[key:string]:unknown};
 step:number;updated:number;
};
type CustomerOrder={
 orderId:string;projectId:string;status:string;fulfillmentState:string|null;
 videoReady:number;created:number;outputFormat?:string|null;durationSeconds?:number|null;
};
type TrashedProject={id:string;name:string;kind:"draft"|"admin";deletedAt:number;purgeAfter:number;restorable?:boolean};
type ProjectItem={
 id:string;kind:"draft"|"customer"|"admin";name:string;status:ProjectStatus;
 date:number;duration:number;format:string;image:string|null;
 href:string;supportId:string|null;providerId:string|null;
};
const safeDate=(n:number)=>Number.isFinite(n)&&n>0?new Date(n).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}):"—";
const durationLabel=(n:number)=>{
 if(!Number.isFinite(n)||n<=0)return "—";
 const t=Math.round(n);
 return String(Math.floor(t/60)).padStart(1,"0")+":"+String(t%60).padStart(2,"0");
};
const validFormat=(v?:string|null)=>v==="16:9"?"16:9":v==="9:16"?"9:16":"—";
function customerStatus(o:CustomerOrder):ProjectStatus{
 if(o.videoReady===1&&(o.status==="paid"||o.status==="free_delivered"))return "completed";
 if(o.status==="refunded"||o.status==="disputed"||o.fulfillmentState==="failed"||o.fulfillmentState==="requires-review")return "review";
 if(o.status==="awaiting_payment")return "awaiting-payment";
 return "processing";
}
function adminStatus(p:StudioProject):ProjectStatus{
 if(p.outputReady)return "completed";
 if(p.state==="failed"||p.state==="uncertain"||p.state==="authorized"||p.state==="submitting")return "review";
 return p.state==="prepared"?"draft":"processing";
}
function statusText(v:ProjectStatus){
 return {"draft":"Draft","processing":"Processing","completed":"Ready",
  "review":"Needs Review","awaiting-payment":"Awaiting Payment"}[v];
}
export function MyProjectsGallery(){
 const [drafts,setDrafts]=useState<SavedDraft[]>([]);
 const [orders,setOrders]=useState<CustomerOrder[]>([]);
 const [live,setLive]=useState<StudioProject[]>([]);
 const [trash,setTrash]=useState<TrashedProject[]>([]);
 const [trashError,setTrashError]=useState("");
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [tab,setTab]=useState<Tab>("all");
 const [search,setSearch]=useState("");
 const [newest,setNewest]=useState(true);
 const [labels,setLabels]=useState<Record<string,string>>({});
 const [renaming,setRenaming]=useState<string|null>(null);
 const [openOptionsId,setOpenOptionsId]=useState<string|null>(null);
 const [renameText,setRenameText]=useState("");
 const [busyId,setBusyId]=useState<string|null>(null);
 const [copiedSupportId,setCopiedSupportId]=useState<string|null>(null);
 const [supportCopyError,setSupportCopyError]=useState<string|null>(null);
 async function copySupportId(id:string){
  setSupportCopyError(null);
  const fallback=()=>{
   const input=document.createElement("textarea");
   input.value=id;input.setAttribute("readonly","");
   input.style.position="fixed";input.style.left="-10000px";
   document.body.appendChild(input);input.select();
   try{if(!document.execCommand("copy"))throw Error("Copy unavailable");}
   finally{input.remove();}
  };
  try {
   if(navigator.clipboard?.writeText){
    try{await navigator.clipboard.writeText(id);}
    catch{fallback();}
   }else fallback();
   setCopiedSupportId(id);
  }catch{
   setCopiedSupportId(null);
   setSupportCopyError(id);
  }
 }
 useEffect(()=>{
  try{
   const saved=JSON.parse(localStorage.getItem("sm-gallery-labels")||"{}");
   if(saved&&typeof saved==="object"&&!Array.isArray(saved))setLabels(saved);
  }catch{}
 },[]);
 // Only one project menu can be open. Clicking/tapping outside, focusing
 // another control, or pressing Escape closes it without affecting that
 // outside action. Capture pointerdown also handles mobile taps reliably.
 useEffect(()=>{
  if(openOptionsId===null)return;
  const currentMenu=()=>document.querySelector<HTMLDetailsElement>("details.sm-projects-options[open]");
  const outside=(target:EventTarget|null)=>{
   const menu=currentMenu();
   if(!menu||!(target instanceof Node)||!menu.contains(target))setOpenOptionsId(null);
  };
  const onPointerDown=(event:PointerEvent)=>outside(event.target);
  const onFocusIn=(event:FocusEvent)=>outside(event.target);
  const onEscape=(event:KeyboardEvent)=>{
   if(event.key!=="Escape")return;
   event.preventDefault();
   const summary=currentMenu()?.querySelector<HTMLElement>("summary");
   setOpenOptionsId(null);
   summary?.focus();
  };
  document.addEventListener("pointerdown",onPointerDown,true);
  document.addEventListener("focusin",onFocusIn);
  document.addEventListener("keydown",onEscape);
  return ()=>{
   document.removeEventListener("pointerdown",onPointerDown,true);
   document.removeEventListener("focusin",onFocusIn);
   document.removeEventListener("keydown",onEscape);
  };
 },[openOptionsId]);
 async function renameProject(item:ProjectItem){
  const next=renameText.trim();
  if(!next||next.length>80){setError("Enter a project name of up to 80 characters.");return;}
  if(busyId)return;
  setBusyId(item.id);setError("");
  try{
   if(item.kind==="draft"){
    const id=item.id.slice(6);
    const existing=drafts.find(d=>d.id===id);
    if(!existing)throw Error("Saved draft unavailable. Refresh My Projects.");
    await api("studio-drafts",{method:"POST",body:JSON.stringify({
      id,selection:existing.selection,artistName:existing.artistName,
      step:existing.step,projectName:next
    })});
    setDrafts(previous=>previous.map(d=>d.id===id?{...d,projectName:next}:d));
    try{localStorage.setItem("singmotion-project-name:"+id,next)}catch{}
   }
   // Generated jobs remain immutable. Rename their visible gallery label only.
   const updated={...labels,[item.id]:next};
   localStorage.setItem("sm-gallery-labels",JSON.stringify(updated));
   if(item.kind==="admin")localStorage.setItem("sm-live-project-name:"+item.id.slice(5),next);
   setLabels(updated);setRenaming(null);
   window.dispatchEvent(new CustomEvent("sm-project-name-updated",{detail:{id:item.id,name:next}}));
  }catch(cause){setError(cause instanceof Error?cause.message:"Unable to rename project.");}
  finally{setBusyId(null);}
 }
 async function refreshTrash(){
  const [draft,admin]=await Promise.allSettled([
   api<{items:TrashedProject[]}>("studio-drafts?trash=1"),
   api<{items:TrashedProject[]}>("studio-live?trash=1")
  ]);
  setTrash([
   ...(draft.status==="fulfilled"?(draft.value.items||[]):[]),
   ...(admin.status==="fulfilled"?(admin.value.items||[]):[])
  ].sort((a,b)=>b.deletedAt-a.deletedAt));
 }
 async function restoreTrash(item:TrashedProject){
  if(busyId)return;
  setBusyId(item.kind+"_"+item.id);setTrashError("");
  try{
   if(item.kind==="draft")
    await api("studio-drafts/"+encodeURIComponent(item.id)+"/restore",{method:"POST"});
   else await api("studio-live",{method:"POST",body:JSON.stringify({
    action:"restore",id:item.id,confirmation:"RESTORE "+item.id
   })});
   // Reload fresh server-authoritative selections; no cached project objects.
   window.location.reload();
  }catch(e){setTrashError(e instanceof Error?e.message:"Could not restore project.");}
  finally{setBusyId(null)}
 }
 async function deleteProject(item:ProjectItem){
  if(busyId||item.kind==="customer")return;
  const adminState=item.kind==="admin"?live.find(p=>p.id===item.id.slice(5))?.state:null;
  const active=item.kind==="admin" && !["prepared","completed","failed"].includes(adminState||"");
  const warning=item.kind==="draft"
   ?"Move '"+item.name+"' to Recently deleted? You can restore it for 30 days. After that, unshared media becomes eligible for cleanup."
   :active
    ?"Move this active project to Recently deleted? Provider and payment reconciliation will continue safely. Files will not be purged while the provider status is uncertain."
    :"Move '"+item.name+"' to Recently deleted? Its MP4 is retained for 30 days, then eligible for cleanup. Payment and audit records remain.";
  if(!window.confirm(warning))return;
  setBusyId(item.id);setError("");
  try{
   if(item.kind==="draft"){
    const id=item.id.slice(6);
    await api("studio-drafts/"+encodeURIComponent(id),{method:"DELETE"});
    setDrafts(previous=>previous.filter(d=>d.id!==id));
    try{
     if(localStorage.getItem("singmotion-draft-id")===id){
      localStorage.removeItem("singmotion-draft-id");
      localStorage.removeItem("singmotion-studio");
     }
     localStorage.removeItem("singmotion-project-name:"+id);
    }catch{}
   }else{
    const id=item.id.slice(5);
    await api("studio-live",{method:"POST",body:JSON.stringify(active
      ?{action:"hide",id,confirmation:"HIDE "+id}
      :{action:"delete",id,confirmation:"DELETE "+id})});
    setLive(previous=>previous.filter(p=>p.id!==id));
    try{localStorage.removeItem("sm-live-project-name:"+id)}catch{}
   }
   const updated={...labels};delete updated[item.id];
   localStorage.setItem("sm-gallery-labels",JSON.stringify(updated));setLabels(updated);
   await refreshTrash();
  }catch(cause){setError(cause instanceof Error?cause.message:"Could not delete this project.");}
  finally{setBusyId(null);}
 }
 useEffect(()=>{
  let active=true;
  async function refresh(){
   try{
    await ensureSession();
    const [d,o,l]=await Promise.allSettled([
      api<SavedDraft[]>("studio-drafts"),
      fetch("/api/customer-orders?view=mine",{credentials:"same-origin",cache:"no-store"})
        .then(async r=>r.ok?(await r.json() as {orders:CustomerOrder[]}).orders:[]),
      api<{projects:StudioProject[]}>("studio-live")
        .then(v=>v.projects||[]),
    ]);
    if(!active)return;
    setDrafts(d.status==="fulfilled"&&Array.isArray(d.value)?d.value:[]);
    setOrders(o.status==="fulfilled"&&Array.isArray(o.value)?o.value:[]);
    setLive(l.status==="fulfilled"&&Array.isArray(l.value)?l.value:[]);
    setError(d.status==="rejected"?"Your saved drafts could not be loaded. Please reopen the Studio to restore your workspace.":"");
    await refreshTrash().catch(()=>{});
   }catch{
    if(active)setError("Your private projects could not be loaded. Please sign in or reopen Studio.");
   }finally{if(active)setLoading(false);}
  }
  void refresh();return()=>{active=false};
 },[]);
 const projects=useMemo(()=>{
   const combined:ProjectItem[]=[];
   const draftNames=new Map(drafts.map(d=>[d.id,d]));
   // Merge the draft and the actual generated job using the original request
   // identifier. Never deduplicate unrelated projects by image, song or title.
   const linked=new Set([
     ...orders.map(o=>o.projectId),
     ...live.map(p=>p.sourceDraftId).filter((id):id is string=>typeof id==="string"&&id.length>0)
   ]);
   for(const d of drafts){
     if(linked.has(d.id))continue;
     if(!/^[a-zA-Z0-9-]{1,80}$/.test(d.id))continue;
     combined.push({
      id:"draft_"+d.id,kind:"draft",name:d.projectName?.trim()||d.artistName||"Untitled project",
      status:"draft",date:Number(d.updated)||0,
      duration:Math.max(0,(d.selection?.end||0)-(d.selection?.start||0)),
      format:validFormat(d.selection?.outputFormat),
      image:d.selection?.imageId?`/api/assets/${encodeURIComponent(d.selection.imageId)}`:null,
      href:`/studio?draft=${encodeURIComponent(d.id)}`,supportId:null,providerId:null
     });
   }
   for(const o of orders){
     if(!/^[a-f0-9-]{36}$/.test(o.orderId))continue;
     const d=draftNames.get(o.projectId);
     combined.push({
       id:"order_"+o.orderId,kind:"customer",
       name:d?.projectName?.trim()||d?.artistName||"Music video "+o.orderId.slice(0,8),
       status:customerStatus(o),date:Number(o.created)||0,
       duration:Number(o.durationSeconds)||Math.max(0,(d?.selection.end||0)-(d?.selection.start||0)),
       format:validFormat(o.outputFormat||d?.selection.outputFormat),
       image:o.status==="paid"?`/api/customer-generation-photo?orderId=${encodeURIComponent(o.orderId)}`:
         d?.selection.imageId?`/api/assets/${encodeURIComponent(d.selection.imageId)}`:null,
       href:`/orders/${encodeURIComponent(o.orderId)}`,
       supportId:o.status==="awaiting_payment"?null:o.orderId,providerId:null
     });
   }
   for(const p of live){
     if(!/^[a-f0-9-]{36}$/.test(p.id))continue;
     const sourceDraft=p.sourceDraftId?draftNames.get(p.sourceDraftId):undefined;
     combined.push({
       id:"live_"+p.id,kind:"admin",
       name:p.projectName?.trim()||sourceDraft?.projectName?.trim()||p.artistName||"Music video",
       status:adminStatus(p),date:Number(p.createdAt)||0,
       duration:p.durationSeconds||0,format:validFormat(p.selection?.outputFormat),
       image:p.imageId?`/api/assets/${encodeURIComponent(p.imageId)}`:null,
       href:`/projects/live_${encodeURIComponent(p.id)}`,
       supportId:p.providerJobId?p.id:null,providerId:p.providerJobId||null
     });
   }
   return combined.sort((a,b)=>newest?b.date-a.date:a.date-b.date);
 },[drafts,orders,live,newest]);
 const counts={
   all:projects.length,
   draft:projects.filter(p=>p.status==="draft").length,
   processing:projects.filter(p=>p.status==="processing"||p.status==="awaiting-payment"||p.status==="review").length,
   completed:projects.filter(p=>p.status==="completed").length
 };
 const filtered=projects.map(p=>({...p,name:labels[p.id]?.trim()||p.name})).filter(p=>
   (tab==="all"||tab==="draft"&&p.status==="draft"||
    tab==="processing"&&["processing","awaiting-payment","review"].includes(p.status)||
    tab==="completed"&&p.status==="completed")&&
   (p.name+" "+(p.supportId||"")+" "+(p.providerId||"")).toLowerCase().includes(search.trim().toLowerCase())
 );
 return <div className="sm-projects-page">
   <div className="sm-projects-heading">
     <div className="sm-projects-heading-title">
       <Clapperboard aria-hidden="true" size={41} strokeWidth={1.7}/>
       <div><h1>My Projects</h1><p>Your videos, all in one place.</p></div>
     </div>
     <Link className="sm-projects-new" href="/studio?new=1"><Plus size={21}/> New video</Link>
   </div>
   <div className="sm-projects-toolbar">
     <label className="sm-projects-search"><Search size={19}/><input type="search" value={search} onChange={e=>setSearch(e.target.value)}
       placeholder="Search your projects…" aria-label="Search projects and support IDs"/></label>
     <label className="sm-projects-filter-select">
       <span className="sr-only">Filter by project status</span>
       <select aria-label="Filter projects by status" value={tab} onChange={e=>setTab(e.target.value as Tab)}>
         <option value="all">All projects ({counts.all})</option>
         <option value="draft">Drafts ({counts.draft})</option>
         <option value="processing">Processing ({counts.processing})</option>
         <option value="completed">Completed ({counts.completed})</option>
       </select>
       <ChevronDown size={15} aria-hidden="true"/>
     </label>
     <button type="button" className="sm-projects-sort" onClick={()=>setNewest(v=>!v)} aria-label={newest?"Sort oldest first":"Sort newest first"} title={newest?"Newest first":"Oldest first"}>
       <ArrowUpDown size={15}/><span>{newest?"Newest first":"Oldest first"}</span>
     </button>
   </div>
   {error&&<p className="sm-projects-error" role="alert">{error}</p>}
   {loading?<div className="sm-projects-empty" role="status">Loading your projects…</div>:
    filtered.length?<div className="sm-projects-grid">
      {filtered.map(item=><article className="sm-projects-card" key={item.id}>
        <Link className="sm-projects-card-main" href={item.href} aria-label={`Open ${item.name}, ${statusText(item.status)}`}>
          <div className="sm-projects-cover">
            {item.image?<img src={item.image} alt="" loading="lazy"/>:
             <div className="sm-projects-cover-placeholder"><Film size={31}/></div>}
            {item.format!=="—"&&<span className="sm-projects-format"><Video size={12}/>{item.format}</span>}
            {item.duration>0&&<span className="sm-projects-duration">{durationLabel(item.duration)}</span>}
          </div>
          <div className="sm-projects-card-content">
            <h2 title={item.name}>{item.name}</h2>
            <span className={"sm-projects-status is-"+item.status}>
              {item.status==="completed"?<Check size={13}/>:item.status==="draft"?<SquarePen size={12}/>:item.status==="review"?<Eye size={12}/>:<Clock3 size={12}/>}
              {statusText(item.status)}
            </span>
          </div>
        </Link>
        <div className="sm-projects-card-details">
          <div className="sm-projects-meta"><span><Video size={13}/>{item.format} · {item.duration>0?`${Math.round(item.duration)} sec`:"—"}</span>
            <span><CalendarDays size={13}/>{safeDate(item.date)}</span></div>
          <div className="sm-projects-card-footer">
          {renaming===item.id?<form className="sm-projects-rename-form" onSubmit={event=>{event.preventDefault();void renameProject(item)}}>
            <input aria-label="New project name" autoFocus maxLength={80} value={renameText} disabled={busyId===item.id} onChange={event=>setRenameText(event.target.value)} onKeyDown={event=>{if(event.key==="Escape")setRenaming(null)}}/>
            <button type="submit" disabled={busyId===item.id||!renameText.trim()}>Save</button>
            <button type="button" onClick={()=>setRenaming(null)}>Cancel</button>
          </form>:
          <details className="sm-projects-options" open={openOptionsId===item.id}>
            <summary aria-label={"More options for "+item.name} title="Project options" aria-expanded={openOptionsId===item.id}
              onClick={event=>{event.preventDefault();setOpenOptionsId(current=>current===item.id?null:item.id);}}><MoreHorizontal size={18}/></summary>
            <div className="sm-projects-options-menu">
              <Link href={item.href} onClick={()=>setOpenOptionsId(null)}><SquarePen size={15}/> Edit</Link>
              <button type="button" onClick={()=>{setOpenOptionsId(null);setRenameText(item.name);setRenaming(item.id)}}><SquarePen size={15}/> Rename</button>
              <button type="button" className="sm-projects-delete" disabled={busyId===item.id||item.kind==="customer"} title={item.kind==="customer"?"Paid orders cannot be deleted from My Projects; contact support for data removal.":"Delete project"} onClick={()=>{setOpenOptionsId(null);void deleteProject(item);}}><Trash2 size={15}/> {busyId===item.id?"Deleting…":"Delete"}</button>
              {item.kind==="customer"&&<small>Paid orders cannot be deleted here.</small>}
            </div>
          </details>}
          </div>
        </div>
        {item.supportId&&<div className="sm-projects-support" title={`Support ID: ${item.supportId}`}>
          <span>Support ID</span><code>{item.supportId.slice(0,8)}…</code>
          <button type="button" className="sm-projects-copy-support"
           onClick={()=>void copySupportId(item.supportId!)}
           aria-label={`Copy full support ID for ${item.name}`}
           title="Copy full support ID">
           {copiedSupportId===item.supportId?<Check size={13} aria-hidden="true"/>:<Copy size={13} aria-hidden="true"/>}
          </button>
          {copiedSupportId===item.supportId&&<span className="sm-projects-copy-feedback" role="status">Copied!</span>}
          {supportCopyError===item.supportId&&<span className="sm-projects-copy-error" role="alert">Copy failed</span>}
        </div>}
      </article>)}
    </div>:
    <div className="sm-projects-empty">
      <FolderOpen size={34}/><h2>{projects.length?"No matching projects":"Your first video starts here."}</h2>
      <p>{projects.length?"Try another search or status filter.":"Upload your music and artist photo to create your first project."}</p>
      {!projects.length&&<Link href="/studio?new=1">Create a video</Link>}
    </div>}
   <section className="sm-projects-trash" aria-label="Recently deleted projects">
    <details>
      <summary><Trash2 size={17} aria-hidden="true"/> Recently deleted ({trash.length}) <span>Restore within 30 days</span></summary>
      <p className="sm-projects-trash-explain">Deleted projects are hidden immediately. Media not needed by other projects becomes eligible for cleanup after 30 days; physical cleanup requires approved backups. Financial and provider audit records are retained as required.</p>
      {trashError&&<p className="sm-projects-error" role="alert">{trashError}</p>}
      {trash.length===0?<p className="sm-projects-trash-empty">No recoverable deleted projects.</p>:
       <ul>{trash.map(item=><li key={item.kind+"_"+item.id}>
         <div><strong>{item.name}</strong><small>Eligible for cleanup from: {safeDate(item.purgeAfter)}</small></div>
         {item.restorable===false?<small>Preparation canceled; restore the original saved draft instead.</small>:
          <button type="button" disabled={busyId!==null}
            onClick={()=>void restoreTrash(item)}>
            {busyId===item.kind+"_"+item.id?"Restoring…":"Restore"}
          </button>}
       </li>)}</ul>}
    </details>
   </section>
 </div>;
}
