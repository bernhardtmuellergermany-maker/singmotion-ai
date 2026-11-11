"use client";
import {Check,Clock3,Clapperboard,Download,LoaderCircle,LockKeyhole,ShieldCheck} from "lucide-react";
import "./generation-status-view.css";

export type GenerationProgress = "verifying-payment"|"queued"|"processing"|"review"|"ready"|"failed"|"unavailable";
export function GenerationStatusView({
  progress,paymentMode,amount,providerSeconds,photoUrl,format,videoUrl,downloadUrl,note,
}:{
  progress:GenerationProgress;
  paymentMode:"stripe"|"super-admin";
  amount?:number|null;
  providerSeconds?:number|null;
  photoUrl?:string|null;
  format?:"9:16"|"16:9";
  videoUrl?:string|null;
  downloadUrl?:string|null;
  note?:string;
}){
  const admin=paymentMode==="super-admin";
  const paymentConfirmed=admin?progress!=="unavailable":!["verifying-payment","unavailable"].includes(progress);
  const working=progress==="processing";
  const ready=progress==="ready"&&!!videoUrl&&!!downloadUrl;
  const review=progress==="review";
  const failed=progress==="failed";
  const stages=[
    {title:"Audio & assets prepared",description:"Selected audio and reference image were prepared",state:progress==="unavailable"?"pending" as const:"done" as const},
    {title:admin?"Super Admin authorized":"Payment confirmed",description:admin?"Private generation · no Stripe checkout":"Secure payment verified by Stripe",state:paymentConfirmed?"done" as const:"active" as const},
    {title:"Video generation",description:"Singing, expressions and camera direction",state:ready?"done" as const:working?"active" as const:"pending" as const},
    {title:"Final render & verification",description:"Private output retrieval and technical validation",state:ready?"done" as const:"pending" as const},
    {title:"Ready to download",description:"Your private MP4 is ready",state:ready?"done" as const:"pending" as const},
  ];
  // Provider processing stages cannot be measured as percentages. Never
  // display an invented completion percentage or estimated completion time.
  const label=ready?"Your video is ready":failed?"Generation needs attention":review?"Your video is under review":
    progress==="verifying-payment"?"Verifying your payment…":progress==="queued"?"Your video is queued":
    working?"Generating your video":"Checking your video status";
  const detail=ready?"Watch your finished video and download the private MP4.":
    failed||review?"Our team needs to review this generation. Do not pay again or resubmit the same recording.":
    progress==="verifying-payment"?"Waiting for the secure Stripe confirmation. No new order will be created.":
    progress==="queued"?"Your request is waiting for processing. You can safely leave this page.":
    working?"Your music video is being created. This can take several minutes.":
    "Your existing project is being checked. Refreshing the page never starts another generation.";
  const providerEstimate=typeof providerSeconds==="number" && Number.isFinite(providerSeconds) && providerSeconds>0
    ?`USD ${(providerSeconds*0.07).toFixed(2)} est. · $0.07/sec` : "$0.07 / video second";
  const formattedAmount=Number.isSafeInteger(amount)&&amount!==null&&amount!==undefined&&amount>=0
    ?new Intl.NumberFormat("en-IE",{style:"currency",currency:"EUR"}).format(amount/100):null;
  return <section className="sm-gen-page" aria-label="Video generation status">
    <header className="sm-gen-heading">
      <span className="sm-gen-eyebrow">SINGMOTION AI / VIDEO GENERATION</span>
      <h1>{label}</h1>
      <p>{detail}</p>
    </header>
    <div className="sm-gen-payment" role="status">
      <span className={"sm-gen-payment-mark "+(paymentConfirmed?"is-done":"")}><ShieldCheck size={18}/></span>
      <span>{admin?"Super Admin · No checkout required":paymentConfirmed?"Payment confirmed · Stripe":"Verifying your payment…"}</span>
      {admin?<strong title="Provider cost estimate based on requested seconds, not a settled BytePlus invoice">{providerEstimate}</strong>:
       formattedAmount&&paymentConfirmed&&<strong>{formattedAmount} paid</strong>}
    </div>
    <div className="sm-gen-grid">
      <div className="sm-gen-media-column">
        <div className={"sm-gen-preview "+(format==="9:16"?"is-portrait":"is-landscape")}>
          {ready?<video src={videoUrl!} controls playsInline preload="metadata" aria-label="Your finished SingMotion video"/>:
            <div className="sm-gen-preview-placeholder">
              {photoUrl&&<img src={photoUrl} alt="Your uploaded artist reference" className="sm-gen-photo"/>}
              <div className="sm-gen-glow" aria-hidden="true"/>
              <div className="sm-gen-preview-center"><span className="sm-gen-visual-icon"><Clapperboard size={31}/></span><strong>{label}</strong><p>{working?"BytePlus is processing your video":progress==="queued"?"Waiting for generation":paymentConfirmed?"Checking your private video":"Waiting for payment verification"}</p></div>
              {!ready&&!review&&!failed&&<div className="sm-gen-indeterminate" role="progressbar" aria-label="Video preparation in progress" aria-valuetext="Processing; no percentage available"><span/></div>}
            </div>}
          <span className="sm-gen-watermark">SingMotion <b>AI</b></span>
        </div>
        <p className="sm-gen-preview-caption">{ready?"Private video · verified delivery":review||failed?"Existing project · manual attention needed":"Private preview · video not yet available"}</p>
      </div>
      <div className="sm-gen-status-column">
        <h2>Generation progress</h2>
        <ol className="sm-gen-timeline">
          {stages.map((stage,index)=><li className={"sm-gen-milestone is-"+stage.state} key={stage.title}>
            <span className="sm-gen-milestone-icon" aria-hidden="true">{stage.state==="done"?<Check size={17}/>:stage.state==="active"?<LoaderCircle size={18}/>:<span className="sm-gen-empty-dot"/>}</span>
            <div className="sm-gen-milestone-content"><strong>{stage.title}</strong><span>{stage.description}</span></div>
            <small>{stage.state==="done"?"Done":stage.state==="active"?index===1?"Verifying":"In progress":"Pending"}</small>
          </li>)}
        </ol>
        <div className="sm-gen-wait">
          <Clock3 size={19}/><p><strong>{ready?"Your video is complete":review||failed?"Your generation needs attention":"This may take several minutes."}</strong>
          <span>{ready?"Download your video below.":review||failed?"Your project is saved. Contact support if you need help.":"You can leave this page. Your order remains saved and you can return to check progress."}</span></p>
        </div>
        {ready?<a className="sm-gen-download" href={downloadUrl!} download><Download size={18}/> Download video</a>:
          <button className="sm-gen-download" type="button" disabled><LockKeyhole size={17}/> Download video</button>}
        <p className="sm-gen-download-note">{ready?"Private MP4 available now.":"Available only after the video has been verified and securely stored."}</p>
      </div>
    </div>
    {admin&&<p className="sm-gen-outcome-note">BytePlus base-rate estimate only: $0.07 per generated video second. Final provider billing can differ if output duration or fees differ. No Stripe checkout.</p>}
    {note&&<p className="sm-gen-outcome-note" role={failed||review?"alert":"status"}>{note}</p>}
    <p className="sm-gen-disclaimer">AI-generated results may vary, including facial expressions, camera movement and lip synchronization. Your statutory rights remain unaffected.</p>
  </section>;
}
