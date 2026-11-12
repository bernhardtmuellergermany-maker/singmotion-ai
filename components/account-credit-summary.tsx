"use client";
import {useEffect,useState} from "react";
import {creditTone} from "@/lib/commerce/credit-display";
import "./account-credit-summary.css";
type Balance={availableCredits:number;reservedCredits:number};
type State="loading"|"ready"|"unavailable";
const display=(n:number)=>new Intl.NumberFormat("de-DE").format(n);
/** Customers and CMS super-admins get the exact same authenticated wallet UI. */
export function AccountCreditSummary({active}:{active:boolean;staff?:boolean;superAdmin?:boolean}){
 const [balance,setBalance]=useState<Balance|null>(null);
 const [state,setState]=useState<State>("loading");
 useEffect(()=>{
  if(!active)return;
  let mounted=true;
  const refresh=()=>{
   void fetch("/api/credit-balance",{cache:"no-store",credentials:"same-origin"})
    .then(async response=>{
     if(!response.ok)throw Error("Balance unavailable");
     const data=await response.json() as Partial<Balance>;
     if(typeof data.availableCredits!=="number"||!Number.isSafeInteger(data.availableCredits)||data.availableCredits<0||
        typeof data.reservedCredits!=="number"||!Number.isSafeInteger(data.reservedCredits)||data.reservedCredits<0)
      throw Error("Invalid balance");
     if(mounted){setBalance({availableCredits:data.availableCredits,reservedCredits:data.reservedCredits});setState("ready");}
    }).catch(()=>{if(mounted){setBalance(null);setState("unavailable");}});
  };
  refresh();
  window.addEventListener("focus",refresh);
  window.addEventListener("credits-changed",refresh);
  return()=>{mounted=false;window.removeEventListener("focus",refresh);window.removeEventListener("credits-changed",refresh)};
 },[active]);
 const available=state==="ready"?balance?.availableCredits??null:null;
 return <section className="sm-account-credit-summary" aria-label="Aktuelle Credits" role="status">
  <span className="sm-account-credit-caption">Aktuelle Credits</span>
  <strong className={`sm-account-credit-number sm-account-credit-${creditTone(available)}`}>
   {available===null?"—":display(available)}<small>Credits</small>
  </strong>
  <p className="sm-account-credit-note">{state==="ready"&&balance
   ?display(balance.reservedCredits)+" Credits reserviert"
   :state==="loading"?"Guthaben wird geladen …":"Guthaben aktuell nicht verfügbar."}</p>
 </section>;
}
