"use client";

import {useEffect, useState} from "react";
import {creditTone} from "@/lib/commerce/credit-display";
import "./account-credit-summary.css";

type Balance={availableCredits:number;reservedCredits:number};
type State="loading"|"ready"|"unavailable";
const display=(value:number)=>new Intl.NumberFormat("de-DE").format(value);

/** Real, account-scoped credits for customers; clearly marked fake preview for super admins. */
export function AccountCreditSummary({active,staff,superAdmin}:{active:boolean;staff:boolean;superAdmin:boolean}){
 const [balance,setBalance]=useState<Balance|null>(null);
 const [state,setState]=useState<State>("loading");
 const [testCredits,setTestCredits]=useState(1500);
 useEffect(()=>{
  if(!active||staff)return;
  let mounted=true;
  const refresh=()=>{
   void fetch("/api/credit-balance",{cache:"no-store",credentials:"same-origin"})
    .then(async response=>{
     if(!response.ok)throw Error("Balance unavailable");
     const data=await response.json() as Partial<Balance>;
     if(typeof data.availableCredits!=="number"||!Number.isSafeInteger(data.availableCredits)||data.availableCredits<0||
        typeof data.reservedCredits!=="number"||!Number.isSafeInteger(data.reservedCredits)||data.reservedCredits<0)
       throw Error("Invalid credit balance");
     if(mounted){setBalance({availableCredits:data.availableCredits,reservedCredits:data.reservedCredits});setState("ready");}
    })
    .catch(()=>{if(mounted){setBalance(null);setState("unavailable");}});
  };
  refresh();
  window.addEventListener("focus",refresh);
  window.addEventListener("credits-changed",refresh);
  return()=>{mounted=false;window.removeEventListener("focus",refresh);window.removeEventListener("credits-changed",refresh)};
 },[active,staff]);

 const available=superAdmin?testCredits:!staff&&state==="ready"?balance?.availableCredits??null:null;
 const tone=creditTone(available);
 return <section className="sm-account-credit-summary" aria-label="Current account credits" role="status">
  <span className="sm-account-credit-caption">{superAdmin?"SUPER ADMIN · TESTVORSCHAU":"Aktuelle Credits"}</span>
  <strong className={`sm-account-credit-number sm-account-credit-${tone}`}>
   {available===null?"—":display(available)}
   <small>{superAdmin?"Test-Credits":"Credits"}</small>
  </strong>
  <p className="sm-account-credit-note">{superAdmin
    ?"Simuliertes Guthaben – keine echten Credits oder Kundendaten."
    :staff?"Für Staff-Konten ist kein Kunden-Guthaben hinterlegt."
    :state==="ready"&&balance
      ?display(balance.reservedCredits)+" Credits reserviert"
      :state==="loading"?"Guthaben wird geladen …"
      :"Guthaben aktuell nicht verfügbar."}</p>
  {superAdmin&&<div className="sm-account-credit-preview-options" role="group" aria-label="Test balance colors">
   {[0,500,1500].map(value=><button type="button" key={value}
    aria-pressed={testCredits===value}
    onClick={()=>setTestCredits(value)}>{display(value)}</button>)}
  </div>}
 </section>;
}
