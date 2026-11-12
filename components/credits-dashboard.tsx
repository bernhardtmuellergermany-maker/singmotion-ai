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
const num=(n:number)=>new Intl.NumberFormat("en-GB").format(n);
const date=(n:number)=>new Date(n).toLocaleDateString("en-GB",{day:"2-digit",month:"2-digit",year:"numeric"});
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
  {view==="loading"&&<p role="status" className="sm-credits-message">Checking your credit balance…</p>}
  {view==="signed-out"&&<section className="sm-credits-notice">
   <h2>Sign in to continue</h2><p>Credits and orders belong to your personal account.</p>
   <Link href="/login" className="sm-plan-action sm-plan-action-outline">Sign in</Link>
  </section>}
  {view==="unavailable"&&<section className="sm-credits-notice" role="status">
   <h2>Balance currently unavailable</h2><p>Your account balance could not be verified. No credits were changed.</p>
  </section>}
  {view==="ready"&&balance&&<>
   <section className="sm-credits-summary" aria-label="Current credit balance">
    <div><span className="sm-credits-eyebrow">Available credits</span>
     <strong className={`sm-credits-balance sm-credits-${tone}`} aria-live="polite">{num(balance.availableCredits)}</strong>
     <span className="sm-credits-reserved">{num(balance.reservedCredits)} credits reserved</span>
     {balance.outstandingCredits>0&&<span className="sm-credits-muted">Outstanding reversal: {num(balance.outstandingCredits)} Credits</span>}
    </div>
    <div className="sm-credits-summary-links"><a href="#credits-kaufen">Buy Credits</a><a href="#usage">Usage & Orders</a></div>
   </section>
   {mode==="buy"&&<section id="credits-kaufen"><CreditAmountPicker purchaseEnabled={balance.purchaseEnabled&&balance.testMode}/></section>}
   <section className="sm-credits-history" id="usage">
    <h2>Usage & Orders</h2>
    <p className="sm-credits-muted">View your recorded credit transactions and previously paid video orders. Past euro payments are shown as a credit equivalent only; they have not been deducted from your balance again.</p>
    <div className="sm-credits-history-section">
     <h3>Credit transactions</h3>
     {balance.entries.length===0?<p className="sm-credits-empty">No credit transactions recorded yet.</p>:
      <ul>{balance.entries.map(entry=><li key={entry.id}>
       <span><strong>{entry.type==="purchase"?"Credits purchased":entry.type==="video"?"Video paid with credits":entry.type==="refund"?"Refund":entry.type==="dispute"?"Payment dispute":"Credit adjustment"}</strong>
       <small>{date(entry.created)} · {entry.reference.slice(0,24)}</small></span>
       <strong className={entry.credits>0?"sm-credits-positive":""}>{entry.credits>0?"+":""}{num(entry.credits)} Credits</strong>
      </li>)}</ul>}
    </div>
    <div className="sm-credits-history-section">
     <h3>Previous video orders · paid in euros</h3>
     <p className="sm-credits-muted">Historical payments were not charged to the new credit wallet. The equivalent is shown for comparison only.</p>
     {balance.legacyOrders.length===0?<p className="sm-credits-empty">No previously paid video orders found.</p>:
      <ul>{balance.legacyOrders.map(order=><li key={order.id}>
       <span><strong>Video order {order.projectId.slice(0,36)}</strong>
        <small>{date(order.created)} · {order.status==="delivered"?"Delivered":"Paid / processing"} · {eur(order.euros)}</small>
       </span>
       <strong>≈ {num(order.credits)} Credits <small className="sm-credits-history-equivalent">Equivalent only</small></strong>
      </li>)}</ul>}
    </div>
    {balance.purchases.length>0&&<div className="sm-credits-history-section">
     <h3>Credit purchases</h3>
     <ul>{balance.purchases.map(p=><li key={p.id}><span><strong>{num(p.credits)} Credits</strong><small>{date(p.created)} · {p.status==="paid"?"Paid":p.status==="reversed"?"Reversed":"Payment pending"}</small></span><strong>{eur(p.cents)}</strong></li>)}</ul>
    </div>}
   </section>
  </>}
 </div>;
}
