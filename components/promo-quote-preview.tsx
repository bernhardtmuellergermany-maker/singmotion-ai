"use client";
import {useState} from "react";
type Preview={estimatedExtraPriceCents:number;promotion:{discountCents:number;finalCents:number;kind:string;percent:number|null}|null;error?:string};
export function PromoQuotePreview(){
  const [code,setCode]=useState("");
  const [seconds,setSeconds]=useState(10);
  const [busy,setBusy]=useState(false);
  const [result,setResult]=useState<Preview|null>(null);
  const [error,setError]=useState("");
  async function check(event:React.FormEvent){
    event.preventDefault();
    if(busy)return;
    setBusy(true);setError("");setResult(null);
    try{
      const q=new URLSearchParams({seconds:String(seconds),promo:code.trim()});
      const response=await fetch("/api/customer-quote?"+q.toString(),{credentials:"same-origin",cache:"no-store"});
      const data=await response.json() as Preview;
      if(!response.ok)throw Error(data.error||"Preview unavailable");
      setResult(data);
    }catch(e){setError((e as Error).message);}
    finally{setBusy(false);}
  }
  return <section aria-labelledby="promo-test-heading">
    <h2 id="promo-test-heading">Test a promotion (no purchase)</h2>
    <p>Sign in with your customer test account to preview the estimate. This does not
      reserve a voucher, charge a card or start any video generation.</p>
    <form onSubmit={check}>
      <label htmlFor="promo-test-code">Promo code</label>
      <input id="promo-test-code" required minLength={6} maxLength={40}
        value={code} autoComplete="off"
        onChange={e=>setCode(e.target.value.toUpperCase())}/>
      <label htmlFor="promo-test-seconds">Video duration (seconds)</label>
      <input id="promo-test-seconds" type="number" min={5} max={30} step={1}
        value={seconds} onChange={e=>setSeconds(Number(e.target.value))}/>
      <button type="submit" disabled={busy}>{busy?"Checking…":"Preview discount"}</button>
    </form>
    {error&&<p role="alert">{error}</p>}
    {result?.promotion&&<div role="status">
      <p>Estimated undiscounted extra price: €{(result.estimatedExtraPriceCents/100).toFixed(2)}</p>
      <p>Promotion discount: €{(result.promotion.discountCents/100).toFixed(2)}</p>
      <p>Estimated total after promotion: €{(result.promotion.finalCents/100).toFixed(2)}</p>
      <p>Preview only. Final purchase pricing and customer generation remain disabled.</p>
    </div>}
  </section>;
}
