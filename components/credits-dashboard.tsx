"use client";

import Link from "next/link";
import {useEffect,useState} from "react";
import {creditTone} from "@/lib/commerce/credit-display";
import {CreditAmountPicker} from "@/components/credit-amount-picker";

type Ledger={id:string;credits:number;type:string;reference:string;created:number};
type Order={id:string;projectId:string;credits:number;euros:number;created:number;status:string};
type Purchase={id:string;credits:number;cents:number;status:string;created:number};
type Balance={availableCredits:number;reservedCredits:number;outstandingCredits:number;
 purchaseEnabled:boolean;testMode:boolean;entries:Ledger[];legacyOrders:Order[];purchases:Purchase[]};
type View="loading"|"signed-out"|"unavailable"|"ready";
const num=(n:number)=>new Intl.NumberFormat("de-DE").format(n);
const date=(n:number)=>new Date(n).toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"});
const eur=(n:number)=>new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR"}).format(n/100);

export function CreditsDashboard({mode}:{mode:"buy"|"usage"}){
 const [view,setView]=useState<View>("loading");
 const [balance,setBalance]=useState<Balance|null>(null);
 useEffect(()=>{
  let active=true;
  const refresh=()=>{
   void fetch("/api/credit-balance",{cache:"no-store",credentials:"same-origin"})
    .then(async response=>{
     if(response.status===401){if(active)setView("signed-out");return;}
     if(!response.ok)throw Error("Credits unavailable");
     const data=await response.json() as Balance;
     if(!Number.isSafeInteger(data.availableCredits)||data.availableCredits<0||
        !Number.isSafeInteger(data.reservedCredits)||data.reservedCredits<0||
        !Array.isArray(data.entries)||!Array.isArray(data.legacyOrders)||!Array.isArray(data.purchases))
      throw Error("Invalid account balance");
     if(active){setBalance(data);setView("ready");}
    }).catch(()=>{if(active)setView("unavailable");});
  };
  refresh();
  window.addEventListener("focus",refresh);
  window.addEventListener("credits-changed",refresh);
  return()=>{active=false;window.removeEventListener("focus",refresh);window.removeEventListener("credits-changed",refresh)};
 },[]);
 const tone=creditTone(view==="ready"?balance?.availableCredits??null:null);
 return <div className="sm-credits-layout">
  {view==="loading"&&<p role="status" className="sm-credits-message">Guthaben wird geladen …</p>}
  {view==="signed-out"&&<section className="sm-credits-notice">
   <h2>Bitte anmelden</h2><p>Credits und Aufträge gehören zu deinem persönlichen Konto.</p>
   <Link href="/login" className="sm-plan-action sm-plan-action-outline">Einloggen</Link>
  </section>}
  {view==="unavailable"&&<section className="sm-credits-notice" role="status">
   <h2>Guthaben derzeit nicht verfügbar</h2><p>Die Kontodaten konnten nicht überprüft werden. Es wurden keine Credits verändert.</p>
  </section>}
  {view==="ready"&&balance&&<>
   <section className="sm-credits-summary" aria-label="Aktuelles Guthaben">
    <div><span className="sm-credits-eyebrow">Verfügbare Credits</span>
     <strong className={`sm-credits-balance sm-credits-${tone}`} aria-live="polite">{num(balance.availableCredits)}</strong>
     <span className="sm-credits-reserved">{num(balance.reservedCredits)} reserviert</span>
     {balance.outstandingCredits>0&&<span className="sm-credits-muted">Offene Rückbuchung: {num(balance.outstandingCredits)} Credits</span>}
    </div>
    <div className="sm-credits-summary-links"><a href="#credits-kaufen">Credits kaufen</a><a href="#usage">Nutzung & Aufträge</a></div>
   </section>
   {mode==="buy"&&<section id="credits-kaufen"><CreditAmountPicker purchaseEnabled={balance.purchaseEnabled&&balance.testMode}/></section>}
   <section className="sm-credits-history" id="usage">
    <h2>Nutzung & Aufträge</h2>
    <p className="sm-credits-muted">Hier stehen deine echten Kreditbuchungen und bereits bezahlten Videoaufträge. Frühere Euro-Zahlungen werden als Credit-Gegenwert gezeigt – sie wurden nicht erneut vom Guthaben abgezogen.</p>
    <div className="sm-credits-history-section">
     <h3>Credit-Buchungen</h3>
     {balance.entries.length===0?<p className="sm-credits-empty">Noch keine Credit-Buchungen vorhanden.</p>:
      <ul>{balance.entries.map(entry=><li key={entry.id}>
       <span><strong>{entry.type==="purchase"?"Credits aufgeladen":entry.type==="video"?"Video mit Credits":entry.type==="refund"?"Rückerstattung":entry.type==="dispute"?"Zahlungsrückbuchung":"Credit-Buchung"}</strong>
       <small>{date(entry.created)} · {entry.reference.slice(0,24)}</small></span>
       <strong className={entry.credits>0?"sm-credits-positive":""}>{entry.credits>0?"+":""}{num(entry.credits)} Credits</strong>
      </li>)}</ul>}
    </div>
    <div className="sm-credits-history-section">
     <h3>Frühere Videoaufträge · Euro-Zahlung</h3>
     <p className="sm-credits-muted">Historische Käufe, nicht aus dem neuen Wallet bezahlt. Der Gegenwert dient nur zur Vergleichbarkeit.</p>
     {balance.legacyOrders.length===0?<p className="sm-credits-empty">Keine früher bezahlten Videoaufträge gefunden.</p>:
      <ul>{balance.legacyOrders.map(order=><li key={order.id}>
       <span><strong>Videoauftrag {order.projectId.slice(0,36)}</strong>
        <small>{date(order.created)} · {order.status==="delivered"?"Ausgeliefert":"Bezahlt / in Bearbeitung"} · {eur(order.euros)}</small>
       </span>
       <strong>≈ {num(order.credits)} Credits <small className="sm-credits-history-equivalent">Gegenwert</small></strong>
      </li>)}</ul>}
    </div>
    {balance.purchases.length>0&&<div className="sm-credits-history-section">
     <h3>Credit-Käufe</h3>
     <ul>{balance.purchases.map(p=><li key={p.id}><span><strong>{num(p.credits)} Credits</strong><small>{date(p.created)} · {p.status==="paid"?"Bezahlt":p.status==="reversed"?"Zurückgebucht":"Zahlung ausstehend"}</small></span><strong>{eur(p.cents)}</strong></li>)}</ul>
    </div>}
   </section>
  </>}
 </div>;
}
