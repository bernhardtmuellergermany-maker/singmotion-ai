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
   if(!response.ok)throw Error(data.error||"Submission failed");
   setResult(data);
  }catch(e){setResult({error:e instanceof Error?e.message:"Submission failed"});}
  finally{setBusy(false);}
 }
 return <section className="sm-legal-panel" aria-labelledby="online-withdrawal-heading">
  <h2 id="online-withdrawal-heading">Withdraw from a contract</h2>
  <p>Submit a withdrawal declaration without signing in. We record its receipt and confirmation reference. Whether you have a statutory withdrawal right, and whether it has expired for your contract, is assessed separately. Sending this form does not automatically stop an AI job already processing.</p>
  {result?.accepted ? <div role="status"><p><strong>{result.message}</strong></p><p>Reference number: <strong>{result.id}</strong></p><p>Received at (UTC): <strong>{result.receivedAt}</strong></p>
   {!result.confirmationSent&&<p>Please keep this reference and contact <a href="mailto:support@singmotion.ai">support@singmotion.ai</a>, if you do not receive an email receipt.</p>}</div>:
   <form onSubmit={e=>{e.preventDefault();if(step===1)setStep(2);else void submit();}} style={{display:"grid",gap:"0.8rem"}}>
    <label>Consumer's name <input required minLength={2} maxLength={150} autoComplete="name" value={name} onChange={e=>{setName(e.target.value);setStep(1);}}/></label>
    <label>Contract / order number <input required minLength={2} maxLength={150} value={orderReference} onChange={e=>{setOrderReference(e.target.value);setStep(1);}}/></label>
    <label>Email address for confirmation <input required type="email" maxLength={254} autoComplete="email" value={email} onChange={e=>{setEmail(e.target.value);setStep(1);}}/></label>
    {step===2&&<p role="status">Please confirm: I withdraw from the contract <strong>{orderReference}</strong>. Please send the receipt to <strong>{email}</strong> gehen.</p>}
    {result?.error&&<p role="alert">{result.error}</p>}
    <div style={{display:"flex",gap:"0.8rem",flexWrap:"wrap"}}>
     {step===2&&<button type="button" onClick={()=>setStep(1)} disabled={busy}>Back</button>}
     <button type="submit" disabled={busy}>{busy?"Submitting…":step===2?"Confirm withdrawal":"Review withdrawal"}</button>
    </div>
   </form>}
  <p>Alternatively, you can send a clear withdrawal declaration to <a href="mailto:support@singmotion.ai">support@singmotion.ai</a> at any time.</p>
 </section>;
}
