"use client";
import {useEffect,useState} from "react";
import {GenerationStatusView,type GenerationProgress} from "./generation-status-view";

type CustomerOrder={
 orderId:string;projectId:string;status:string;fulfillmentState:string|null;
 videoReady:number;videoUrl:string|null;downloadUrl:string|null;
};
export function CustomerPaidOutput({orderId,guest=false,amountCents=null}:{
 orderId:string;guest?:boolean;amountCents?:number|null;
}){
 const [order,setOrder]=useState<CustomerOrder|null>(null);
 const [error,setError]=useState("");
 const [loaded,setLoaded]=useState(false);
 useEffect(()=>{
  let live=true;let timer:ReturnType<typeof setTimeout>;
  async function poll(){
   if(document.visibilityState!=="hidden"){
    try{
      const response=await fetch(guest
       ?`/api/orders/${encodeURIComponent(orderId)}`
       :`/api/customer-orders?view=mine&orderId=${encodeURIComponent(orderId)}`,{
        credentials:"same-origin",cache:"no-store"
       });
      if(!response.ok)throw Error("Order status unavailable");
      const data=await response.json() as {orders?:CustomerOrder[];paymentStatus?:string;
       fulfillmentStatus?:string|null;videoReady?:boolean};
      const item=guest?{
       orderId,projectId:"",status:data.paymentStatus||"unknown",
       fulfillmentState:data.fulfillmentStatus??null,videoReady:data.videoReady?1:0,
       videoUrl:data.videoReady?`/api/customer-video?orderId=${encodeURIComponent(orderId)}`:null,
       downloadUrl:data.videoReady?`/api/customer-video?orderId=${encodeURIComponent(orderId)}&download=1`:null
      }:data.orders?.find(o=>o.orderId===orderId)||null;
      if(live){setOrder(item);setLoaded(true);setError("");}
    }catch{if(live){setLoaded(true);setError("Unable to refresh the private order status. Please try reloading later.");}}
   }
   if(live)timer=setTimeout(poll,5000);
  }
  void poll();
  return()=>{live=false;clearTimeout(timer)};
 },[orderId,guest]);
 const ready=order?.status==="paid"&&order.videoReady===1&&!!order.videoUrl&&!!order.downloadUrl;
 const fulfillment=order?.fulfillmentState;
 let progress:GenerationProgress="unavailable";
 if(order?.status==="awaiting_payment")progress="verifying-payment";
 else if(order?.status==="paid"){
   if(ready)progress="ready";
   else if(fulfillment==="failed"||fulfillment==="requires-review")progress="review";
   else if(fulfillment==="processing")progress="processing";
   else progress="queued";
 }else if(order?.status==="refunded"||order?.status==="disputed")progress="review";
 else if(fulfillment==="failed")progress="review";
 // A signed redirect is not proof of payment. Only the owner-scoped server
 // status can mark payment confirmed and unlock a private verified MP4.
 const note=error||
  (order?.status==="refunded"?"The payment was refunded. Contact support if you need help.":
   order?.status==="disputed"?"The payment is under review. No duplicate payment is needed.":
   progress==="review"?"Your video is being reviewed. No additional payment or automatic provider retry will occur.":"");
 return <div className="sm-private-output sm-private-output-generation" aria-label="Private generation page">
   <GenerationStatusView progress={loaded?progress:"unavailable"} paymentMode="stripe"
    amount={amountCents} photoUrl={order?.status==="paid"?`/api/customer-generation-photo?orderId=${encodeURIComponent(orderId)}`:null} videoUrl={ready?order?.videoUrl:null}
    downloadUrl={ready?order?.downloadUrl:null} note={note}/>
 </div>;
}
