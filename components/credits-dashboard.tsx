"use client";

import Link from "next/link";
import {useEffect,useState} from "react";
import {creditTone} from "@/lib/commerce/credit-display";
import {CreditAmountPicker} from "@/components/credit-amount-picker";

type Ledger={id:string;credits:number;type:string;reference:string;created:number};
type Order={id:string;projectId:string;credits:number;euros:number;created:number;status:string};
type Purchase={id:string;credits:number;cents:number;status:string;created:number};
type VideoReservation={projectId:string;credits:number;state:"reserved"|"review";created:number};
type Balance={videoReservations?:VideoReservation[];availableCredits:number;reservedCredits:number;outstandingCredits:number;
 purchaseEnabled:boolean;testMode:boolean;entries:Ledger[];legacyOrders:Order[];purchases:Purchase[]};
type View="loading"|"signed-out"|"unavailable"|"ready";
const num=(n:number)=>new Intl.NumberFormat("en-GB").format(n);
const date=(n:number)=>new Date(n).toLocaleDateString("en-GB",{day:"2-digit",month:"2-digit",year:"numeric"});
const eur=(n:number)=>new Intl.NumberFormat("en-GB",{style:"currency",currency:"EUR"}).format(n/100);

type AutoTopupState={enabled:boolean;available:boolean;discountPercent:number;preference:{threshold:number;amount:number;monthlyCap:number};message:string};
function AutoTopupPreferences(){
 const [state,setState]=useState<AutoTopupState|null>(null);
 const [form,setForm]=useState({threshold:500,amount:2000,monthlyCap:10000});
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState("");
 useEffect(()=>{let mounted=true;fetch("/api/credit-auto-topup",{cache:"no-store"})
  .then(async r=>{const data=await r.json() as AutoTopupState&{error?:string};if(!r.ok)throw Error(data.error||"Unavailable");return data;})
  .then(data=>{if(mounted){setState(data);setForm(data.preference);}})
  .catch(()=>{if(mounted)setNotice("Automatic top-up preferences are currently unavailable.");});
  return()=>{mounted=false;};
 },[]);
 const save=async()=>{
  setBusy(true);setNotice("");
  try{
   const r=await fetch("/api/credit-auto-topup",{method:"PUT",credentials:"same-origin",
    headers:{"Content-Type":"application/json"},body:JSON.stringify({...form,enabled:false})});
   const data=await r.json() as AutoTopupState&{error?:string};
   if(!r.ok)throw Error(data.error||"Could not save preferences");
   setState(data);setNotice("Preferences saved. Automatic payments remain off.");
  }catch(e){setNotice(e instanceof Error?e.message:"Preferences could not be saved");}
  finally{setBusy(false);}
 };
 return <section className="sm-auto-topup" aria-labelledby="sm-auto-topup-title">
  <div className="sm-auto-topup-head">
   <div><span className="sm-credits-eyebrow">Wallet automation</span><h2 id="sm-auto-topup-title">Automatic top-up</h2>
    <p>Set your preferred limits now. Automatic payments require a separate future opt-in and are not yet available.</p></div>
   <span className="sm-auto-topup-off">Not active</span>
  </div>
  <div className="sm-auto-topup-options">
   <label>Top up below
    <select value={form.threshold} onChange={e=>setForm(v=>({...v,threshold:Number(e.target.value)}))}>
     {[250,500,1000,2000].map(v=><option key={v} value={v}>{num(v)} credits</option>)}
    </select></label>
   <label>Top-up package
    <select value={form.amount} onChange={e=>setForm(v=>({...v,amount:Number(e.target.value),monthlyCap:[2000,10000,20000,40000].find(cap=>cap>=Math.max(v.monthlyCap,Number(e.target.value)))??40000}))}>
     {[2000,4000,10000].map(v=><option key={v} value={v}>{num(v)} credits · {eur(v)}</option>)}
    </select></label>
   <label>Monthly maximum
    <select value={form.monthlyCap} onChange={e=>setForm(v=>({...v,monthlyCap:Number(e.target.value)}))}>
     {[2000,10000,20000,40000].map(v=><option key={v} value={v} disabled={v<form.amount}>{num(v)} credits · {eur(v)}</option>)}
    </select></label>
  </div>
  <div className="sm-auto-topup-footer">
   <p>No automatic charges, no subscription, no active discount. A savings percentage is shown only when an approved offer actually exists.</p>
   <button type="button" disabled={busy||!state} onClick={()=>void save()}>{busy?"Saving…":"Save preferences"}</button>
  </div>
  {notice&&<p role="status" className="sm-auto-topup-notice">{notice}</p>}
 </section>;
}

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
    <div className="sm-credits-summary-links"><a href="#buy-credits">Buy Credits</a><a href="#usage">Usage & Orders</a></div>
   </section>
   {mode==="buy"&&<section id="buy-credits"><CreditAmountPicker purchaseEnabled={balance.purchaseEnabled&&balance.testMode}/></section>}
   {mode==="buy"&&<AutoTopupPreferences/>}
   <section className="sm-credits-history" id="usage">
    <h2>Usage & Orders</h2>
    <p className="sm-credits-muted">View your recorded credit transactions and previously paid video orders. Past euro payments are shown as a credit equivalent only; they have not been deducted from your balance again.</p>
    {(balance.videoReservations?.length??0)>0&&<div className="sm-credits-history-section">
      <h3>Video credit holds</h3>
      <p className="sm-credits-muted">Credits on hold are not yet spent. Uncertain provider outcomes remain reserved until verified and reconciled.</p>
      <ul>{balance.videoReservations?.map(hold=><li key={hold.projectId}>
        <span><strong>{hold.state==="review"?"Provider billing review":"Video generation in progress"}</strong>
        <small>{date(hold.created)} · {hold.projectId.slice(0,24)}</small></span>
        <strong>{num(hold.credits)} Credits reserved</strong>
      </li>)}</ul>
     </div>}
    <div className="sm-credits-history-section">
     <h3>Credit transactions</h3>
     {balance.entries.length===0?<p className="sm-credits-empty">No credit transactions recorded yet.</p>:
      <ul>{balance.entries.map(entry=><li key={entry.id}>
       <span><strong>{entry.type==="purchase"?"Credits purchased":entry.type==="video"?"Video paid with credits":entry.type==="video-release"?"Video credit hold released":entry.type==="refund"?"Refund":entry.type==="dispute"?"Payment dispute":"Credit adjustment"}</strong>
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
