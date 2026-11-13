"use client";
import {useEffect,useState} from "react";
import "./support-admin.css";

type Case={
 id:string;type:"stripe-order"|"credit-video"|"studio-project"|"credit-topup";
 customerEmail:string|null;state:string;created:number;projectId:string;
 details:Record<string,string|number|boolean|null>;
 refundable:boolean;refundReason:string;caseStatus:"open"|"resolved";
 resolvedAt:number|null;
};
const cleanId=(v:string)=>v.trim().replace(/^SM-/i,"").toLowerCase();
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function loadCase(value:string):Promise<Case>{
 const reference=cleanId(value);
 if(!UUID.test(reference))throw Error("Enter the complete order or project ID.");
 const reply=await fetch("/api/support-admin?id="+encodeURIComponent(reference),
   {cache:"no-store",credentials:"same-origin"});
 const json=await reply.json() as {case?:Case;error?:string};
 if(!reply.ok||!json.case)throw Error(json.error??"Support status unavailable.");
 return json.case;
}
const confirmFor=(action:string,id:string)=>{
 const prefix=action==="refund-credits"?"RETURN":action==="refund-stripe"?"REFUND":"RESOLVE";
 return prefix+" "+id.toUpperCase();
};
export function SupportAdmin(){
 const [id,setId]=useState("");
 const [record,setRecord]=useState<Case|null>(null);
 const [reason,setReason]=useState("");
 const [confirm,setConfirm]=useState("");
 const [action,setAction]=useState<"refund-credits"|"refund-stripe"|"resolve"|null>(null);
 const [error,setError]=useState("");
 const [message,setMessage]=useState("");
 const [busy,setBusy]=useState(false);
 async function fetchCase(value:string){
  const result=await loadCase(value);
  setRecord(result);setId(result.id);return result;
 }
 // Read-only deep link from the private Account Settings status messages.
 // Never pre-authorize a refund, resolve a case or trigger provider generation.
 useEffect(()=>{
  const requested=new URLSearchParams(window.location.search).get("id");
  if(!requested||!UUID.test(cleanId(requested)))return;
  let mounted=true;
  const reference=cleanId(requested);
  void loadCase(reference).then(result=>{
   if(mounted){setRecord(result);setId(result.id);}
  }).catch(err=>{
   if(mounted)setError(err instanceof Error?err.message:"Case unavailable");
  }).finally(()=>{if(mounted)setBusy(false)});
  return()=>{mounted=false};
 },[]);
 async function search(e:React.FormEvent){
  e.preventDefault();setBusy(true);setError("");setMessage("");setRecord(null);setAction(null);
  try{await fetchCase(id)}catch(e){setError(e instanceof Error?e.message:"Search failed")}
  finally{setBusy(false)}
 }
 async function execute(e:React.FormEvent){
  e.preventDefault();
  if(!record||!action||busy)return;
  setBusy(true);setError("");setMessage("");
  try{
   const reply=await fetch("/api/support-admin",{
    method:"POST",credentials:"same-origin",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({id:record.id,action,reason,confirmation:confirm}),
   });
   const data=await reply.json() as {error?:string;message?:string};
   if(!reply.ok)throw Error(data.error??"Support action failed");
   await fetchCase(record.id);
   setMessage(data.message??"Action completed.");
   setAction(null);setConfirm("");setReason("");
  }catch(e){setError(e instanceof Error?e.message:"Support operation failed")}
  finally{setBusy(false)}
 }
 const actionAvailable=record?.refundable&&
  (record.type==="credit-video"||record.type==="stripe-order");
 return <section className="sm-support-admin">
  <header className="sm-support-heading">
   <p className="sm-support-kicker">SUPER ADMIN · PRIVATE SUPPORT CONSOLE</p>
   <h1>Customer orders &amp; recovery</h1>
   <p>Find an order or video project by its complete ID. Financial actions are protected and audited. No generation or checkout starts when you inspect a case.</p>
  </header>
  <form onSubmit={search} className="sm-support-search">
   <label htmlFor="support-lookup">Order ID or project ID</label>
   <div>
    <input id="support-lookup" autoComplete="off" spellCheck={false} value={id}
     onChange={e=>setId(e.target.value)} placeholder="xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx" required/>
    <button type="submit" disabled={busy}>{busy?"Checking…":"Find status"}</button>
   </div>
   <small>Accepted: full UUID or SM-UUID. Exact-match only; no customer-wide data export.</small>
  </form>
  {error&&<p role="alert" className="sm-support-error">{error}</p>}
  {message&&<p role="status" className="sm-support-message">{message}</p>}
  {record&&<div className="sm-support-details">
    <header>
     <p className="sm-support-kicker">MATCHED {record.type.replaceAll("-"," ").toUpperCase()}</p>
     <h2>Case {record.id.slice(0,8).toUpperCase()}</h2>
     <p><code>{record.id}</code></p>
    </header>
    <dl className="sm-support-fields">
     <div><dt>Case status</dt><dd>{record.caseStatus}</dd></div>
     <div><dt>Customer / delivery email</dt><dd>{record.customerEmail??"No verified customer email associated"}</dd></div>
     <div><dt>Order / project state</dt><dd>{record.state}</dd></div>
     <div><dt>Project ID</dt><dd><code>{record.projectId}</code></dd></div>
     {Object.entries(record.details).map(([name,value])=><div key={name}>
      <dt>{name.replace(/([A-Z])/g," $1")}</dt>
      <dd>{value===null?"Not confirmed":typeof value==="boolean"?(value?"Yes":"No"):String(value)}</dd>
     </div>)}
    </dl>
    <p role="status" className="sm-support-refund">
     <strong>{record.refundable?"Refund action available":"Refund action restricted"}</strong>
     <span>{record.refundReason}</span>
    </p>
    <div className="sm-support-actions">
     {actionAvailable&&<button type="button" disabled={busy}
      onClick={()=>{setAction(record.type==="credit-video"?"refund-credits":"refund-stripe");setReason("");setConfirm("");setError("");}}>
       {record.type==="credit-video"?"Return video Credits":"Refund original Stripe payment"}
      </button>}
     <button type="button" disabled={busy||record.caseStatus==="resolved"}
      onClick={()=>{setAction("resolve");setReason("");setConfirm("");setError("");}}>Mark case resolved</button>
     <button type="button" disabled={busy} onClick={()=>void fetchCase(record.id).catch(e=>setError(e.message))}>Refresh verified status</button>
    </div>
    {action&&<form onSubmit={execute} className="sm-support-confirm">
      <h3>{action==="refund-stripe"?"Confirm full Stripe refund":
        action==="refund-credits"?"Confirm Credit refund":"Confirm case resolution"}</h3>
      <p>{action==="refund-stripe"?
        "This action can refund actual money to the original payment method. No new generation or payment will be started. If Stripe is pending, the case stays open until verified.":
        action==="refund-credits"?
         "Returns the video's Credit reservation or reverses a recorded Credit debit only after a verified terminal failed provider job. The original project remains saved.":
         "Customer notification is queued after the case is marked resolved. Do not mark an unresolved payment or video failure as solved."}</p>
      <label>Reason / resolution evidence (minimum 20 characters)
       <textarea required minLength={20} maxLength={1200} rows={3} value={reason}
        onChange={e=>setReason(e.target.value)} placeholder="Describe confirmed customer impact, provider evidence and reason for the decision…"/>
      </label>
      <label>Type this exact confirmation:
       <code>{confirmFor(action,record.id)}</code>
       <input required spellCheck={false} autoComplete="off" value={confirm}
        onChange={e=>setConfirm(e.target.value)} placeholder={confirmFor(action,record.id)}/>
      </label>
      <div className="sm-support-actions">
       <button type="submit" disabled={busy||confirm!==confirmFor(action,record.id)||reason.trim().length<20}>
        {busy?"Processing…":action==="refund-stripe"?"Issue verified Stripe refund":action==="refund-credits"?"Refund Credits once":"Resolve and notify"}
       </button>
       <button type="button" onClick={()=>{setAction(null);setConfirm("");setReason("");}}>Cancel</button>
      </div>
    </form>}
    <p className="sm-support-footnote">Customer email is queued durably and retried by the worker if the mail provider is temporarily unavailable. Refund settlement and email delivery are independently verified.</p>
   </div>}
 </section>;
}
