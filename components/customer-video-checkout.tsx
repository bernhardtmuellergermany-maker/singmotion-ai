"use client";
import {useState} from "react";

export function CustomerVideoCheckout({orderId,staging}:{orderId:string;staging:boolean}){
 const [busy,setBusy]=useState(false);
 const [immediateStart,setImmediateStart]=useState(false);
 const [acknowledged,setAcknowledged]=useState(false);
 const [error,setError]=useState("");
 async function pay(){
  if(busy||!immediateStart||!acknowledged||!/^[a-f0-9-]{36}$/.test(orderId))return;
  setBusy(true);setError("");
  try{
   const response=await fetch("/api/stripe-checkout",{
    method:"POST",credentials:"same-origin",cache:"no-store",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({orderId,immediateStart,acknowledgedWithdrawalConsequences:acknowledged}),
   });
   const body=await response.json() as {url?:unknown;error?:string};
   if(!response.ok||typeof body.url!=="string")throw Error(body.error||"Checkout is unavailable.");
   const redirect=new URL(body.url);
   if(redirect.protocol!=="https:"||
      redirect.hostname!=="checkout.stripe.com"||
      redirect.username||redirect.password)throw Error("Invalid Stripe Checkout destination.");
   // Only a server-verified Stripe Checkout URL is allowed; never accept a
   // browser-supplied price, payment status or arbitrary redirect.
   window.location.assign(redirect.href);
  }catch(e){
   setError(e instanceof Error?e.message:"Unable to create secure Checkout.");
   setBusy(false);
  }
 }
 return <div aria-label="Secure customer video payment">
  {staging&&<p role="status">Protected test checkout: Stripe test payment, real BytePlus generation after verified settlement.</p>}
  <fieldset style={{marginBlock:"1rem",display:"grid",gap:"0.8rem"}}>
   <legend>Produktionsbeginn und gesetzliches Widerrufsrecht</legend>
   <label><input type="checkbox" checked={immediateStart} onChange={e=>setImmediateStart(e.target.checked)} disabled={busy}/>{" "}Ich stimme ausdrücklich zu und verlange, dass SingMotion nach erfolgreicher Zahlung vor Ablauf der gesetzlichen Widerrufsfrist mit der Erstellung meines Videos beginnt.</label>
   <label><input type="checkbox" checked={acknowledged} onChange={e=>setAcknowledged(e.target.checked)} disabled={busy}/>{" "}Ich bestätige meine Kenntnis: Sofern mein Vertrag die Bereitstellung nicht auf einem körperlichen Datenträger gelieferter digitaler Inhalte betrifft, erlischt mein gesetzliches Widerrufsrecht unter den gesetzlichen Voraussetzungen durch meine Zustimmung mit Beginn der Ausführung; bei Dienstleistungen gelten andere Voraussetzungen, insbesondere die vollständige Erbringung. Meine gesetzlichen Ansprüche bei Fehlern oder Nichtlieferung bleiben bestehen.</label>
   <p>Informationen: <a href="/withdrawal" target="_blank" rel="noopener noreferrer">Widerrufsbelehrung und Musterformular</a>. Eine bereits begonnene KI-Produktion kann nicht frei als Auftrag storniert werden. Gesetzliche Widerrufs- und Mängelrechte bleiben unberührt.</p>
  </fieldset>
  <button type="button" className="product-primary" disabled={busy||!immediateStart||!acknowledged} onClick={()=>void pay()}>
   {busy?"Opening secure checkout…":staging?"Pay with Stripe (test mode)":"Pay securely with Stripe"}
  </button>
  {error&&<p role="alert" className="error">{error}</p>}
 </div>;
}
