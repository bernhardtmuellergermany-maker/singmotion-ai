"use client";

import {useState} from "react";
import {CustomerFeedback} from "@/components/customer-feedback";
import {GenerationStatusView,type GenerationProgress} from "@/components/generation-status-view";
import {
  checkoutFeedback,generationFeedback,providerFeedback,paidOrderFeedback,requestErrorFeedback,
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
  {id:"provider-job-failed",label:"Provider stopped · billing check",category:"generation",stage:"Provider task failed",
    notice:providerFeedback("failed","[PROVIDER_JOB_FAILED]",sampleHold)!,
    explanation:"A provider task failure may still be billable. Do not show an automatic refund or an upload-replacement action."},
  {id:"output-validation",label:"Output invalid · original task saved",category:"generation",stage:"Output validation",
    notice:providerFeedback("failed","[OUTPUT_MP4_VALIDATION_FAILED]",sampleHold)!,
    explanation:"Changing the photo does not fix a broken output file. Recovery must inspect the original task."},
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
  {id:"payment-refunded",label:"Stripe payment refunded",category:"payment",stage:"Refund recorded",
    notice:paidOrderFeedback("refunded","failed","/studio?copy=draft_original")!,
    explanation:"The PAID ORDER was marked refunded. The customer can edit their old draft. This is not a prepaid Credit release."},
  {id:"payment-disputed",label:"Payment dispute",category:"payment",stage:"Dispute recorded",
    notice:paidOrderFeedback("disputed","failed")!,
    explanation:"Do not display payment completed or initiate a replacement job when the charge is disputed."},
  {id:"paid-output-failed",label:"Paid order failed · refund unverified",category:"payment",stage:"Output not delivered",
    notice:paidOrderFeedback("paid","failed")!,
    explanation:"A confirmed Stripe charge is not a Credit wallet reservation. Provider failure alone does not prove an external refund."},
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

/** Preview only: parameters are local examples, never retrieved from an order or wallet. */
function outputExample(id:string):{
  progress:GenerationProgress;
  paymentMode:"stripe"|"super-admin";
  paymentStatus?:string;
  creditCharge?:{credits:number;status:"estimated"|"reserved"|"review"|"settled"|"released"};
  availableCredits?:number;
  videoUrl?:string;
  downloadUrl?:string;
}{
  if(id==="payment-refunded")return {progress:"review",paymentMode:"stripe",paymentStatus:"refunded"};
  if(id==="payment-disputed")return {progress:"review",paymentMode:"stripe",paymentStatus:"disputed"};
  if(id==="paid-output-failed")return {progress:"review",paymentMode:"stripe",paymentStatus:"paid"};
  if(id==="payment-cancelled"||id==="payment-return"||id==="payment-declined"||id==="payment-offline")
    return {progress:"verifying-payment",paymentMode:"stripe"};
  if(id==="credits-low")
    return {progress:"credits-needed",paymentMode:"super-admin",creditCharge:{credits:250,status:"estimated"},availableCredits:100};
  if(id==="provider-refund")
    return {progress:"failed",paymentMode:"super-admin",creditCharge:{credits:150,status:"released"}};
  if(id==="provider-review"||id==="failed"||id==="provider-job-failed"||id==="output-validation")
    return {progress:"failed",paymentMode:"super-admin",creditCharge:{credits:150,status:"review"}};
  if(id==="uncertain"||id==="delayed")
    return {progress:"review",paymentMode:"super-admin",creditCharge:{credits:150,status:"review"}};
  if(id==="queued")
    return {progress:"queued",paymentMode:"super-admin",creditCharge:{credits:150,status:"reserved"}};
  if(id==="processing")
    return {progress:"processing",paymentMode:"super-admin",creditCharge:{credits:150,status:"reserved"}};
  if(id==="ready")
    return {progress:"ready",paymentMode:"super-admin",creditCharge:{credits:150,status:"settled"},
      videoUrl:"/media/demo.mp4",downloadUrl:"/media/demo.mp4"};
  return {progress:"prepared",paymentMode:"super-admin",creditCharge:{credits:150,status:"estimated"}};
}

export function FeedbackPreview(){
  const [selected,setSelected]=useState("provider-refund");
  const [group,setGroup]=useState<"all"|"generation"|"payment"|"upload">("all");
  const [refresh,setRefresh]=useState(0);
  const [layout,setLayout]=useState<"output"|"notice">("output");
  const [device,setDevice]=useState<"desktop"|"mobile">("desktop");
  const active=cases.find(item=>item.id===selected)??cases[0];
  const output=outputExample(active.id);
  const checkoutOnly=["payment-cancelled","payment-return","payment-declined","payment-offline"].includes(active.id);
  const visible=cases.filter(item=>group==="all"||item.category===group);
  const chooseGroup=(next:typeof group)=>{
    setGroup(next);
    const first=cases.find(item=>next==="all"||item.category===next);
    if(first){setSelected(first.id);setRefresh(current=>current+1);}
  };
  return <div className="sm-preview-shell">
    <header className="sm-preview-heading">
      <span className="sm-preview-overline">PRIVATE STAGING · SIMULATION ONLY</span>
      <h1>Customer Output page preview</h1>
      <p>See how an error or status appears on the actual SingMotion video Output page, including the preview, Credits and progress. Switch to a phone layout or inspect the notification alone. No real job is involved.</p>
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
          <span className="sm-preview-overline">2. Real Output component · simulated data</span>
          <h2>{layout==="output"?"Customer Output page":"Notification only"}</h2>
        </div>
        <button type="button" onClick={()=>setRefresh(v=>v+1)}>Replay notice</button>
      </div>
      <div className="sm-preview-display-options" aria-label="Preview layout">
        <div role="group" aria-label="Preview mode">
          <button type="button" aria-pressed={layout==="output"} onClick={()=>{setLayout("output");setRefresh(v=>v+1);}}>Full Output page</button>
          <button type="button" aria-pressed={layout==="notice"} onClick={()=>{setLayout("notice");setRefresh(v=>v+1);}}>Notice only</button>
        </div>
        <div role="group" aria-label="Screen size">
          <button type="button" aria-pressed={device==="desktop"} onClick={()=>setDevice("desktop")}>Desktop</button>
          <button type="button" aria-pressed={device==="mobile"} onClick={()=>setDevice("mobile")}>Mobile</button>
        </div>
      </div>
      {(checkoutOnly||active.category==="upload")&&layout==="output"&&<p className="sm-preview-location-note" role="status">
        {checkoutOnly
          ?"Payment notifications normally appear in the Credit checkout / order flow. This example also shows how the banner looks on Output."
          :"Upload problems normally appear in Studio before an Output page exists. This example demonstrates the banner placement in the Output layout."}
      </p>}
      <div className={"sm-preview-viewport "+(device==="mobile"?"is-mobile":"is-desktop")}
        onClickCapture={event=>{
          // Disable navigation/download in this staging simulation; only the sample media may play.
          if((event.target as HTMLElement).closest("a"))event.preventDefault();
        }}>
        <div className="sm-preview-demo-ribbon"><span>EXAMPLE OUTPUT · NO ACTUAL ORDER</span><span>{device==="mobile"?"MOBILE":"DESKTOP"}</span></div>
        {layout==="output"
          ?<GenerationStatusView key={active.id+":"+refresh} progress={output.progress}
            paymentMode={output.paymentMode} paymentStatus={output.paymentStatus} creditCharge={output.creditCharge}
            availableCredits={output.availableCredits} format="16:9"
            videoUrl={output.videoUrl} downloadUrl={output.downloadUrl}
            previewNotice={active.notice}/>
          :<div className="sm-preview-example-card">
            <div className="sm-preview-process-label"><span className="sm-preview-dot" aria-hidden="true"/>{active.stage}</div>
            <CustomerFeedback key={active.id+":"+refresh} notice={active.notice} context={active.category}/>
            <p className="sm-preview-hint">Buttons in this preview are disabled. No payment or job can be started.</p>
          </div>}
      </div>
      <p className="sm-preview-hint">All links and downloads in the example are disabled. The finished-video example uses an existing public demo clip, not a new generation.</p>
      <p className="sm-preview-explanation">{active.explanation}</p>
    </section>
    <p className="sm-preview-footer">This staging preview reuses the real GenerationStatusView from private customer orders. Scenario data is fictitious. Real refunds or provider rejections appear only after verified server state is available.</p>
  </div>;
}
