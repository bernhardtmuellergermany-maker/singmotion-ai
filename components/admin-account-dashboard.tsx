"use client";
import {useState} from "react";
import Link from "next/link";
import {Activity,ArrowUpRight,ClipboardList,Gift,RefreshCw,ShieldCheck} from "lucide-react";
import type {AdminSupportOverview} from "@/lib/commerce/admin-support-overview";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Props={
 overview:AdminSupportOverview|null;
 busy:boolean;
 error:string;
 refresh:()=>void;
};
const dateTime=(time:number)=>new Date(time).toLocaleString("en-GB",{
 day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",
});
export function AdminAccountDashboard({overview,busy,error,refresh}:Props){
 const [search,setSearch]=useState("");
 const normalized=search.trim().replace(/^SM-/i,"");
 function openCase(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();
  if(!UUID.test(normalized))return;
  window.location.assign("/support-admin?id="+encodeURIComponent(normalized.toLowerCase()));
 }
 const counts=overview?.counts;
 return <section id="admin-console" className="sm-settings-section sm-settings-admin-dashboard" aria-label="Super Admin consoles and support status">
  <div className="sm-admin-dash-heading">
   <div>
    <span className="sm-settings-eyebrow">SUPER ADMIN ONLY</span>
    <h2>Consoles &amp; support status</h2>
    <p className="sm-settings-muted">Fast access to customer recovery, administration, and real recorded support updates.</p>
   </div>
   <button className="sm-admin-dash-refresh" type="button" onClick={refresh} disabled={busy}>
    <RefreshCw size={16} aria-hidden="true"/> {busy?"Checking…":"Refresh status"}
   </button>
  </div>
  <div className="sm-admin-dash-links" aria-label="Super Admin quick links">
   <Link href="/support-admin"><span className="sm-admin-dash-link-icon"><ClipboardList size={19}/></span>
    <span><strong>Customer Support Console</strong><small>Find order IDs, refund Credits, check Stripe, resolve cases</small></span><ArrowUpRight size={17} aria-hidden="true"/></Link>
   <Link href="/promo-admin"><span className="sm-admin-dash-link-icon"><Gift size={19}/></span>
    <span><strong>Promotion Console</strong><small>Manage promotions and campaign codes</small></span><ArrowUpRight size={17} aria-hidden="true"/></Link>
   <Link href="/admin"><span className="sm-admin-dash-link-icon"><ShieldCheck size={19}/></span>
    <span><strong>CMS &amp; staff admin</strong><small>Protected administrator dashboard</small></span><ArrowUpRight size={17} aria-hidden="true"/></Link>
  </div>
  <div className="sm-admin-dash-environments">
   <span>Other environments:</span>
   <a href="https://www.singmotion.ai/support-admin" target="_blank" rel="noopener noreferrer">Production console <ArrowUpRight size={14}/></a>
   <a href="https://singmotion-ai-staging.up.railway.app/support-admin" target="_blank" rel="noopener noreferrer">Staging console <ArrowUpRight size={14}/></a>
  </div>
  <form className="sm-admin-dash-find" onSubmit={openCase}>
    <label htmlFor="sm-admin-dash-case-id">Quick search: order or project ID</label>
    <div>
     <input id="sm-admin-dash-case-id" spellCheck={false} autoComplete="off" value={search}
       placeholder="xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx" onChange={e=>setSearch(e.target.value)}/>
     <button type="submit" disabled={!UUID.test(normalized)}>Open case</button>
    </div>
    <small>Opens the detailed case in the Support Console. Nothing is refunded or submitted by this search.</small>
  </form>
  <div className="sm-admin-dash-status-heading">
   <div><h3><Activity size={19} aria-hidden="true"/> Support status messages</h3>
    <p className="sm-settings-muted">{overview?
     `Source: ${overview.environment} · Checked ${dateTime(overview.checkedAt)}`:
     busy?"Checking the current environment…":
      "Status for the current environment is not available."}</p></div>
  </div>
  {overview?<>
   <div className="sm-admin-dash-metrics" aria-label="Recorded support status totals">
    <div><strong>{counts?.supportAlerts??0}</strong><span>Open support alerts</span></div>
    <div><strong>{counts?.paidUndelivered??0}</strong><span>Paid videos not delivered</span></div>
    <div><strong>{counts?.creditReviews??0}</strong><span>Credit reviews</span></div>
    <div><strong>{counts?.stripeRefundsPending??0}</strong><span>Stripe refunds pending</span></div>
    <div><strong>{counts?.emailsQueued??0}</strong><span>Emails awaiting delivery</span></div>
   </div>
   {overview.messages.length?<ul className="sm-admin-dash-events" aria-label="Recent verified support events">
    {overview.messages.map(event=><li key={event.id}>
     <span className="sm-admin-dash-event-main">
      <span className="sm-admin-dash-event-title">{event.text}</span>
      <Link href={"/support-admin?id="+encodeURIComponent(event.reference)} aria-label={"Open project or order "+event.reference}>
       Case {event.reference.slice(0,8).toUpperCase()} <ArrowUpRight size={13} aria-hidden="true"/>
      </Link>
     </span>
     <span className="sm-admin-dash-event-meta">{dateTime(event.at)}
      {event.emailState&&<span> · Email {event.emailState==="sent"?"sent":"queued"}</span>}
     </span>
    </li>)}
   </ul>:<p className="sm-admin-dash-empty">No recorded support messages in this environment yet. This does not verify external provider or deployment health.</p>}
  </>:<div className="sm-admin-dash-empty" role="status">
    {error||"Status is being checked. You can still open the consoles above."}
  </div>}
  <p className="sm-settings-muted sm-admin-dash-note">These are saved support and payment-workflow statuses, not Railway health checks. Each environment has separate case records and requires its own admin sign-in. Only the Support Console can issue an explicitly confirmed refund.</p>
 </section>;
}
