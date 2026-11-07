"use client";
import {useRouter} from "next/navigation";
import {useState} from "react";

/** Private customer cancellation. The backend must still verify ownership,
 * absence of a Stripe Checkout session and no provider/fulfillment claim. */
export function CancelUnstartedOrder({orderId}:{orderId:string}){
  const router=useRouter();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  async function cancel(){
    if(busy)return;
    if(!window.confirm("Cancel this unstarted order and release its reserved voucher?"))return;
    setBusy(true);setError("");
    try{
      const response=await fetch("/api/customer-orders?orderId="+encodeURIComponent(orderId),{
        method:"DELETE",credentials:"same-origin",cache:"no-store",
      });
      const data=await response.json() as {error?:string;status?:string};
      if(!response.ok || data.status!=="cancelled")
        throw Error(data.error||"Order cancellation was not possible");
      router.refresh();
    }catch(e){setError((e as Error).message);}
    finally{setBusy(false);}
  }
  return <div>
    <button type="button" className="product-secondary" disabled={busy}
      onClick={()=>void cancel()}>{busy?"Cancelling…":"Cancel unstarted order"}</button>
    {error&&<p role="alert">{error}</p>}
    <p>Cancellation is only possible before a Stripe Checkout session or video processing starts.</p>
  </div>;
}
