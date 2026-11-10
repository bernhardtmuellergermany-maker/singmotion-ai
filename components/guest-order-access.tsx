"use client";
import {useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import {api} from "@/lib/client";

/** The public order number is never an access credential. A lost guest link
 * can only be recovered through a fresh, single-use emailed token. */
export function GuestOrderAccess({id}:{id:string}){
 const [message,setMessage]=useState("Du benötigst deinen privaten Bestelllink. Du kannst ihn über die Bestell-E-Mail wiederherstellen.");
 const [email,setEmail]=useState("");
 const [busy,setBusy]=useState(false);
 const router=useRouter();
 useEffect(()=>{
  const query=new URLSearchParams(location.hash.slice(1));
  const token=query.get("access"),recovery=query.get("recover");
  if(!token&&!recovery)return;
  history.replaceState(null,"",location.pathname+location.search);
  if(token){
   void api("guest-order",{method:"POST",body:JSON.stringify({id,token})})
    .then(()=>router.refresh())
    .catch(()=>setMessage("Der private Bestelllink ist ungültig oder abgelaufen. Bitte nutze die E-Mail-Wiederherstellung."));
   return;
  }
  void fetch("/api/customer-guest-video-recovery",{
   method:"POST",headers:{"Content-Type":"application/json"},
   body:JSON.stringify({action:"redeem",orderId:id,token:recovery}),
  }).then(async r=>{
   const data=await r.json();
   if(!r.ok)throw Error(data.error||"Wiederherstellung fehlgeschlagen");
   router.refresh();
  }).catch(e=>setMessage(e instanceof Error?e.message:"Wiederherstellung fehlgeschlagen"));
 },[id,router]);
 async function recover(e:import("react").FormEvent<HTMLFormElement>){
  e.preventDefault();if(busy)return;
  setBusy(true);
  try{
   const response=await fetch("/api/customer-guest-video-recovery",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action:"request",orderId:id,email}),
   });
   const result=await response.json();
   if(!response.ok)throw Error(result.error||"Zugang derzeit nicht verfügbar");
   setMessage(result.message||"Bitte prüfe dein E-Mail-Postfach.");
  }catch(e){setMessage(e instanceof Error?e.message:"Wiederherstellung fehlgeschlagen")}
  finally{setBusy(false)}
 }
 return <section aria-label="Private Gastbestellung wiederherstellen">
  <p role="status">{message}</p>
  <form onSubmit={e=>void recover(e)}>
   <label htmlFor="guest-recovery-email">E-Mail deiner Videobestellung</label>
   <input id="guest-recovery-email" type="email" autoComplete="email" required
    value={email} onChange={e=>setEmail(e.target.value)} maxLength={254} disabled={busy}/>
   <button type="submit" className="product-secondary" disabled={busy}>
    {busy?"Zugang wird angefordert…":"Einmaligen Zugangslink per E-Mail senden"}
   </button>
  </form>
  <p>Deine Auftragsnummer allein genügt nicht zum Download. Jeder Wiederherstellungslink ist nur einmal gültig.</p>
 </section>;
}
