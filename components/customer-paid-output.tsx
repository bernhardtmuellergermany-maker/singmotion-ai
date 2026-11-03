"use client";
import {useEffect,useState} from "react";
import "./studio-live-preview.css";
import {customerPaidVideoLabel} from "../lib/commerce/customer-video-links";

type CustomerOrder={orderId:string;projectId:string;status:string;fulfillmentState:string|null;
 videoReady:number;videoUrl:string|null;downloadUrl:string|null};
export function CustomerPaidOutput({orderId}:{orderId:string}){
 const [order,setOrder]=useState<CustomerOrder|null>(null);
 const [error,setError]=useState("");
 const [loaded,setLoaded]=useState(false);
 useEffect(()=>{
  let live=true;let timer:ReturnType<typeof setTimeout>;
  async function poll(){
   if(document.visibilityState!=="hidden"){
    try{
     const response=await fetch(`/api/customer-orders?view=mine&orderId=${encodeURIComponent(orderId)}`,{credentials:"same-origin",cache:"no-store"});
     if(!response.ok)throw Error("Order status unavailable");
     const data=await response.json() as {orders:CustomerOrder[]};
     if(live){setOrder(data.orders.find(o=>o.orderId===orderId)||null);setLoaded(true);setError("");}
    }catch{if(live)setError("Unable to refresh video status.");}
   }
   if(live)timer=setTimeout(poll,5000);
  }
  void poll();return()=>{live=false;clearTimeout(timer)};
 },[orderId]);
 const ready=order?.status==="paid"&&order.videoReady===1&&!!order.videoUrl&&!!order.downloadUrl;
 const status=customerPaidVideoLabel(order,loaded);
 return <div id="content" className="sm-live-page">
  {error&&<p className="error" role="alert">{error}</p>}
  <div className="sm-carousel-stage sm-output-stage">
   <section className={"sm-carousel-card sm-output-card "+(!ready?"sm-output-pending ":"")+"is-active"}
    style={{"--distance":0,"--depth":0,"--drag":0} as React.CSSProperties} aria-label="Customer video output">
    <div className="sm-live-card-top sm-live-video-overlay">
     <span className={"sm-live-card-kicker "+(ready?"sm-output-completed-tag":"")}>{status}</span>
    </div>
    <div className="sm-live-viewport portrait">
     {ready?<video controls playsInline preload="metadata" src={order.videoUrl!} aria-label="Your generated video"/>:
      <div className="sm-live-animated"><strong>{status}</strong><span>Your video will appear here when it is ready.</span></div>}
    </div>
    {ready?<div className="sm-output-completed-footer"><strong>SingMotion video</strong>
      <a className="sm-output-download" href={order.downloadUrl!} download>Download video ↓</a></div>:
     <div className="sm-output-pending-footer"><p className="sm-output-pending-stage" role="status">{status}</p></div>}
   </section>
  </div>
 </div>;
}
