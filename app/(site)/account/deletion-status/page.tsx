"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
type Status={state:string;issue:string|null;requestedAt:number;completedAt:number|null;
 refundedCents:number;pendingCents:number;done:boolean};
const words:Record<string,string>={
 requested:"Your deletion request has been received",
 refunding:"Refunding unused purchased Credits",
 "removing-media":"Removing your projects, photos, audio and videos",
 "removing-data":"Removing your login and account data",
 completed:"Your account has been deleted",
 "needs-attention":"Your request needs additional verification"
};
export default function DeletionStatusPage(){
 const [status,setStatus]=useState<Status|null>(null);
 const [error,setError]=useState("");
 useEffect(()=>{
  let active=true,interval:ReturnType<typeof setInterval>|null=null;
  const refresh=async()=>{
   try{
    const response=await fetch("/api/customer-erasure-status",{cache:"no-store",credentials:"same-origin"});
    if(!response.ok)throw Error(response.status===401?"Deletion confirmation is no longer available in this browser. Contact privacy support if you need help.":"Could not verify the deletion status.");
    const value=await response.json() as Status;
    if(!active)return;
    setStatus(value);setError("");
    if(value.done&&interval!==null){clearInterval(interval);interval=null}
   }catch(e){if(active)setError(e instanceof Error?e.message:"Deletion status is unavailable.")}
  };
  void refresh();
  interval=setInterval(()=>{void refresh()},8000);
  return()=>{active=false;if(interval!==null)clearInterval(interval)};
 },[]);
 const money=(cents:number)=>(cents/100).toLocaleString("en-IE",{style:"currency",currency:"EUR"});
 return <main style={{minHeight:"70vh",maxWidth:760,margin:"0 auto",padding:"62px 22px",color:"#ebe5f3"}}>
  <p style={{color:"#aa95cb",fontSize:13,fontWeight:700,letterSpacing:".1em"}}>ACCOUNT PRIVACY</p>
  <h1 style={{fontSize:"clamp(1.55rem,4vw,2.3rem)",marginBottom:18}}>Account deletion</h1>
  {status?<section aria-live="polite" style={{padding:24,border:"1px solid #514460",borderRadius:15,background:"#171525"}}>
   <h2 style={{fontSize:19,marginBottom:12}}>{words[status.state]||"Verifying your request"}</h2>
   {status.done?<p>Your account, login sessions and eligible private media have been erased. Financial records required for legal and tax compliance remain in Stripe or in minimized payment records. Backup copies expire on their documented lifecycle.</p>:
    status.state==="needs-attention"?
    <p>The system could not independently verify every step. It has not claimed your account is fully deleted. Your account remains unavailable to prevent new purchases or media activity; no duplicate refund is permitted. Please contact <a href="mailto:support@singmotion.ai?subject=Account%20deletion%20status">privacy support</a> with your deletion receipt if the status does not resolve.</p>:
    <p>We are processing and verifying your refund and private media removal. You can close this tab and return later in the same browser. Your old login sessions have been revoked.</p>}
   {(status.refundedCents>0||status.pendingCents>0)&&<p style={{marginTop:20}}>
    Confirmed Stripe refunds: <strong>{money(status.refundedCents)}</strong>
    {status.pendingCents>0&&<> · Awaiting confirmation: <strong>{money(status.pendingCents)}</strong></>}
   </p>}
   {!status.done&&<p style={{fontSize:12,marginTop:12,color:"#bfb1d0"}}>This page checks the status automatically. Pending bank/card refunds can take longer than a web request. An unfinished step is never reported as completed.</p>}
  </section>:<p>Checking your deletion request…</p>}
  {error&&<p role="alert" style={{color:"#f9a5ae",marginTop:14}}>{error}</p>}
  <p style={{marginTop:25}}><Link href="/" style={{color:"#cda6ff"}}>Back to SingMotion AI</Link></p>
 </main>;
}
