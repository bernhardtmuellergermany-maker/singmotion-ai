"use client";

import Link from "next/link";
import {useEffect,useRef,useState} from "react";
import {creditTone} from "@/lib/commerce/credit-display";
import {CreditAmountPicker} from "@/components/credit-amount-picker";
import {CustomerFeedback} from "@/components/customer-feedback";
import {checkoutFeedback,type CustomerNotice} from "@/lib/live/customer-feedback";

type Ledger={id:string;credits:number;type:string;reference:string;created:number};
type Order={id:string;projectId:string;credits:number;euros:number;created:number;status:string};
type Purchase={id:string;credits:number;cents:number;status:string;created:number};
type VideoReservation={projectId:string;credits:number;state:"reserved"|"review";created:number};
type Balance={videoReservations?:VideoReservation[];availableCredits:number;reservedCredits:number;outstandingCredits:number;
 purchaseEnabled:boolean;testMode:boolean;entries:Ledger[];legacyOrders:Order[];purchases:Purchase[]};
type View="loading"|"signed-out"|"unavailable"|"ready";
type CreditResume={draftId:string;requiredCredits:number;created:number};
const RESUME_KEY="sm-credit-checkout-resume";
function readCreditResume():CreditResume|null {
 try{
  const value=JSON.parse(sessionStorage.getItem(RESUME_KEY)||"null") as CreditResume|null;
  if(!value||!/^[A-Za-z0-9_-]{1,80}$/.test(value.draftId)||
     !Number.isSafeInteger(value.requiredCredits)||value.requiredCredits<1||value.requiredCredits>7500||
     !Number.isFinite(value.created)||Date.now()-value.created>2*60*60*1000)return null;
  return value;
 }catch{return null;}
}
const num=(n:number)=>new Intl.NumberFormat("en-GB").format(n);
const date=(n:number)=>new Date(n).toLocaleDateString("en-GB",{day:"2-digit",month:"2-digit",year:"numeric"});
const eur=(n:number)=>new Intl.NumberFormat("en-GB",{style:"currency",currency:"EUR"}).format(n/100);

export function CreditsDashboard({mode}:{mode:"buy"|"usage"}){
 const [view,setView]=useState<View>("loading");
 const [balance,setBalance]=useState<Balance|null>(null);
 const [checkoutNotice,setCheckoutNotice]=useState<CustomerNotice|null>(null);
 const [resume,setResume]=useState<CreditResume|null>(null);
 const lastBroadcastBalance=useRef<number|null>(null);
 useEffect(()=>{
  let active=true;
  const params=new URLSearchParams(window.location.search);
  const checkoutResult=params.get("checkout");
  const draftId=params.get("resumeDraft");
  const required=Number(params.get("requiredCredits"));
  const resumeCandidate:CreditResume|null=
   draftId&&/^[A-Za-z0-9_-]{1,80}$/.test(draftId)&&
     Number.isSafeInteger(required)&&required>=1&&required<=7500
    ?{draftId,requiredCredits:required,created:Date.now()}
    :readCreditResume();
  if(resumeCandidate)sessionStorage.setItem(RESUME_KEY,JSON.stringify(resumeCandidate));
  setResume(resumeCandidate);
  let returnTimer:number|null=null,returnScheduled=false;
  setCheckoutNotice(checkoutFeedback(checkoutResult));
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
     if(active){
      setBalance(data);setView("ready");
      // Synchronize the header's credit counter after Stripe fulfillment.
      // Use a different event than the dashboard's own refresh trigger to avoid loops.
      if(lastBroadcastBalance.current!==data.availableCredits){
       lastBroadcastBalance.current=data.availableCredits;
       window.dispatchEvent(new Event("credit-balance-updated"));
      }
      // A Stripe success URL alone cannot authorize resuming a video.
      // Navigate only AFTER the signed-in account's server-verified wallet
      // contains the full quoted amount. The user still explicitly clicks
      // Generate Video on Step 4 (no automatic paid provider submission).
      if(checkoutResult==="success"&&resumeCandidate&&
         data.availableCredits>=resumeCandidate.requiredCredits&&!returnScheduled){
       returnScheduled=true;
       returnTimer=window.setTimeout(()=>{
        window.location.assign("/studio?draft="+encodeURIComponent(resumeCandidate.draftId)+"&resume=review");
       },1400);
      }
     }
    }).catch(()=>{if(active)setView("unavailable");});
  };
  refresh();
  let checks=0;
  let timer:number|null=null;
  if(checkoutResult==="success")timer=window.setInterval(()=>{
   if(document.visibilityState==="visible"){refresh();if(++checks>=12&&timer!==null)window.clearInterval(timer);}
  },5000);
  window.addEventListener("focus",refresh);
  window.addEventListener("credits-changed",refresh);
  window.addEventListener("pageshow",refresh);
  return()=>{active=false;if(timer!==null)window.clearInterval(timer);if(returnTimer!==null)window.clearTimeout(returnTimer);window.removeEventListener("focus",refresh);window.removeEventListener("credits-changed",refresh);window.removeEventListener("pageshow",refresh)};
 },[]);
 const tone=creditTone(view==="ready"?balance?.availableCredits??null:null);
 return <div className="sm-credits-layout">
  <CustomerFeedback notice={checkoutNotice} context="payment"/>
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
   {resume&&<section className="sm-credits-notice sm-credits-resume" aria-label="Continue your video project">
     <h2>Continue your video</h2>
     <p>Your Studio project is saved. {balance.availableCredits>=resume.requiredCredits
       ?"Your available Credits cover the video estimate. Continue to Step 4 and confirm generation."
       :`This video needs ${num(resume.requiredCredits)} available Credits. If your purchase is still being confirmed, the balance above will refresh automatically.`}</p>
     <Link href={`/studio?draft=${encodeURIComponent(resume.draftId)}&resume=review`} className="sm-plan-action sm-plan-action-outline"
       >Continue project · Step 4</Link>
   </section>}
   {mode==="buy"&&<section id="buy-credits"><CreditAmountPicker purchaseEnabled={balance.purchaseEnabled} testMode={balance.testMode}/></section>}
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
