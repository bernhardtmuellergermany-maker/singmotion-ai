"use client";

import {useEffect,useRef,useState} from "react";
import type {CustomerInsight} from "@/lib/commerce/customer-insights";

type Gift={id:string;customerId:string;credits:number;reason:string;created:number;actor:string;campaignId:string|null;reversedAt:number|null};
type GiftListing={enabled:boolean;gifts:Gift[];summary?:{count:number;credits:number;referenceValueCents:number};
 limits?:{maxPerGrant:number;maxActor24h:number;maxGlobal24h:number}};
const choices:{id:string;label:string}[]=[
 {id:"welcome",label:"Willkommensgeschenk"},{id:"goodwill",label:"Kulanz"},
 {id:"compensation",label:"Kundenentschädigung"},{id:"marketing",label:"Marketingaktion"},
 {id:"influencer",label:"Influencer-Kooperation"},{id:"vip",label:"VIP-Geschenk"},
 {id:"other",label:"Sonstiges"},
];
const n=(value:number)=>new Intl.NumberFormat("de-DE").format(value);
const date=(value:number)=>new Date(value).toLocaleString("de-DE",{timeZone:"Europe/Berlin",dateStyle:"short",timeStyle:"short"});
export function CustomerCreditGift({customer,onBooked}:{customer:CustomerInsight;onBooked:()=>void}){
 const [overview,setOverview]=useState<GiftListing|null>(null);
 const [open,setOpen]=useState(false);
 const [amount,setAmount]=useState("1000");
 const [reason,setReason]=useState("welcome");
 const [note,setNote]=useState("");
 const [campaignId,setCampaignId]=useState("");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [success,setSuccess]=useState("");
 const [confirmation,setConfirmation]=useState(false);
 const [correction,setCorrection]=useState<Gift|null>(null);
 const [correctionReason,setCorrectionReason]=useState("");
 const [correctionAccepted,setCorrectionAccepted]=useState(false);
 const correctionKey=useRef<string|null>(null);
 const requestKey=useRef<string|null>(null);
 const [balance,setBalance]=useState(customer.availableCredits);
 const load=async()=>{
  const response=await fetch("/api/admin-credit-gifts?customerId="+encodeURIComponent(customer.id),
   {credentials:"same-origin",cache:"no-store"});
  if(!response.ok)throw Error("Gutschriften können gerade nicht geladen werden.");
  setOverview(await response.json() as GiftListing);
 };
 useEffect(()=>{let mounted=true;
  setOverview(null);setBalance(customer.availableCredits);setSuccess("");setError("");setOpen(false);
  void fetch("/api/admin-credit-gifts?customerId="+encodeURIComponent(customer.id),
   {credentials:"same-origin",cache:"no-store"}).then(async response=>{
    if(!response.ok)throw Error("Gutschriften können gerade nicht geladen werden.");
    return await response.json() as GiftListing;
   }).then(result=>{if(mounted)setOverview(result)})
    .catch(()=>{if(mounted)setError("Der geschützte Gutschrift-Dienst ist nicht erreichbar.")});
  return()=>{mounted=false};
 },[customer.id]);
 const credits=/^[1-9][0-9]*$/.test(amount)&&Number.isSafeInteger(Number(amount))?Number(amount):null;
 const max=overview?.limits?.maxPerGrant??0;
 const valid=credits!==null&&credits<=max;
 const close=()=>{if(busy)return;setOpen(false);setError("");setConfirmation(false)};
 const begin=()=>{setOpen(true);setError("");setSuccess("");setConfirmation(false);requestKey.current=crypto.randomUUID();};
 const submit=async()=>{
  if(!overview?.enabled||!valid||!credits||busy||!confirmation)return;
  setBusy(true);setError("");setSuccess("");
  try{
   // Key remains identical if the request times out; only a changed form starts a new intent.
   const key=requestKey.current??=crypto.randomUUID();
   const response=await fetch("/api/admin-credit-gifts",{method:"POST",credentials:"same-origin",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action:"grant",customerId:customer.id,credits,reason,
     note:note.trim()||null,campaignId:campaignId.trim()||null,
     requestKey:key,confirmation:"GIFT "+credits+" "+customer.id}),
   });
   const body=await response.json() as {error?:string;availableCredits?:number;replayed?:boolean};
   if(!response.ok)throw Error(body.error||"Gutschrift konnte nicht bestätigt werden.");
   if(typeof body.availableCredits!=="number")throw Error("Buchungsergebnis nicht bestätigt. Bitte Verlauf prüfen.");
   setBalance(body.availableCredits);
   setSuccess((body.replayed?"Bereits gebucht: ":"Erfolgreich: ")+"+"+n(credits)+" Credits");
   setOpen(false);setConfirmation(false);
   await load();
   onBooked();
  }catch(e){setError(e instanceof Error?e.message:"Buchung nicht bestätigt. Mit derselben Referenz erneut versuchen.")}
  finally{setBusy(false)}
 };
 const executeCorrection=async()=>{
  if(!correction||correctionReason.trim().length<20||!correctionAccepted||busy)return;
  setBusy(true);setError("");
  try{
   const response=await fetch("/api/admin-credit-gifts",{method:"POST",credentials:"same-origin",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action:"correct",giftId:correction.id,reason:correctionReason,
     requestKey:(correctionKey.current??=crypto.randomUUID()),
     confirmation:"CORRECT "+correction.id})});
   const body=await response.json() as {availableCredits?:number;error?:string};
   if(!response.ok||typeof body.availableCredits!=="number")
    throw Error(body.error||"Korrektur nicht bestätigt. Dieselbe Referenz erneut prüfen.");
   setBalance(body.availableCredits);
   setSuccess("Korrektur verbucht. Verfügbar: "+n(body.availableCredits)+" Credits.");
   setCorrection(null);setCorrectionAccepted(false);
   await load();onBooked();
  }catch(e){setError(e instanceof Error?e.message:"Korrektur fehlgeschlagen");}
  finally{setBusy(false)}
 };
 // A different form must not accidentally reuse the same request identity.
 const change=()=>{requestKey.current=crypto.randomUUID();setConfirmation(false);setError("")};
 return <section className="sm-admin-gifts" aria-label="Manuelle Geschenk-Credits">
  <div className="sm-admin-gifts-heading"><div><h3>Geschenk-Credits</h3>
   <p>Direkte Ledger-Gutschrift ohne Stripe. Rechnerischer Wert, kein Umsatz.</p></div>
   <button type="button" disabled={!overview?.enabled} onClick={begin}>Credits gutschreiben</button>
  </div>
  {overview?.enabled===false&&<p role="status">Administrative Credit-Geschenke sind in dieser Railway-Umgebung gesperrt. Aktivierung erst nach Staging-Freigabe.</p>}
  {error&&!open&&<p role="alert" className="sm-insights-error">{error}</p>}
  {success&&<p role="status" className="sm-admin-gifts-success">{success} · Aktuell {n(balance)} verfügbar.</p>}
  {overview?.enabled&&<div className="sm-admin-gifts-meta">
   <span>Einzellimit: {n(max)} Credits</span>
   <span>Gesamt verschenkt: {n(overview.summary?.credits??0)} Credits</span>
   <a href="/api/admin-credit-gifts?format=csv" download>CSV-Export ohne E-Mails</a>
  </div>}
  {overview?.gifts?.length? <div className="sm-admin-gifts-history">
   <strong>Einzelgutschriften an diesen Kunden</strong>
   <ul>{overview.gifts.map(g=><li key={g.id}><span>{date(g.created)} · {g.reason} · <code>{g.id}</code>
    {g.reversedAt&&<small> Sicher korrigiert: {date(g.reversedAt)}</small>}</span>
    <b>+{n(g.credits)}</b>
    {!g.reversedAt&&<button type="button" onClick={()=>{
     setCorrection(g);setCorrectionReason("");setCorrectionAccepted(false);
     correctionKey.current=crypto.randomUUID();setError("");setOpen(false);
    }}>Korrektur prüfen</button>}</li>)}</ul>
  </div>:null}
  {correction&&<div className="sm-gift-modal-backdrop" role="presentation">
   <section className="sm-gift-dialog" role="dialog" aria-modal="true" aria-label="Gutschrift korrigieren">
    <h3>Gesonderte Korrekturbuchung</h3>
    <p>Originalbuchung <code>{correction.id}</code>: +{n(correction.credits)} Credits.
     Der Originaleintrag bleibt unverändert erhalten.</p>
    <p>Wenn Credits bereits verwendet oder reserviert sind, blockiert der Server die Korrektur. Eine Videogenerierung wird niemals zurückgenommen.</p>
    <label>Dokumentierter Korrekturgrund (mindestens 20 Zeichen)
     <textarea rows={3} maxLength={1000} value={correctionReason}
      onChange={e=>{setCorrectionReason(e.target.value);correctionKey.current=crypto.randomUUID();setCorrectionAccepted(false)}}/></label>
    <label className="sm-gift-confirm"><input type="checkbox" checked={correctionAccepted}
     onChange={e=>setCorrectionAccepted(e.target.checked)}/> Ich bestätige die gesonderte Negativbuchung von {n(correction.credits)} Credits, sofern ausreichend Guthaben frei verfügbar ist.</label>
    {error&&<p role="alert" className="sm-insights-error">{error}</p>}
    <div className="sm-gift-actions"><button type="button" disabled={busy} onClick={()=>{setCorrection(null);setError("")}}>Abbrechen</button>
    <button type="button" disabled={busy||!correctionAccepted||correctionReason.trim().length<20}
      onClick={()=>void executeCorrection()}>Korrektur bestätigen</button></div>
   </section>
  </div>}
  {open&&<div className="sm-gift-modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}>
   <section className="sm-gift-dialog" role="dialog" aria-modal="true" aria-label="Credits an Kunden verschenken">
    <div className="sm-gift-dialog-head"><h3>Credits an Kunden verschenken</h3>
     <button type="button" onClick={close} disabled={busy} aria-label="Schließen">×</button></div>
    <p><strong>Kunde:</strong> <span className="sm-gift-email">{customer.email}</span></p>
    <p><strong>Kunden-ID:</strong> <code>{customer.id}</code></p>
    <p>Verfügbar: <strong>{n(balance)} Credits</strong> · Reserviert: {n(customer.reservedCredits)}</p>
    <label>Anzahl Credits
     <input type="number" step="1" min="1" max={max} value={amount}
      onChange={e=>{setAmount(e.target.value);change()}}/></label>
    <div className="sm-gift-quick-amounts">{[100,250,500,1000,2500,5000].map(v=><button key={v}
     type="button" disabled={v>max} aria-pressed={amount===String(v)}
     onClick={()=>{setAmount(String(v));change()}}>{n(v)}</button>)}</div>
    <label>Grund der Gutschrift
     <select value={reason} onChange={e=>{setReason(e.target.value);change()}}>
      {choices.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
    <label>Interne Notiz (für Kunden nicht sichtbar)
     <textarea rows={2} maxLength={1000} value={note} onChange={e=>{setNote(e.target.value);change()}}/></label>
    <label>Optionale Kampagnen-ID (UUID)
     <input type="text" value={campaignId} onChange={e=>{setCampaignId(e.target.value);change()}}
      placeholder="Nur bei zugehöriger Kampagne" maxLength={36}/></label>
    <div className="sm-gift-preview" aria-live="polite">
     <span>Gutschrift: <strong>{valid?"+"+n(credits!)+" Credits":"Ungültige Anzahl"}</strong></span>
     <span>Voraussichtlich verfügbar: <strong>{valid?n(balance+credits!):"—"} Credits</strong></span>
     <small>Rechnerischer Gegenwert {valid?new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR"}).format(credits!/100):"—"}. Vor Buchung prüft der Server den aktuellen Wallet-Saldo erneut.</small>
    </div>
    <label className="sm-gift-confirm"><input type="checkbox" checked={confirmation}
     onChange={e=>setConfirmation(e.target.checked)}/> Ich bestätige diese kostenfreie Einzelgutschrift an das ausgewählte Bestandskonto.</label>
    {error&&<p role="alert" className="sm-insights-error">{error}</p>}
    <div className="sm-gift-actions"><button type="button" disabled={busy} onClick={close}>Abbrechen</button>
     <button type="button" disabled={!valid||!confirmation||busy} onClick={()=>void submit()}>
      {busy?"Buchung wird geprüft…":"Gutschrift bestätigen"}</button></div>
   </section>
  </div>}
 </section>;
}
