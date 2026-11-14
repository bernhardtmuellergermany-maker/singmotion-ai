"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import Link from "next/link";
import {ArrowDownToLine,ArrowUpDown,CalendarDays,Check,ChevronDown,
 Clapperboard,Clock3,Eye,Film,FolderOpen,Image as ImageIcon,
 MoreHorizontal,Plus,Search,SquarePen,Video,Trash2,Copy,RefreshCw} from "lucide-react";
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
 videoReady:number;created:number;outputFormat?:string|null;durationSeconds?:number|null;displayName?:string|null;
};
type TrashedProject={id:string;name:string;kind:"draft"|"admin"|"customer";deletedAt:number;purgeAfter?:number;restorable?:boolean};
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
 const [syncing,setSyncing]=useState(false);
 const [syncNonce,setSyncNonce]=useState(0);
 const [error,setError]=useState("");
 const [tab,setTab]=useState<Tab>("all");
 const [search,setSearch]=useState("");
 const [newest,setNewest]=useState(true);
 const [labels,setLabels]=useState<Record<string,string>>({});
 const migratingLabels=useRef(false);
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
   if(item.kind==="customer"){
    const id=item.id.slice(6);
    const response=await fetch("/api/customer-orders",{
     method:"PUT",credentials:"same-origin",headers:{"Content-Type":"application/json"},
     body:JSON.stringify({orderId:id,hidden:true})
    });
    if(!response.ok){
     const body=await response.json().catch(()=>null) as {error?:string}|null;
     throw Error(body?.error||"Could not remove this project.");
    }
    setOrders(previous=>previous.filter(o=>o.orderId!==id));
   }else if(item.kind==="draft"){
    const id=item.id.slice(6);
    const existing=drafts.find(d=>d.id===id);
    if(!existing)throw Error("Saved draft unavailable. Refresh My Projects.");
    await api("studio-drafts",{method:"POST",body:JSON.stringify({
      id,selection:existing.selection,artistName:existing.artistName,
      step:existing.step,projectName:next
    })});
    setDrafts(previous=>previous.map(d=>d.id===id?{...d,projectName:next}:d));
    try{localStorage.setItem("singmotion-project-name:"+id,next)}catch{}
   }else if(item.kind==="admin"){
    const id=item.id.slice(5);
    const saved=await api<StudioProject>("studio-live",{method:"POST",
      body:JSON.stringify({action:"rename",id,name:next})});
    setLive(previous=>previous.map(p=>p.id===id?saved:p));
   }else{
    const id=item.id.slice(6);
    const response=await fetch("/api/customer-orders",{
      method:"PATCH",credentials:"same-origin",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({orderId:id,name:next})
    });
    if(!response.ok){
      const message=await response.json().catch(()=>null) as {error?:string}|null;
      throw Error(message?.error||"Unable to save this project name.");
    }
    setOrders(previous=>previous.map(o=>o.orderId===id?{...o,displayName:next}:o));
   }
   // Never shadow server names with a stale browser-local label.
   const updated={...labels};delete updated[item.id];
   try{
    localStorage.setItem("sm-gallery-labels",JSON.stringify(updated));
    if(item.kind==="admin")localStorage.removeItem("sm-live-project-name:"+item.id.slice(5));
   }catch{}
   setLabels(updated);setRenaming(null);
   window.dispatchEvent(new CustomEvent("sm-project-name-updated",{detail:{id:item.id,name:next}}));
  }catch(cause){setError(cause instanceof Error?cause.message:"Unable to rename project.");}
  finally{setBusyId(null);}
 }
 async function refreshTrash(){
  const [draft,admin,customer]=await Promise.allSettled([
   api<{items:TrashedProject[]}>("studio-drafts?trash=1"),
   api<{items:TrashedProject[]}>("studio-live?trash=1"),
   fetch("/api/customer-orders?view=hidden",{credentials:"same-origin",cache:"no-store"})
    .then(async response=>{
      if(!response.ok)return [] as TrashedProject[];
      const data=await response.json() as {items:Array<{id:string;name:string;deletedAt:number}>};
      return (data.items||[]).map(item=>({...item,kind:"customer" as const}));
    })
  ]);
  setTrash([
   ...(draft.status==="fulfilled"?(draft.value.items||[]):[]),
   ...(admin.status==="fulfilled"?(admin.value.items||[]):[]),
   ...(customer.status==="fulfilled"?customer.value:[])
  ].sort((a,b)=>b.deletedAt-a.deletedAt));
 }
 async function restoreTrash(item:TrashedProject){
  if(busyId)return;
  setBusyId(item.kind+"_"+item.id);setTrashError("");
  try{
   if(item.kind==="customer"){
    const response=await fetch("/api/customer-orders",{
     method:"PUT",credentials:"same-origin",headers:{"Content-Type":"application/json"},
     body:JSON.stringify({orderId:item.id,hidden:false})
    });
    if(!response.ok)throw Error("Could not restore this paid project.");
   }else if(item.kind==="draft")
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
  if(busyId)return;
  const adminState=item.kind==="admin"?live.find(p=>p.id===item.id.slice(5))?.state:null;
  const active=item.kind==="admin" && !["prepared","completed","failed"].includes(adminState||"");
  const warning=item.kind==="customer"
   ?"Remove '"+item.name+"' from My Projects? You can restore it under Recently deleted. Any active generation continues; payment, refunds and video delivery records are kept."
   :item.kind==="draft"
   ?"Move '"+item.name+"' to Recently deleted? You can restore it for 30 days. After that, unshared media becomes eligible for cleanup."
   :active
    ?"Move this active project to Recently deleted? Provider and payment reconciliation will continue safely. Files will not be purged while the provider status is uncertain."
    :"Move '"+item.name+"' to Recently deleted? Its MP4 is retained for 30 days, then eligible for cleanup. Payment and audit records remain.";
  if(!window.confirm(warning))return;
  setBusyId(item.id);setError("");
  try{
   if(item.kind==="customer"){
    const id=item.id.slice(6);
    const response=await fetch("/api/customer-orders",{
      method:"PUT",credentials:"same-origin",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({orderId:id,hidden:true})
    });
    const result=await response.json().catch(()=>null) as {hidden?:boolean;error?:string}|null;
    if(!response.ok||result?.hidden!==true)
      throw Error(result?.error||"Could not remove this paid project.");
    setOrders(previous=>previous.filter(o=>o.orderId!==id));
   }else if(item.kind==="draft"){
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
 // Refresh account-owned names when returning from another device or tab.
 // Never let an older response or locally cached browser label become authority.
 useEffect(()=>{
  let active=true;
  let inFlight=false;
  let lastRead=0;
  async function refresh(force=false){
   if(!active||inFlight||(!force&&Date.now()-lastRead<1200))return;
   inFlight=true;lastRead=Date.now();
   if(active)setSyncing(true);
   try{
    const session=await ensureSession() as {owner?:string};
    // The private CMS Super Admin workspace does not have a customer-order
    // cookie. Asking the customer-only endpoint returns an expected 401;
    // never report that as a failure to synchronize the operator's projects.
    // Only authenticated customer workspaces may read customer order titles.
    const isCustomer=typeof session?.owner==="string"&&session.owner.startsWith("customer-");
    const [d,o,l]=await Promise.allSettled([
      api<SavedDraft[]>("studio-drafts",{cache:"no-store"}),
      isCustomer
        ?fetch("/api/customer-orders?view=mine",{credentials:"same-origin",cache:"no-store"})
          .then(async r=>{
            if(!r.ok)throw Error("Customer projects unavailable");
            return (await r.json() as {orders:CustomerOrder[]}).orders;
          })
        :Promise.resolve([] as CustomerOrder[]),
      api<{projects:StudioProject[]}>("studio-live",{cache:"no-store"})
        .then(v=>v.projects||[]),
    ]);
    if(!active)return;
    if(d.status==="fulfilled"&&Array.isArray(d.value))setDrafts(d.value);
    if(o.status==="fulfilled"&&Array.isArray(o.value))setOrders(o.value);
    if(l.status==="fulfilled"&&Array.isArray(l.value))setLive(l.value);
    setError(d.status==="rejected"||o.status==="rejected"||l.status==="rejected"
      ?"Some account projects could not be synchronized. Confirm that you are signed into the same account on desktop and mobile, then tap Sync names."
      :"");
    await refreshTrash().catch(()=>{});
   }catch{
    if(active)setError("Your projects could not be refreshed. Check your account and connection.");
   }finally{inFlight=false;if(active){setLoading(false);setSyncing(false);}}
  }
  const onVisibility=()=>{if(!document.hidden)void refresh();};
  const onFocus=()=>void refresh();
  void refresh(true);
  document.addEventListener("visibilitychange",onVisibility);
  window.addEventListener("focus",onFocus);
  // Mobile Safari may restore the Projects page from its back/forward cache.
  window.addEventListener("pageshow",onFocus);
  return()=>{
   active=false;
   document.removeEventListener("visibilitychange",onVisibility);
   window.removeEventListener("focus",onFocus);
   window.removeEventListener("pageshow",onFocus);
  };
 },[syncNonce]);
 // Old desktop versions kept generated-video titles in localStorage only.
 // Import each owned label once into the authenticated account database so
 // subsequent mobile/desktop sessions use the same server-authoritative name.
 useEffect(()=>{
  if(loading||migratingLabels.current||!Object.keys(labels).length)return;
  migratingLabels.current=true;
  let cancelled=false;
  void (async()=>{
   const remaining={...labels};
   for(const [key,raw] of Object.entries(labels)){
    if(cancelled)break;
    const name=typeof raw==="string"?raw.trim():"";
    if(!name||name.length>80){delete remaining[key];continue;}
    try{
     if(key.startsWith("live_")){
      const id=key.slice(5),p=live.find(x=>x.id===id);
      if(!p)continue;
      if(!p.displayName){
       const saved=await api<StudioProject>("studio-live",{
        method:"POST",body:JSON.stringify({action:"rename",id,name})
       });
       if(!cancelled)setLive(old=>old.map(x=>x.id===id?saved:x));
      }
     }else if(key.startsWith("order_")){
      const id=key.slice(6),o=orders.find(x=>x.orderId===id);
      if(!o)continue;
      if(!o.displayName){
       const response=await fetch("/api/customer-orders",{
        method:"PATCH",credentials:"same-origin",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({orderId:id,name})
       });
       if(!response.ok)throw Error("Legacy project name could not be synced.");
       if(!cancelled)setOrders(old=>old.map(x=>x.orderId===id?{...x,displayName:name}:x));
      }
     }
     // Draft names were already saved to the account by the previous editor.
     delete remaining[key];
     if(key.startsWith("live_"))try{localStorage.removeItem("sm-live-project-name:"+key.slice(5))}catch{}
    }catch{if(!cancelled)setError("Some older desktop names could not sync. Refresh this page after signing into the same account.");}
   }
   if(!cancelled){
    try{localStorage.setItem("sm-gallery-labels",JSON.stringify(remaining))}catch{}
    setLabels(remaining);
   }
   migratingLabels.current=false;
  })();
  return()=>{cancelled=true;migratingLabels.current=false};
 // Run after the first successful server load; do not restart on every name update.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[loading]);
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
       name:o.displayName?.trim()||d?.projectName?.trim()||d?.artistName||"Music video "+o.orderId.slice(0,8),
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
 const filtered=projects.map(p=>({...p,name:(p.kind==="admin"&&live.find(x=>"live_"+x.id===p.id)?.displayName)||(p.kind==="customer"&&orders.find(x=>"order_"+x.orderId===p.id)?.displayName)||p.name||labels[p.id]?.trim()||"Untitled project"})).filter(p=>
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
     <button type="button" className="sm-projects-sort" disabled={syncing} onClick={()=>setSyncNonce(n=>n+1)} aria-label="Sync project names from account" title="Sync account project names">
       <RefreshCw size={15}/><span className="sr-only">{syncing?"Syncing names…":"Sync names"}</span>
     </button>
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
              <button type="button" className="sm-projects-delete" disabled={busyId===item.id} title={item.kind==="customer"?"Remove from My Projects without deleting payment records":"Delete project"} onClick={()=>{setOpenOptionsId(null);void deleteProject(item);}}><Trash2 size={15}/> {busyId===item.id?"Removing…":item.kind==="customer"?"Remove":"Delete"}</button>
              {item.kind==="customer"&&<small>Payment records are retained.</small>}
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
      <summary><Trash2 size={17} aria-hidden="true"/> Recently deleted ({trash.length}) <span>Drafts: 30-day recovery · Paid orders: restorable</span></summary>
      <p className="sm-projects-trash-explain">Drafts and eligible private videos can be recovered for 30 days before retention-based cleanup. Removed paid orders are only hidden from My Projects and can be restored here; payment, provider and delivery records are retained.</p>
      {trashError&&<p className="sm-projects-error" role="alert">{trashError}</p>}
      {trash.length===0?<p className="sm-projects-trash-empty">No recoverable deleted projects.</p>:
       <ul>{trash.map(item=><li key={item.kind+"_"+item.id}>
         <div><strong>{item.name}</strong><small>{item.kind==="customer"?"Removed from My Projects · payment record kept":`Eligible for cleanup from: ${safeDate(item.purgeAfter||0)}`}</small></div>
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
