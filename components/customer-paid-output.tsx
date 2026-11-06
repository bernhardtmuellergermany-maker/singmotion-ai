"use client";
import {useEffect,useState} from "react";
import "./customer-paid-output.css";
import {Clapperboard,Film,ShieldCheck,Download} from "lucide-react";
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
 const review=order?.fulfillmentState==="failed"||order?.fulfillmentState==="requires-review";
 const processing=order?.status==="paid"&&order?.fulfillmentState==="processing";
 const displayStatus=review?"Under review":processing?"Checking video status":status;
 const description=ready?"Your music video is ready to watch and download.":
  review?"Your paid video needs an internal review. No second payment or video order is necessary.":
  processing?"Payment confirmed. We are checking the existing provider job and validating its result. No second payment or generation is needed.":
  "Your paid video will appear here when processing and private validation are complete.";
 return <section className="sm-private-output" aria-label="Customer video output">
  {error&&<p className="sm-private-output-error" role="alert">{error}</p>}
  <div className="sm-private-video-card">
   <div className="sm-private-video-frame">
    {ready?<video controls playsInline preload="metadata" src={order.videoUrl!} aria-label="Your generated video"/>:
     <div className="sm-private-video-placeholder">
      <div className="sm-private-video-halo" aria-hidden="true"><Clapperboard size={30} strokeWidth={1.6}/></div>
      <h2>{displayStatus}</h2>
      <p>{description}</p>
     </div>}
    <span className="sm-private-video-brand">SingMotion <b>AI</b></span>
    <span className="sm-private-video-state" role="status">{displayStatus}</span>
    {ready&&<div className="sm-private-video-scrim" aria-hidden="true"/>}
   </div>
   <div className="sm-private-video-footer">
    <div className="sm-private-video-footheading">
     <Film size={17} aria-hidden="true"/>
     <div><strong>Your music video</strong><span>{ready?"Completed":"Private preview"}</span></div>
    </div>
    {ready?<a className="sm-private-download" href={order.downloadUrl!} download><Download size={17} aria-hidden="true"/> Download MP4</a>:
     <div className="sm-private-video-secure"><ShieldCheck size={16} aria-hidden="true"/> Payment confirmed · Private processing</div>}
   </div>
  </div>
 </section>;
}
