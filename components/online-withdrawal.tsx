"use client";
import {useState} from "react";
export function OnlineWithdrawal(){
 const [name,setName]=useState(""),[orderReference,setOrderReference]=useState(""),[email,setEmail]=useState("");
 const [step,setStep]=useState<1|2>(1),[busy,setBusy]=useState(false);
 const [result,setResult]=useState<{accepted?:boolean;id?:string;receivedAt?:string;confirmationSent?:boolean;message?:string;error?:string}|null>(null);
 async function submit(){
  if(busy)return;setBusy(true);setResult(null);
  try{
   const response=await fetch("/api/withdrawal",{method:"POST",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({name,orderReference,email})});
   const data=await response.json();
   if(!response.ok)throw Error(data.error||"Übermittlung fehlgeschlagen");
   setResult(data);
  }catch(e){setResult({error:e instanceof Error?e.message:"Übermittlung fehlgeschlagen"});}
  finally{setBusy(false);}
 }
 return <section className="sm-legal-panel" aria-labelledby="online-withdrawal-heading">
  <h2 id="online-withdrawal-heading">Vertrag widerrufen</h2>
  <p>Du kannst hier eine Widerrufserklärung abgeben, ohne dich anzumelden. Der Eingang wird dokumentiert; ob ein gesetzliches Widerrufsrecht besteht oder bereits erloschen ist, wird gesondert geprüft. Dies ist keine freie Stornierung eines begonnenen KI-Auftrags.</p>
  {result?.accepted ? <div role="status"><p><strong>{result.message}</strong></p><p>Vorgangsnummer: <strong>{result.id}</strong></p><p>Eingangszeit (UTC): <strong>{result.receivedAt}</strong></p>
   {!result.confirmationSent&&<p>Bitte speichere diesen Nachweis und kontaktiere zusätzlich <a href="mailto:support@singmotion.ai">support@singmotion.ai</a>, falls keine Eingangsbestätigung eintrifft.</p>}</div>:
   <form onSubmit={e=>{e.preventDefault();if(step===1)setStep(2);else void submit();}} style={{display:"grid",gap:"0.8rem"}}>
    <label>Name des Verbrauchers <input required minLength={2} maxLength={150} autoComplete="name" value={name} onChange={e=>{setName(e.target.value);setStep(1);}}/></label>
    <label>Vertrag / Bestellnummer <input required minLength={2} maxLength={150} value={orderReference} onChange={e=>{setOrderReference(e.target.value);setStep(1);}}/></label>
    <label>E-Mail für die Eingangsbestätigung <input required type="email" maxLength={254} autoComplete="email" value={email} onChange={e=>{setEmail(e.target.value);setStep(1);}}/></label>
    {step===2&&<p role="status">Bitte bestätige: Ich widerrufe den Vertrag <strong>{orderReference}</strong>. Die Eingangsbestätigung soll an <strong>{email}</strong> gehen.</p>}
    {result?.error&&<p role="alert">{result.error}</p>}
    <div style={{display:"flex",gap:"0.8rem",flexWrap:"wrap"}}>
     {step===2&&<button type="button" onClick={()=>setStep(1)} disabled={busy}>Zurück</button>}
     <button type="submit" disabled={busy}>{busy?"Wird übermittelt…":step===2?"Widerruf bestätigen":"Weiter zum Widerruf"}</button>
    </div>
   </form>}
  <p>Alternativ kannst du jederzeit eine eindeutige Erklärung an <a href="mailto:support@singmotion.ai">support@singmotion.ai</a> senden.</p>
 </section>;
}
