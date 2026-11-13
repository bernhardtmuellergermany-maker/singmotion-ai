"use client";

import {useId,useRef,useState} from "react";
import {CustomerFeedback} from "@/components/customer-feedback";
import {requestErrorFeedback,type CustomerNotice} from "@/lib/live/customer-feedback";
import {MAX_CREDIT_TOPUP,MIN_CREDIT_TOPUP,parseCreditTopup,proposedTopupCents} from "@/lib/commerce/credit-topup-quote";
import "./credit-amount-picker.css";
const presets=[2000,4000,10000] as const;
const num=(n:number)=>new Intl.NumberFormat("en-GB").format(n);
const euro=(n:number)=>new Intl.NumberFormat("en-GB",{style:"currency",currency:"EUR"}).format(n/100);

/** UI quote only; server decides the actual Stripe amount, and only in TEST. */
export function CreditAmountPicker({purchaseEnabled=false,testMode=true}:{purchaseEnabled?:boolean;testMode?:boolean}){
 const [raw,setRaw]=useState("2000");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const requestKey=useRef<string|null>(null);
 const [status,setStatus]=useState<CustomerNotice|null>(null);
 const inputId=useId();
 const credits=parseCreditTopup(raw),cents=credits===null?null:proposedTopupCents(credits);
 const begin=async()=>{
  if(!purchaseEnabled||credits===null||busy)return;
  setBusy(true);setError("");setStatus(null);
  try{
   const response=await fetch("/api/credit-checkout",{
    method:"POST",credentials:"same-origin",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({credits:String(credits),requestKey:(requestKey.current??=crypto.randomUUID())}),
   });
   const data=await response.json() as {url?:string;error?:string;testMode?:boolean;supportReference?:string};
   if(!response.ok||data.testMode!==testMode||typeof data.url!=="string"||
      !/^https:\/\/checkout\.stripe\.com\//.test(data.url))
    throw Error((data.error||"Stripe test checkout could not be started.")+
     (typeof data.supportReference==="string"&&/^req_[A-Za-z0-9]+$/.test(data.supportReference)
       ?" Stripe support reference: "+data.supportReference:""));
   window.location.assign(data.url);
  }catch(e){
   const message=e instanceof Error?e.message:"Stripe test checkout failed.";
   setError(message);setStatus(requestErrorFeedback(message,"payment"));setBusy(false);
  }
 };
 return <div className="sm-credit-amount-picker" aria-label="Buy Credits">
  <div className="sm-credit-amount-heading"><div><h2>Buy Credits</h2>
   <p>Choose a package or enter exactly how many credits you want.</p></div>
   {purchaseEnabled&&<span className="sm-credit-amount-tag">{testMode?"Stripe Test Mode":"Secure Stripe Checkout"}</span>}
  </div>
  <div className="sm-credit-presets" aria-label="Credit packages">
   {presets.map(amount=><button key={amount} type="button" aria-pressed={raw===String(amount)}
    className={raw===String(amount)?"sm-credit-preset selected":"sm-credit-preset"}
    onClick={()=>{setRaw(String(amount));setError("");setStatus(null);requestKey.current=null;}}>
    <strong>{num(amount)}</strong><span>Credits</span><small>{euro(amount)}</small>
   </button>)}
  </div>
  <div className="sm-credit-amount-field">
   <label htmlFor={inputId}>Enter a custom credit amount</label>
   <div className="sm-credit-amount-control"><input id={inputId} inputMode="numeric" type="number" step="1"
    min={MIN_CREDIT_TOPUP} max={MAX_CREDIT_TOPUP} value={raw}
    onChange={e=>{setRaw(e.target.value);setError("");setStatus(null);requestKey.current=null;}}
    aria-invalid={credits===null} aria-describedby={inputId+"-hint"}/><span>Credits</span></div>
   <p id={inputId+"-hint"} className={credits===null?"sm-credit-amount-error":"sm-credit-amount-helper"}>
    {credits===null?"Enter 500 to 100,000 whole credits.":"1 Credit = €0.01."}</p>
  </div>
  <div className="sm-credit-amount-total" aria-live="polite">
   <div><span>Credits</span><strong>{credits===null?"—":num(credits)}</strong></div>
   <div><span>Estimated total (incl. VAT)</span><strong>{cents===null?"—":euro(cents)}</strong></div>
  </div>
  {purchaseEnabled?<button type="button" className="sm-credit-amount-disabled sm-credit-buy-enabled" disabled={busy||credits===null} onClick={()=>void begin()}>
   {busy?"Opening Stripe…":testMode?"Test purchase with Stripe":"Buy securely with Stripe"}
  </button>:<div className="sm-credit-amount-disabled" aria-disabled="true">Credit purchases are not yet available</div>}
  <CustomerFeedback notice={status??(busy?{key:"checkout-opening",kind:"info",title:"Opening secure checkout",message:"Please keep this page open. Credits are added only after verified payment."}:null)} context="payment"/>
  {error&&/req_[A-Za-z0-9]+/.test(error)&&<p className="sm-credit-amount-error">If support is needed, share the Stripe reference shown above your checkout request.</p>}
  <p className="sm-credit-amount-footer">{purchaseEnabled
   ?testMode?"Stripe Test Mode only: use test card details. No real money is charged. Credits are added only after Stripe confirms payment.":"One-time payment through Stripe. Credits are added only after verified payment. There are no automatic top-ups or recurring charges."
   :"These prices are for information only. Live payments are not enabled. No automatic payments will be taken."}</p>
 </div>;
}
