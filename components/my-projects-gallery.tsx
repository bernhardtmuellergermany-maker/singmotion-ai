"use client";
import {useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {ArrowDownToLine,ArrowUpDown,CalendarDays,Check,ChevronDown,
 Clapperboard,Clock3,Eye,Film,FolderOpen,Image as ImageIcon,
 MoreHorizontal,Plus,Search,SlidersHorizontal,SquarePen,Video,Copy} from "lucide-react";
import {api,ensureSession} from "@/lib/client";
import type {StudioProject} from "@/lib/live/studio";
import "./my-projects-gallery.css";

type Tab="all"|"draft"|"processing"|"completed";
type ProjectStatus="draft"|"processing"|"completed"|"review"|"awaiting-payment";
type SavedDraft={
 id:string;projectName?:string;artistName:string;
 selection:{imageId?:string;outputFormat?:string;start:number;end:number};
 updated:number;
};
type CustomerOrder={
 orderId:string;projectId:string;status:string;fulfillmentState:string|null;
 videoReady:number;created:number;outputFormat?:string|null;durationSeconds?:number|null;
};
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
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [tab,setTab]=useState<Tab>("all");
 const [search,setSearch]=useState("");
 const [newest,setNewest]=useState(true);
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
   }catch{
    if(active)setError("Your private projects could not be loaded. Please sign in or reopen Studio.");
   }finally{if(active)setLoading(false);}
  }
  void refresh();return()=>{active=false};
 },[]);
 const projects=useMemo(()=>{
   const combined:ProjectItem[]=[];
   const draftNames=new Map(drafts.map(d=>[d.id,d]));
   const linked=new Set(orders.map(o=>o.projectId));
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
     combined.push({
       id:"live_"+p.id,kind:"admin",
       name:p.projectName?.trim()||p.artistName||"BytePlus video",
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
 const filtered=projects.filter(p=>
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
     <Link className="sm-projects-new" href="/studio"><Plus size={21}/> New video</Link>
   </div>
   <div className="sm-projects-toolbar">
     <label className="sm-projects-search"><Search size={19}/><input type="search" value={search} onChange={e=>setSearch(e.target.value)}
       placeholder="Search your projects…" aria-label="Search projects and support IDs"/></label>
     <div className="sm-projects-filters" aria-label="Project status filters" role="group">
       {([{id:"all",label:"All projects"},{id:"draft",label:"Drafts"},{id:"processing",label:"Processing"},{id:"completed",label:"Completed"}] as const).map(item=>
         <button key={item.id} type="button" aria-pressed={tab===item.id} className={tab===item.id?"is-active":""} onClick={()=>setTab(item.id)}>{item.label} ({counts[item.id]})</button>
       )}
     </div>
     <button type="button" className="sm-projects-sort" onClick={()=>setNewest(v=>!v)} aria-label="Toggle project sorting">
       <ArrowUpDown size={16}/>{newest?"Newest first":"Oldest first"}<ChevronDown size={14}/>
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
            <div className="sm-projects-meta"><span><Video size={13}/>{item.format} · {item.duration>0?`${Math.round(item.duration)} sec`:"—"}</span>
              <span><CalendarDays size={13}/>{safeDate(item.date)}</span></div>
          </div>
        </Link>
        <details className="sm-projects-options">
          <summary aria-label={`More options for ${item.name}`} title="Project options"><MoreHorizontal size={18}/></summary>
          <div className="sm-projects-options-menu">
            <Link href={item.href}>Open project</Link>
            {item.supportId&&<button type="button" onClick={()=>void navigator.clipboard?.writeText(item.supportId!)}><Copy size={13}/> Copy support ID</button>}
            {item.providerId&&<button type="button" onClick={()=>void navigator.clipboard?.writeText(item.providerId!)}><Copy size={13}/> Copy BytePlus ID</button>}
          </div>
        </details>
        <Link className="sm-projects-action" href={item.href} aria-label={item.status==="draft"?"Continue editing":item.status==="completed"?"Open video":item.status==="review"?"Open review":"Check video status"}>
          {item.status==="draft"?<SquarePen size={17}/>:item.status==="completed"?<ArrowDownToLine size={17}/>:item.status==="review"?<Eye size={17}/>:<Clock3 size={17}/>}
        </Link>
        {item.supportId&&<div className="sm-projects-support" title={`Support ID: ${item.supportId}`}>
          <span>Support ID</span><code>{item.supportId.slice(0,8)}…</code>
          {item.providerId&&<span title={`BytePlus task: ${item.providerId}`}> · BytePlus: {item.providerId.length>16?item.providerId.slice(0,12)+"…":item.providerId}</span>}
        </div>}
      </article>)}
    </div>:
    <div className="sm-projects-empty">
      <FolderOpen size={34}/><h2>{projects.length?"No matching projects":"Your first video starts here."}</h2>
      <p>{projects.length?"Try another search or status filter.":"Upload your music and artist photo to create your first project."}</p>
      {!projects.length&&<Link href="/studio">Create a video</Link>}
    </div>}
 </div>;
}
