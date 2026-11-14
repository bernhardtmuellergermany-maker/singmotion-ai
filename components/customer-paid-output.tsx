"use client";
import {useEffect,useState} from "react";
import {GenerationStatusView,type GenerationProgress} from "./generation-status-view";
import {paidOrderFeedback,requestErrorFeedback} from "@/lib/live/customer-feedback";

type CustomerOrder={
 orderId:string;projectId:string;status:string;fulfillmentState:string|null;
 videoReady:number;videoUrl:string|null;downloadUrl:string|null;
 displayName?:string|null;created?:number|null;durationSeconds?:number|null;
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
 const editDraftHref=!guest&&order?.projectId&&/^[A-Za-z0-9_-]{1,80}$/.test(order.projectId)
   ?"/studio?copy=draft_"+encodeURIComponent(order.projectId):null;
 const ownerNotice=error?requestErrorFeedback("Network connection interrupted","generation"):
   paidOrderFeedback(order?.status,fulfillment,editDraftHref);
 return <div className="sm-private-output sm-private-output-generation" aria-label="Private generation page">
   {!loaded?<p role="status" className="sm-gen-extra-message">Checking the saved order and payment status…</p>:<GenerationStatusView progress={progress} paymentMode="stripe"
    paymentStatus={order?.status} statusNotice={ownerNotice}
    projectDetails={ready?{
      id:order?.projectId||orderId,
      idLabel:order?.projectId?"Project ID":"Order ID",
      name:order?.displayName||"Music video",
      createdAt:order?.created,
      selectedDurationSeconds:order?.durationSeconds,
      renameOrderId:guest?null:orderId,
    }:null}
    amount={amountCents} photoUrl={order?.status==="paid"?`/api/customer-generation-photo?orderId=${encodeURIComponent(orderId)}`:null} videoUrl={ready?order?.videoUrl:null}
    downloadUrl={ready?order?.downloadUrl:null}
    reuseHref={ready?(order?.projectId?`/studio?copy=draft_${encodeURIComponent(order.projectId)}`:"/studio?new=1"):null}
    reuseBlank={ready&&!order?.projectId}/>}
 </div>;
}
