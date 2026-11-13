"use client";

import {useState} from "react";
import {CustomerFeedback} from "@/components/customer-feedback";
import {
  checkoutFeedback,generationFeedback,providerFeedback,requestErrorFeedback,
  type CustomerNotice,
} from "@/lib/live/customer-feedback";
import "./feedback-preview.css";

type PreviewScenario = {
  id:string;
  label:string;
  category:"generation"|"payment"|"upload";
  stage:string;
  notice:CustomerNotice;
  explanation:string;
};

const sampleHold={credits:150,status:"review" as const};
const sampleReleased={credits:150,status:"released" as const};
const rejection="Rejected before generation [CONTENT_PREFILTER_REJECTED]";
const cases:PreviewScenario[]=[
  {id:"provider-refund",label:"Provider rejected · Credits released",category:"generation",stage:"Input rejected",
    notice:providerFeedback("failed",rejection,sampleReleased)!,
    explanation:"Only a verified, non-billable provider rejection releases the Credit reservation. Sample: 150 Credits."},
  {id:"provider-review",label:"Provider rejected · release pending",category:"generation",stage:"Billing check",
    notice:providerFeedback("failed",rejection,sampleHold)!,
    explanation:"An unclear financial result does not promise a refund. The customer sees that reconciliation is pending."},
  {id:"credits-low",label:"Not enough Credits",category:"generation",stage:"Credit check",
    notice:generationFeedback("credits-needed",{credits:250,status:"estimated"},100)!,
    explanation:"Sample balance: 100 Credits available; 250 required. The button displays Buy Credits."},
  {id:"queued",label:"Video queued",category:"generation",stage:"Queued",
    notice:generationFeedback("queued",{credits:150,status:"reserved"})!,
    explanation:"Credits are reserved, not charged. Leaving the page will not create a duplicate request."},
  {id:"processing",label:"Video processing",category:"generation",stage:"Processing",
    notice:generationFeedback("processing",{credits:150,status:"reserved"})!,
    explanation:"Shows what is happening without fabricating progress percentages or an ETA."},
  {id:"delayed",label:"Generation delayed",category:"generation",stage:"Delayed",
    notice:providerFeedback("processing","Awaiting output",{credits:150,status:"reserved"},Date.now()-50*60*1000)!,
    explanation:"For a video taking more than 45 minutes, the customer is told it is still being investigated."},
  {id:"uncertain",label:"Provider status unknown",category:"generation",stage:"Manual review",
    notice:generationFeedback("review",{credits:150,status:"review"})!,
    explanation:"Prevents double submissions and makes held Credits visible."},
  {id:"failed",label:"Generation failed",category:"generation",stage:"Failed",
    notice:generationFeedback("failed",{credits:150,status:"review"})!,
    explanation:"No unverified refunds or claims that BytePlus has not billed the task."},
  {id:"ready",label:"Video ready",category:"generation",stage:"Completed",
    notice:generationFeedback("ready")!,
    explanation:"Success message automatically disappears after 9 seconds. Refresh the example to see it again."},
  {id:"payment-cancelled",label:"Payment cancelled",category:"payment",stage:"Checkout returned",
    notice:checkoutFeedback("cancelled")!,
    explanation:"No order is created by this preview. The cancellation notice fades after 15 seconds."},
  {id:"payment-return",label:"Returned from Stripe",category:"payment",stage:"Payment verification",
    notice:checkoutFeedback("success")!,
    explanation:"A Stripe redirect is not payment proof. Credit balance is updated only after a verified payment."},
  {id:"payment-declined",label:"Card/payment declined",category:"payment",stage:"Payment unsuccessful",
    notice:requestErrorFeedback("Payment failed, card declined","payment"),
    explanation:"Shows a safe message without revealing payment credentials or inventing a refund."},
  {id:"payment-offline",label:"Internet lost during payment",category:"payment",stage:"Connection interrupted",
    notice:requestErrorFeedback("Network connection interrupted","payment"),
    explanation:"No auto-retry. Customers should first check their existing wallet/payment."},
  {id:"upload-offline",label:"Upload connection lost",category:"upload",stage:"Upload interrupted",
    notice:requestErrorFeedback("Upload timed out","upload"),
    explanation:"The customer checks whether the file was stored before uploading again."},
  {id:"upload-invalid",label:"Invalid photo or audio",category:"upload",stage:"File rejected",
    notice:requestErrorFeedback("Invalid unsupported file format","upload"),
    explanation:"A local file replacement can be attempted without beginning video generation."},
  {id:"maintenance",label:"Temporary server outage",category:"generation",stage:"Service unavailable",
    notice:requestErrorFeedback("503 service unavailable","generation"),
    explanation:"The existing project is preserved when confirmed; no second provider task is started."},
  {id:"session",label:"Session expired",category:"generation",stage:"Account verification",
    notice:requestErrorFeedback("401 authentication required","generation"),
    explanation:"The user is asked to sign in again before any paid operation."},
  {id:"rate-limit",label:"Too many requests",category:"upload",stage:"Request paused",
    notice:requestErrorFeedback("429 too many requests","upload"),
    explanation:"Prevents repeated submissions until the request limit clears."},
];

export function FeedbackPreview(){
  const [selected,setSelected]=useState("provider-refund");
  const [group,setGroup]=useState<"all"|"generation"|"payment"|"upload">("all");
  const [refresh,setRefresh]=useState(0);
  const active=cases.find(item=>item.id===selected)??cases[0];
  const visible=cases.filter(item=>group==="all"||item.category===group);
  const chooseGroup=(next:typeof group)=>{
    setGroup(next);
    const first=cases.find(item=>next==="all"||item.category===next);
    if(first){setSelected(first.id);setRefresh(current=>current+1);}
  };
  return <div className="sm-preview-shell">
    <header className="sm-preview-heading">
      <span className="sm-preview-overline">PRIVATE STAGING · SIMULATION ONLY</span>
      <h1>Customer notification preview</h1>
      <p>Test what customers see when something works, fails, or takes longer than expected. Nothing here connects to a payment, wallet, upload, or AI provider.</p>
    </header>
    <aside className="sm-preview-safety" role="status">
      <strong>Safe demo mode</strong>
      <span>0 orders · 0 Stripe payments · 0 BytePlus requests · 0 Credit changes</span>
    </aside>
    <section aria-label="Choose notification to preview" className="sm-preview-select">
      <h2>1. Choose an event</h2>
      <div className="sm-preview-filters" role="group" aria-label="Filter customer events">
        {(["all","generation","payment","upload"] as const).map(value=><button key={value} type="button" aria-pressed={group===value}
          onClick={()=>chooseGroup(value)}>{value==="all"?"All":value==="generation"?"Generation":value==="payment"?"Payment":"Uploads"}</button>)}
      </div>
      <div className="sm-preview-events">
        {visible.map(item=><button key={item.id} type="button" aria-pressed={selected===item.id}
          className={selected===item.id?"is-selected":""} onClick={()=>{setSelected(item.id);setRefresh(v=>v+1);}}>
          {item.label}
        </button>)}
      </div>
    </section>
    <section className="sm-preview-example" aria-label="Example customer-facing notification">
      <div className="sm-preview-example-top">
        <div>
          <span className="sm-preview-overline">2. Live UI preview · example only</span>
          <h2>{active.category==="payment"?"Credit checkout":active.category==="upload"?"Studio upload":"Generate your video"}</h2>
        </div>
        <button type="button" onClick={()=>setRefresh(v=>v+1)}>Replay notice</button>
      </div>
      <div className="sm-preview-example-card" onClickCapture={event=>{
        // Demonstration CTA links are intentionally inactive. No navigation or external action.
        if((event.target as HTMLElement).closest("a"))event.preventDefault();
      }}>
        <div className="sm-preview-process-label"><span className="sm-preview-dot" aria-hidden="true"/>{active.stage}</div>
        <CustomerFeedback key={active.id+":"+refresh} notice={active.notice} context={active.category}/>
        <div className="sm-preview-example-rest">
          <div className="sm-preview-progress"><span/><span/><span/></div>
          <p>{active.category==="payment"?"Your Credits and purchase history appear here.":active.category==="upload"?"Your uploaded audio and photo appear in the Studio.":"Your existing saved project remains available in My Projects."}</p>
        </div>
        <p className="sm-preview-hint">Buttons shown inside this example are visual previews only.</p>
      </div>
      <p className="sm-preview-explanation">{active.explanation}</p>
    </section>
    <p className="sm-preview-footer">To test mobile layout, open this same page on your phone or resize your browser. The preview uses the exact SingMotion customer notification component and message mapping.</p>
  </div>;
}
