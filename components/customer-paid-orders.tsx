"use client";
import {useEffect,useState} from "react";
import Link from "next/link";

type Order={orderId:string;projectId:string;status:string;fulfillmentState:string|null;videoReady:number};
export function CustomerPaidOrders(){
 const [orders,setOrders]=useState<Order[]>([]);
 useEffect(()=>{
  let active=true;
  fetch("/api/customer-orders?view=mine",{credentials:"same-origin",cache:"no-store"})
   .then(async response=>response.ok?await response.json() as {orders:Order[]}:null)
   .then(data=>{if(active&&data?.orders)setOrders(data.orders.filter(o=>
     typeof o.orderId==="string"&&/^[a-f0-9-]{36}$/.test(o.orderId)));})
   .catch(()=>{});
  return()=>{active=false};
 },[]);
 if(!orders.length)return null;
 return <section aria-label="Your customer videos">
  <h2>Customer videos</h2>
  <div className="project-grid">{orders.map(o=>
   <Link className="project-card" key={o.orderId} href={`/projects/paid_${o.orderId}`}>
    <div className="project-info">
     <h3>{o.projectId||"SingMotion video"}</h3>
     <p>{o.videoReady===1?"Video ready · Open output":
        o.fulfillmentState==="failed"?"Needs review":
        o.status==="paid"?"Video processing":"Awaiting payment"}</p>
    </div>
   </Link>
  )}</div>
 </section>;
}
