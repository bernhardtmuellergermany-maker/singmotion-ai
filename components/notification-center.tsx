"use client";
import {useCallback,useEffect,useState} from "react";
import Link from "next/link";
import {Bell,CheckCheck,Mail,MailOpen,Trash2,CheckCircle2,Film,Wallet,PlayCircle} from "lucide-react";
import "./notifications.css";
type Notice={id:string;title:string;message:string;created:number;read:boolean;kind:"payment"|"video"|"announcement";href:string};
type Inbox={notifications:Notice[];unread:number};
export default function NotificationCenter(){
 const [inbox,setInbox]=useState<Inbox>({notifications:[],unread:0});
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const refresh=useCallback(async()=>{
  const r=await fetch("/api/notifications",{credentials:"same-origin",cache:"no-store"});
  if(r.status===401)throw Error("Please log in to see your notifications.");
  if(!r.ok)throw Error("Could not load notifications.");
  const data=await r.json() as Inbox;
  if(!Array.isArray(data.notifications))throw Error("Notifications unavailable.");
  setInbox(data);window.dispatchEvent(new Event("notifications-changed"));
 },[]);
 useEffect(()=>{let alive=true;(async()=>{try{await refresh()}catch(e){if(alive)setError(e instanceof Error?e.message:"Notifications unavailable.")}finally{if(alive)setLoading(false)}})();return()=>{alive=false}},[refresh]);
 async function apply(action:"read"|"unread"|"delete"|"read-all"|"clear-all",id?:string){
  if(busy)return;
  if(action==="clear-all"&&!window.confirm("Remove all notifications from your inbox?"))return;
  setBusy(true);setError("");
  try {
   const r=await fetch("/api/notifications",{method:"POST",credentials:"same-origin",
    headers:{"Content-Type":"application/json"},body:JSON.stringify({action,id})});
   const response=await r.json() as Inbox&{error?:string};
   if(!r.ok||!Array.isArray(response.notifications))throw Error(response.error||"Could not update notifications.");
   setInbox(response);window.dispatchEvent(new Event("notifications-changed"));
  }catch(e){setError(e instanceof Error?e.message:"Could not update notifications.")}
  finally{setBusy(false)}
 }
 return <main className="sm-notifications-page" id="content">
  <div className="sm-notifications-container">
   <div className="sm-notifications-heading"><div>
    <span className="sm-notifications-kicker">SINGMOTION AI · ACCOUNT</span>
    <h1>Notifications<span>.</span></h1>
    <p>Private updates about your credits, payments, videos and SingMotion AI.</p>
   </div><Bell size={25} aria-hidden="true"/></div>
   <section className="sm-notifications-panel" aria-label="Your notifications">
    <div className="sm-notifications-toolbar"><span>{inbox.unread} unread</span>
     <div><button disabled={busy||inbox.unread===0} onClick={()=>void apply("read-all")}><CheckCheck size={16}/> Mark all as read</button>
      <button disabled={busy||inbox.notifications.length===0} onClick={()=>void apply("clear-all")}><Trash2 size={16}/> Clear all</button></div>
    </div>
    {error&&<p role="alert" className="sm-notifications-error">{error}</p>}
    {loading?<p className="sm-notifications-empty">Loading notifications…</p>:
     inbox.notifications.length===0?<div className="sm-notifications-empty"><CheckCircle2 size={27}/><p>You're all caught up.</p><small>New account and video updates will appear here.</small></div>:
     <ul className="sm-notifications-list">{inbox.notifications.map(item=><li key={item.id} className={item.read?"sm-notice-read":"sm-notice-unread"}>
      <div className="sm-notice-icon">{item.kind==="video"?<Film size={18}/>:item.kind==="payment"?<Wallet size={18}/>:<Bell size={18}/>}</div>
      <div className="sm-notice-body">
       <div className="sm-notice-title">{!item.read&&<span className="sm-notice-dot" aria-label="Unread"/>}<strong>{item.title}</strong></div>
       <p>{item.message}</p>
       {item.kind==="video"&&/^\/projects\/live_[a-f0-9-]{36}$/i.test(item.href)&&
        <Link href={item.href} className="sm-notice-video-link" aria-label={"Open video for "+item.message}>
         <PlayCircle size={16} aria-hidden="true"/> View video
        </Link>}
       <small>{new Date(item.created).toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"})}</small>
      </div>
      <div className="sm-notice-actions">
       <button disabled={busy} aria-label={item.read?"Mark unread":"Mark read"} title={item.read?"Mark unread":"Mark read"} onClick={()=>void apply(item.read?"unread":"read",item.id)}>{item.read?<MailOpen size={17}/>:<Mail size={17}/>}</button>
       <button disabled={busy} aria-label="Delete notification" title="Delete" onClick={()=>void apply("delete",item.id)}><Trash2 size={17}/></button>
      </div>
     </li>)}</ul>}
   </section>
   <p className="sm-notifications-footnote">Removing a notification does not delete your payment, refund or video history.</p>
  </div>
 </main>;
}
