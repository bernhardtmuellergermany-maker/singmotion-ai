"use client";
import {useEffect,useState} from "react";
import {Bell,Send} from "lucide-react";
type Category="update"|"offer"|"important";
type RecordItem={id:string;title:string;message:string;category:Category;published_at:number};
export function AdminAnnouncements(){
 const [title,setTitle]=useState("");
 const [message,setMessage]=useState("");
 const [category,setCategory]=useState<Category>("update");
 const [history,setHistory]=useState<RecordItem[]>([]);
 const [recipients,setRecipients]=useState<number|null>(null);
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState(false);
 const [feedback,setFeedback]=useState("");
 const [requestId,setRequestId]=useState("");
 useEffect(()=>{let alive=true;fetch("/api/admin-announcements",{cache:"no-store",credentials:"same-origin"})
  .then(async r=>{if(!r.ok)throw Error("Announcement history unavailable.");return r.json() as Promise<{announcements:RecordItem[];recipientCount:number}>})
  .then(data=>{if(alive){setHistory(data.announcements);setRecipients(data.recipientCount)}})
  .catch(()=>{if(alive)setFeedback("Could not load announcement history.")})
  .finally(()=>{if(alive)setLoading(false)});
  return()=>{alive=false};
 },[]);
 async function publish(){
  if(saving||title.trim().length<4||message.trim().length<10)return;
  if(!window.confirm("Publish this in-app notification to ALL registered SingMotion AI accounts? This cannot be undone for existing recipients."))return;
  const id=requestId||crypto.randomUUID();
  setRequestId(id);
  setSaving(true);setFeedback("");
  try{
   const r=await fetch("/api/admin-announcements",{method:"POST",credentials:"same-origin",
    headers:{"Content-Type":"application/json"},body:JSON.stringify({id,title,message,category})});
   const response=await r.json() as {published?:boolean;error?:string};
   if(!r.ok||response.published!==true)throw Error(response.error||"Could not publish announcement.");
   setHistory(prev=>[{id,title:title.trim(),message:message.trim(),category,published_at:Date.now()},...prev.filter(item=>item.id!==id)].slice(0,30));
   setFeedback("Announcement published to all registered accounts.");
   setTitle("");setMessage("");setCategory("update");setRequestId("");
   window.dispatchEvent(new Event("notifications-changed"));
  }catch(e){setFeedback(e instanceof Error?e.message:"Announcement publishing failed.")}
  finally{setSaving(false)}
 }
 return <section className="sm-settings-section sm-admin-announcements" id="announcements">
  <h2><Bell size={21} aria-hidden="true"/> Notifications · Announcements</h2>
  <p className="sm-settings-muted">Publish an in-app announcement to all accounts. Recipients see it in Notifications; no emails are sent.</p>
  <div className="sm-announcement-form">
   <label>Message category
    <select value={category} onChange={e=>{setCategory(e.target.value as Category);setRequestId("")}}>
     <option value="update">Product update</option>
     <option value="offer">Special offer</option>
     <option value="important">Important announcement</option>
    </select>
   </label>
   <label>Title
    <input maxLength={100} minLength={4} placeholder="What's new at SingMotion AI?" value={title} onChange={e=>{setTitle(e.target.value);setRequestId("")}}/>
   </label>
   <label>Message
    <textarea maxLength={2000} minLength={10} rows={5} placeholder="Write your announcement…" value={message} onChange={e=>{setMessage(e.target.value);setRequestId("")}}/>
   </label>
   <div className="sm-announcement-preview"><span>PREVIEW · {category==="offer"?"SPECIAL OFFER":category==="important"?"IMPORTANT":"PRODUCT UPDATE"}</span><strong>{title.trim()||"Your announcement title"}</strong><p>{message.trim()||"Your message will appear here."}</p></div>
   <p className="sm-settings-muted">Audience: all registered accounts{recipients!==null?` · ${recipients} customer accounts currently registered`:""}. Announcements are also visible to Super Admins.</p>
   <button type="button" onClick={()=>void publish()} disabled={saving||loading||title.trim().length<4||message.trim().length<10}><Send size={16}/> {saving?"Publishing…":"Publish to all accounts"}</button>
   {feedback&&<p role="status" className="sm-announcement-feedback">{feedback}</p>}
  </div>
  <h3>Published announcements</h3>
  {loading?<p className="sm-settings-muted">Loading…</p>:history.length===0?<p className="sm-settings-muted">No announcements published yet.</p>:
   <ul className="sm-announcement-history">{history.map(item=><li key={item.id}><strong>{item.title}</strong><span>{item.category} · {new Date(item.published_at).toLocaleString("en-GB")}</span><p>{item.message}</p></li>)}</ul>}
 </section>;
}
