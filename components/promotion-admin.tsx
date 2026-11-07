"use client";
import { useCallback, useEffect, useState } from "react";
import type { Promotion, PromotionKind } from "@/lib/commerce/promotions";
type PromotionReport = {
  summary: Promotion;
  totals: {redeemedDiscountCents:number;committedDiscountCents:number};
  activity: {orderId:string;state:string;originalCents:number;discountCents:number;createdAt:number;updatedAt:number}[];
  daily: {day:string;reserved:number;redeemed:number;released:number;redeemedDiscountCents:number}[];
  truncated:boolean;
};
type FormValues = {
  code:string;kind:PromotionKind;percent:number;startsAt:string;endsAt:string;
  maxUses:number;perCustomerLimit:number;
};
const dateValue = (date:Date) => {
  const p=(n:number)=>String(n).padStart(2,"0");
  return `${date.getFullYear()}-${p(date.getMonth()+1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
};
function initial():FormValues {
  const start=new Date(),end=new Date(Date.now()+30*86400000);
  return {code:"",kind:"percent",percent:20,startsAt:dateValue(start),
    endsAt:dateValue(end),maxUses:100,perCustomerLimit:1};
}
async function request(method:"GET"|"POST",body?:unknown,code?:string){
  const response=await fetch("/api/promo-admin"+(code?"?code="+encodeURIComponent(code):""),{
    method,credentials:"same-origin",cache:"no-store",
    ...(body?{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{}),
  });
  const data=await response.json();
  if(!response.ok)throw Error(data.error||"Promotion operation failed");
  return data;
}
export function PromotionAdmin(){
  const [values,setValues]=useState<FormValues>(initial);
  const [codes,setCodes]=useState<Promotion[]>([]);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const [allowed,setAllowed]=useState(false);
  const [report,setReport]=useState<PromotionReport|null>(null);
  const load=useCallback(async()=>{
    try {
      const result=await request("GET");
      setCodes(result.codes);setAllowed(true);setError("");
    }catch(e){setAllowed(false);setError((e as Error).message);}
  },[]);
  useEffect(()=>{void Promise.resolve().then(load);},[load]);
  const update=<K extends keyof FormValues>(key:K,value:FormValues[K])=>
    setValues(prev=>({...prev,[key]:value}));
  async function submit(event:React.FormEvent){
    event.preventDefault();
    if(busy)return;
    setBusy(true);setError("");setMessage("");
    try {
      const startsAt=new Date(values.startsAt).toISOString();
      const endsAt=new Date(values.endsAt).toISOString();
      const result=await request("POST",{
        action:"create",kind:values.kind,...(values.code?{code:values.code}:{}),
        ...(values.kind==="percent"?{percent:values.percent}:
          {freeVideos:3,maxVideoSeconds:10}),
        startsAt,endsAt,maxUses:values.maxUses,
        perCustomerLimit:values.kind==="free_videos"?3:values.perCustomerLimit,
      });
      setMessage(`Code ${result.promotion.code} created. Checkout remains disabled until launch approval.`);
      setValues(initial());await load();
    }catch(e){setError((e as Error).message);}
    finally{setBusy(false);}
  }
  async function toggle(code:string,enabled:boolean){
    setBusy(true);setError("");setMessage("");
    try {await request("POST",{action:"toggle",code,enabled});await load();}
    catch(e){setError((e as Error).message);}
    finally{setBusy(false);}
  }
  async function details(code:string){
    setBusy(true);setError("");
    try {
      const result=await request("GET",undefined,code) as {report:PromotionReport};
      setReport(result.report);
    }catch(e){setError((e as Error).message);}
    finally{setBusy(false);}
  }
  function exportCsv(){
    if(!report)return;
    const heading=["orderId","state","originalCents","discountCents","createdAtUtc","updatedAtUtc"];
    const lines=report.activity.map(a=>[
      a.orderId,a.state,String(a.originalCents),String(a.discountCents),
      new Date(a.createdAt).toISOString(),new Date(a.updatedAt).toISOString()
    ].join(","));
    const csv=[heading.join(","),...lines].join("\n")+"\n";
    const href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
    const link=document.createElement("a");
    link.href=href;link.download="singmotion-promo-"+report.summary.code+".csv";
    document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(href);
  }
  return <section style={{maxWidth:1050,margin:"2rem auto",padding:"1.5rem"}}>
    <h1>Promotion codes</h1>
    <p>Create time-limited promotional codes and monitor reservations, redemptions and releases.
      Free-video codes allow three videos per customer, each up to 10 seconds. They do not
      bypass the currently disabled customer payment and generation gates.</p>
    {error&&<p role="alert" style={{color:"crimson"}}>{error}</p>}
    {message&&<p role="status">{message}</p>}
    {allowed&&<>
      <form onSubmit={submit} style={{display:"grid",gap:12,maxWidth:580}}>
        <label>Code (optional, leave blank to generate)
          <input value={values.code} maxLength={40} onChange={e=>update("code",e.target.value)}
            placeholder="SUMMER20" autoComplete="off" style={{display:"block",width:"100%"}}/>
        </label>
        <label>Offer type
          <select value={values.kind} onChange={e=>update("kind",e.target.value as PromotionKind)}
            style={{display:"block",width:"100%"}}>
            <option value="percent">Percentage discount</option>
            <option value="free_videos">3 free videos (max 10 seconds each)</option>
          </select>
        </label>
        {values.kind==="percent"&&<label>Discount (%)
          <input type="number" min={1} max={100} required value={values.percent}
            onChange={e=>update("percent",Number(e.target.value))}/>
        </label>}
        <label>Start date and time (local)
          <input type="datetime-local" required value={values.startsAt}
            onChange={e=>update("startsAt",e.target.value)}/>
        </label>
        <label>Expiration date and time (local)
          <input type="datetime-local" required value={values.endsAt}
            onChange={e=>update("endsAt",e.target.value)}/>
        </label>
        <label>Maximum total uses (across all customers)
          <input type="number" min={1} max={1000000} required value={values.maxUses}
            onChange={e=>update("maxUses",Number(e.target.value))}/>
        </label>
        {values.kind==="percent"&&<label>Uses allowed per customer
          <input type="number" min={1} max={100} required value={values.perCustomerLimit}
            onChange={e=>update("perCustomerLimit",Number(e.target.value))}/>
        </label>}
        <button type="submit" disabled={busy}>Create code</button>
      </form>
      <h2 style={{marginTop:36}}>Usage report</h2>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",textAlign:"left"}}>
          <thead><tr>
            {["Code","Offer","Start","Expires","Redeemed","Reserved","Released","Total limit","Status","Action"].map(x=>
              <th key={x} style={{padding:8,borderBottom:"1px solid #999"}}>{x}</th>)}
          </tr></thead>
          <tbody>{codes.map(p=><tr key={p.code}>
            <td style={{padding:8}}><code>{p.code}</code></td>
            <td>{p.kind==="percent"?`${p.percent}% off`:"3 × ≤10s videos"}</td>
            <td>{new Date(p.startsAt).toLocaleString()}</td>
            <td>{new Date(p.endsAt).toLocaleString()}</td>
            <td>{p.redeemed}</td><td>{p.reserved}</td><td>{p.released}</td>
            <td>{p.maxUses}</td>
            <td>{p.status}</td>
            <td>
              <button type="button" disabled={busy} onClick={()=>void toggle(p.code,!p.enabled)}>
                {p.enabled?"Disable":"Enable"}</button>
              {" "}
              <button type="button" disabled={busy} onClick={()=>void details(p.code)}>
                Details</button>
            </td>
          </tr>)}</tbody>
        </table>
        {codes.length===0&&<p>No codes yet.</p>}
      </div>
      {report && <section aria-labelledby="promo-details" style={{marginTop:28}}>
        <h3 id="promo-details">Usage details: <code>{report.summary.code}</code></h3>
        <p>Redeemed discount value: €{(report.totals.redeemedDiscountCents/100).toFixed(2)}.
          {" "}Reserved + redeemed value: €{(report.totals.committedDiscountCents/100).toFixed(2)}.</p>
        <p>Amounts shown are promotional reductions, not Stripe revenue or provider cost.</p>
        <button type="button" onClick={exportCsv}>Export recent activity (CSV)</button>
        {" "}
        <button type="button" onClick={()=>setReport(null)}>Close details</button>
        <h4>Usage by UTC day</h4>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",textAlign:"left"}}>
            <thead><tr><th>Day</th><th>Reserved</th><th>Redeemed</th><th>Released</th><th>Redeemed discounts</th></tr></thead>
            <tbody>{report.daily.map(d=><tr key={d.day}>
              <td>{d.day}</td><td>{d.reserved}</td><td>{d.redeemed}</td>
              <td>{d.released}</td><td>€{(d.redeemedDiscountCents/100).toFixed(2)}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <h4>Latest order activity</h4>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",textAlign:"left"}}>
            <thead><tr><th>Order</th><th>Status</th><th>Original</th><th>Discount</th><th>Reserved at</th><th>Updated at</th></tr></thead>
            <tbody>{report.activity.map(a=><tr key={a.orderId}>
              <td><code>{a.orderId}</code></td><td>{a.state}</td>
              <td>€{(a.originalCents/100).toFixed(2)}</td>
              <td>€{(a.discountCents/100).toFixed(2)}</td>
              <td>{new Date(a.createdAt).toLocaleString()}</td>
              <td>{new Date(a.updatedAt).toLocaleString()}</td>
            </tr>)}</tbody>
          </table>
        </div>
        {report.truncated && <p role="status">Large report: only the newest 500 activity rows and 365 UTC days are shown.</p>}
      </section>}
      <p>“Reserved” counts orders awaiting verified settlement. “Redeemed” counts settled orders.
        Free-video allowance is counted per completed redemption, not on code lookup.</p>
    </>}
  </section>;
}
