"use client";

import {useId,useState} from "react";
import {MAX_CREDIT_TOPUP,MIN_CREDIT_TOPUP,parseCreditTopup,proposedTopupCents} from "@/lib/commerce/credit-topup-quote";
import "./credit-amount-picker.css";
const presets=[2000,4000,10000] as const;
const num=(n:number)=>new Intl.NumberFormat("de-DE").format(n);
const euro=(n:number)=>new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR"}).format(n/100);

/** UI quote only; server decides the actual Stripe amount, and only in TEST. */
export function CreditAmountPicker({purchaseEnabled=false}:{purchaseEnabled?:boolean}){
 const [raw,setRaw]=useState("2000");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const inputId=useId();
 const credits=parseCreditTopup(raw),cents=credits===null?null:proposedTopupCents(credits);
 const begin=async()=>{
  if(!purchaseEnabled||credits===null||busy)return;
  setBusy(true);setError("");
  try{
   const response=await fetch("/api/credit-checkout",{
    method:"POST",credentials:"same-origin",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({credits:String(credits),requestKey:crypto.randomUUID()}),
   });
   const data=await response.json() as {url?:string;error?:string;testMode?:boolean};
   if(!response.ok||!data.testMode||typeof data.url!=="string"||
      !/^https:\/\/checkout\.stripe\.com\//.test(data.url))
    throw Error(data.error||"Stripe-Testkauf konnte nicht gestartet werden.");
   window.location.assign(data.url);
  }catch(e){setError(e instanceof Error?e.message:"Stripe-Testkauf fehlgeschlagen.");setBusy(false);}
 };
 return <div className="sm-credit-amount-picker" aria-label="Credits kaufen">
  <div className="sm-credit-amount-heading"><div><h2>Credits kaufen</h2>
   <p>Wähle ein Paket oder gib deine gewünschte Credit-Anzahl selbst ein.</p></div>
   {purchaseEnabled&&<span className="sm-credit-amount-tag">Stripe Testmodus</span>}
  </div>
  <div className="sm-credit-presets" aria-label="Credit-Pakete">
   {presets.map(amount=><button key={amount} type="button" aria-pressed={raw===String(amount)}
    className={raw===String(amount)?"sm-credit-preset selected":"sm-credit-preset"}
    onClick={()=>setRaw(String(amount))}>
    <strong>{num(amount)}</strong><span>Credits</span><small>{euro(amount)}</small>
   </button>)}
  </div>
  <div className="sm-credit-amount-field">
   <label htmlFor={inputId}>Eigene Credit-Anzahl eingeben</label>
   <div className="sm-credit-amount-control"><input id={inputId} inputMode="numeric" type="number" step="1"
    min={MIN_CREDIT_TOPUP} max={MAX_CREDIT_TOPUP} value={raw}
    onChange={e=>{setRaw(e.target.value);setError("");}}
    aria-invalid={credits===null} aria-describedby={inputId+"-hint"}/><span>Credits</span></div>
   <p id={inputId+"-hint"} className={credits===null?"sm-credit-amount-error":"sm-credit-amount-helper"}>
    {credits===null?"Bitte 500 bis 100.000 ganze Credits eingeben.":"1 Credit = 0,01 €."}</p>
  </div>
  <div className="sm-credit-amount-total" aria-live="polite">
   <div><span>Credits</span><strong>{credits===null?"—":num(credits)}</strong></div>
   <div><span>Preis (inkl. MwSt.)</span><strong>{cents===null?"—":euro(cents)}</strong></div>
  </div>
  {purchaseEnabled?<button type="button" className="sm-credit-amount-disabled sm-credit-buy-enabled" disabled={busy||credits===null} onClick={()=>void begin()}>
   {busy?"Stripe wird geöffnet …":"Testkauf mit Stripe"}
  </button>:<div className="sm-credit-amount-disabled" aria-disabled="true">Credit-Kauf noch nicht freigeschaltet</div>}
  {error&&<p role="alert" className="sm-credit-amount-error">{error}</p>}
  <p className="sm-credit-amount-footer">{purchaseEnabled
   ?"Nur Stripe-Testmodus. Testkartendaten statt echtem Geld; keine Live-Belastung. Credit-Gutschrift nur nach bestätigter Testzahlung."
   :"Die Beträge sind vorerst eine unverbindliche Preisübersicht. Live-Zahlungen sind gesperrt."}</p>
 </div>;
}
