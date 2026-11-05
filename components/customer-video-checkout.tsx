"use client";
import {useState} from "react";

export function CustomerVideoCheckout({orderId,staging}:{orderId:string;staging:boolean}){
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 async function pay(){
  if(busy||!/^[a-f0-9-]{36}$/.test(orderId))return;
  setBusy(true);setError("");
  try{
   const response=await fetch("/api/stripe-checkout",{
    method:"POST",credentials:"same-origin",cache:"no-store",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({orderId}),
   });
   const body=await response.json() as {url?:unknown;error?:string};
   if(!response.ok||typeof body.url!=="string")throw Error(body.error||"Checkout is unavailable.");
   const redirect=new URL(body.url);
   if(redirect.protocol!=="https:"||
      !["checkout.stripe.com","checkout.stripe.dev"].includes(redirect.hostname)||
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
  <button type="button" className="product-primary" disabled={busy} onClick={()=>void pay()}>
   {busy?"Opening secure checkout…":staging?"Pay with Stripe (test mode)":"Pay securely with Stripe"}
  </button>
  {error&&<p role="alert" className="error">{error}</p>}
 </div>;
}
