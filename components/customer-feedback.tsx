"use client";

import {useEffect,useState} from "react";
import {AlertCircle,CheckCircle2,Info,WifiOff,X} from "lucide-react";
import type {CustomerNotice} from "@/lib/live/customer-feedback";
import "./customer-feedback.css";

/** In-flow, responsive feedback. Unsettled financial/provider states are never timed away. */
export function CustomerFeedback({
  notice,context="generation",watchConnection=true,
}:{
  notice:CustomerNotice|null;
  context?:"generation"|"upload"|"payment";
  watchConnection?:boolean;
}){
  const [online,setOnline]=useState(true);
  const [dismissed,setDismissed]=useState<string|null>(null);
  useEffect(()=>{
    if(!watchConnection)return;
    const update=()=>setOnline(navigator.onLine);
    update();
    window.addEventListener("online",update);
    window.addEventListener("offline",update);
    return()=>{window.removeEventListener("online",update);window.removeEventListener("offline",update);};
  },[watchConnection]);
  useEffect(()=>{
    if(!notice?.dismissAfterMs)return;
    const timer=window.setTimeout(()=>setDismissed(notice.key),notice.dismissAfterMs);
    return()=>window.clearTimeout(timer);
  },[notice?.key,notice?.dismissAfterMs]);

  const disconnected:CustomerNotice|null=watchConnection&&!online?{
    key:"connection-offline",kind:"warning",title:"You're offline",
    message:context==="payment"?
      "Your checkout status may be unknown. When connected, check your Credits before paying again.":
      context==="upload"?
        "Your audio or photo may not have reached SingMotion. Reconnect and check the Studio before retrying the upload.":
        "Your saved video status cannot be refreshed. Reconnect and check this project; do not start a second paid generation.",
  }:null;
  const active=disconnected??notice;
  if(!active||(!disconnected&&dismissed===active.key))return null;
  const isCritical=active.kind==="error"||active.kind==="warning";
  return <section className={"sm-customer-feedback is-"+active.kind}
      role={isCritical?"alert":"status"} aria-live={isCritical?"assertive":"polite"} aria-atomic="true">
    <span className="sm-customer-feedback-icon" aria-hidden="true">
      {disconnected?<WifiOff size={20}/>:active.kind==="success"?<CheckCircle2 size={20}/>:active.kind==="info"?<Info size={20}/>:<AlertCircle size={20}/>}
    </span>
    <div className="sm-customer-feedback-body">
      <strong>{active.title}</strong>
      <p>{active.message}</p>
      {active.action&&<a className="sm-customer-feedback-action" href={active.action.href}>{active.action.label} <span aria-hidden="true">→</span></a>}
    </div>
    {!disconnected&&active.dismissAfterMs&&
      <button type="button" className="sm-customer-feedback-close" onClick={()=>setDismissed(active.key)} aria-label="Dismiss notification"><X size={17}/></button>}
  </section>;
}
