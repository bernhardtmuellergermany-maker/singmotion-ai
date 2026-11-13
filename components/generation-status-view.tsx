"use client";
import {useState} from "react";
import {Check,Clock3,Clapperboard,Download,LoaderCircle,LockKeyhole,ShieldCheck,RotateCcw,Wallet} from "lucide-react";
import "./generation-status-view.css";
import {CustomerFeedback} from "./customer-feedback";
import {generationFeedback,providerFeedback,requestErrorFeedback,type CustomerNotice} from "@/lib/live/customer-feedback";

export type GenerationProgress = "credits-needed"|"verifying-payment"|"prepared"|"queued"|"processing"|"review"|"ready"|"failed"|"unavailable";
export function GenerationStatusView({
  progress,paymentMode,amount,creditCharge,availableCredits,photoUrl,format,videoUrl,downloadUrl,note,reuseHref,reuseBlank=false,previewNotice,editHref,paymentStatus,statusNotice,
}:{
  progress:GenerationProgress;
  paymentMode:"stripe"|"super-admin";
  paymentStatus?:string|null;
  /** Only supplied from the verified owner-scoped paid order read. */
  statusNotice?:CustomerNotice|null;
  amount?:number|null;
  creditCharge?:{credits:number;status:"estimated"|"reserved"|"review"|"settled"|"released"|"legacy"};
  availableCredits?:number|null;
  photoUrl?:string|null;
  format?:"9:16"|"16:9";
  videoUrl?:string|null;
  downloadUrl?:string|null;
  note?:string;
  /** Private staging preview only; real customer status normally comes from verified server state. */
  previewNotice?:CustomerNotice|null;
  /** Owner-checked Studio copy endpoint for changing rejected audio/photo in a NEW draft. */
  editHref?:string|null;
  reuseHref?:string|null;
  reuseBlank?:boolean;
}){
  const [imagePortrait,setImagePortrait]=useState(false);
  const admin=paymentMode==="super-admin";
  const paymentRefunded=!admin&&paymentStatus==="refunded";
  const paymentDisputed=!admin&&paymentStatus==="disputed";
  const paymentConfirmed=admin?!!creditCharge&&["reserved","review","settled","released"].includes(creditCharge.status):
    paymentStatus!==undefined&&paymentStatus!==null?paymentStatus==="paid":!["verifying-payment","unavailable"].includes(progress);
  const working=progress==="processing";
  const ready=progress==="ready"&&!!videoUrl&&!!downloadUrl;
  const review=progress==="review";
  const failed=progress==="failed";
  const inputRejected=failed&&(
    /\[CONTENT_PREFILTER_REJECTED\]/.test(note??"")||
    previewNotice?.key.startsWith("provider-prefilter-")===true);
  const releasedFailure=failed&&creditCharge?.status==="released";
  const customerNotice=statusNotice??previewNotice??(note&&/network|failed to fetch|connection interrupted|timed out/i.test(note)
    ?requestErrorFeedback(note,"generation")
    :failed&&/\[[A-Z][A-Z0-9_]{2,79}\]/.test(note??"")
      ?providerFeedback("failed",note??"",creditCharge,undefined,Date.now(),editHref)
      :generationFeedback(progress,creditCharge,availableCredits,editHref));
  const stages=[
    {title:"Audio & assets prepared",description:"Selected audio and reference image were prepared",state:progress==="unavailable"?"pending" as const:"done" as const},
    {title:admin?"Video credit authorization":paymentRefunded?"Payment refunded":paymentDisputed?"Payment disputed":"Payment confirmed",description:admin?creditCharge?.status==="legacy"?"Historical operator test · no wallet charge":"Credit reservation checked before provider submission":paymentRefunded?"Stripe refund recorded for this order":paymentDisputed?"Payment is in dispute": "Secure payment verified by Stripe",state:paymentConfirmed||paymentRefunded||admin&&creditCharge?.status==="legacy"?"done" as const:admin?"pending" as const:"active" as const},
    {title:"Video generation",description:"Singing, expressions and camera direction",state:ready?"done" as const:working?"active" as const:"pending" as const},
    {title:"Final render & verification",description:"Private output retrieval and technical validation",state:ready?"done" as const:"pending" as const},
    {title:"Ready to download",description:"Your private MP4 is ready",state:ready?"done" as const:"pending" as const},
  ];
  // Provider processing stages cannot be measured as percentages. Never
  // display an invented completion percentage or estimated completion time.
  const label=paymentRefunded?"Your payment was refunded":paymentDisputed?"Payment under review":ready?"Your video is ready":inputRejected?"Update your photo or audio":releasedFailure?"Credits returned · Update your inputs":failed?"Video generation stopped":review?"Your video is under review":
    progress==="credits-needed"?"Not enough Credits":progress==="verifying-payment"?"Verifying your payment…":progress==="prepared"?"Ready for operator approval":progress==="queued"?"Your video is queued":
    working?"Generating your video":"Checking your video status";
  const detail=paymentRefunded?"This order has been refunded. You can review your original inputs and decide whether to create a new project.":
    paymentDisputed?"The original payment is under review. No new payment or provider task should be started for this order.":
    ready?"Watch your finished video and download the private MP4.":
    inputRejected&&releasedFailure?"The provider could not accept the supplied media. Your reserved Credits are available again; make changes in Studio before approving a new request.":
    inputRejected?"The provider rejected the supplied media. You can edit a new draft while the original Credit reservation is verified.":
    releasedFailure?"Your Credit reservation is released. Review a new draft before deciding whether to generate again.":
    failed||review?"The existing provider task and its billing are being checked. Do not pay again or resubmit this recording.":
    progress==="credits-needed"?"Your project is saved, but generation has not started because there are not enough available Credits. No Credits were charged.":
    progress==="verifying-payment"?"Waiting for the secure Stripe confirmation. No new order will be created.":
     progress==="prepared"?"Your project is prepared but has not been submitted for generation. Return to the private operator review for approval.":
    progress==="queued"?"Your request is waiting for processing. You can safely leave this page.":
    working?"Your music video is being created. This can take several minutes.":
    "Your existing project is being checked. Refreshing the page never starts another generation.";

  const formattedAmount=Number.isSafeInteger(amount)&&amount!==null&&amount!==undefined&&amount>=0
    ?new Intl.NumberFormat("en-IE",{style:"currency",currency:"EUR"}).format(amount/100):null;
  return <section className="sm-gen-page" aria-label="Video generation status">
    <header className="sm-gen-heading">
      <span className="sm-gen-eyebrow">SINGMOTION AI / VIDEO GENERATION</span>
      <h1>{label}</h1>
      <p>{detail}</p>
    </header>
    <CustomerFeedback notice={customerNotice} context="generation"/>
    <div className="sm-gen-payment" role="status">
      <span className={"sm-gen-payment-mark "+(paymentConfirmed?"is-done":"")}><ShieldCheck size={18}/></span>
      <span>{progress==="credits-needed"?"Insufficient Credits · nothing reserved or charged":admin?(creditCharge?.status==="settled"?"Video completed · Credits charged":creditCharge?.status==="released"?"Credits released · no final charge":creditCharge?.status==="review"?"Provider billing under review":creditCharge?.status==="reserved"?"Video queued · Credits reserved":creditCharge?.status==="legacy"?"Historical operator test · no wallet charge":"Video credit estimate · no charge yet"):paymentRefunded?"Payment refunded · Stripe":paymentDisputed?"Payment under dispute":paymentConfirmed?"Payment confirmed · Stripe":"Verifying your payment…"}</span>
      {admin?<strong title="Customer-facing credit charge, excluding internal BytePlus costs">{creditCharge?new Intl.NumberFormat("en-GB").format(creditCharge.credits)+" Credits"+(creditCharge.status==="settled"?" charged":creditCharge.status==="reserved"?" reserved":creditCharge.status==="review"?" held for review":creditCharge.status==="released"?" released":" estimated"):"Credit charge unavailable"}</strong>:
       formattedAmount&&(paymentConfirmed||paymentRefunded)&&<strong>{formattedAmount} {paymentRefunded?"refunded":"paid"}</strong>}
    </div>
    <div className="sm-gen-grid">
      <div className="sm-gen-media-column">
        <div className={"sm-gen-preview "+(format==="9:16"||(format===undefined&&imagePortrait)?"is-portrait":"is-landscape")}>
          {ready?<video src={videoUrl!} controls playsInline preload="metadata" aria-label="Your finished SingMotion video"/>:
            <div className="sm-gen-preview-placeholder">
              {photoUrl&&<img src={photoUrl} alt="Your uploaded artist reference" className="sm-gen-photo" onLoad={event=>setImagePortrait(event.currentTarget.naturalHeight>event.currentTarget.naturalWidth)}/>}
              <div className="sm-gen-glow" aria-hidden="true"/>
              <div className="sm-gen-preview-center"><span className="sm-gen-visual-icon"><Clapperboard size={31}/></span><strong>{label}</strong><p>{working?"AI is processing your video":progress==="credits-needed"?"Add Credits before starting generation":progress==="prepared"?"Awaiting private operator approval":progress==="queued"?"Waiting for generation":admin?"Checking Super Admin access and project status":paymentConfirmed?"Checking your private video":"Waiting for payment verification"}</p></div>
              {!ready&&!review&&!failed&&progress!=="prepared"&&progress!=="credits-needed"&&<div className="sm-gen-indeterminate" role="progressbar" aria-label="Video preparation in progress" aria-valuetext="Processing; no percentage available"><span/></div>}
            </div>}
          <span className="sm-gen-watermark">SingMotion <b>AI</b></span>
        </div>
        <p className="sm-gen-preview-caption">{ready?"Private video · verified delivery":review||failed?"Saved project · provider status recorded":"Private preview · video not yet available"}</p>
      </div>
      <div className="sm-gen-status-column">
        {note&&!failed&&!review&&!/network|failed to fetch|connection interrupted|timed out/i.test(note)&&<p className="sm-gen-status-message" role="status">{note}</p>}
        {progress==="credits-needed"&&<div className="sm-gen-credit-help" role="alert"><strong>Credits required to generate this video</strong><p>{creditCharge?`${new Intl.NumberFormat("en-GB").format(creditCharge.credits)} Credits needed. `:""}{typeof availableCredits==="number"?`${new Intl.NumberFormat("en-GB").format(availableCredits)} Credits available. `:""}Your project and uploaded files are saved. Return to Studio after adding sufficient Credits.</p><a className="sm-gen-reuse" href="/credits"><Wallet size={17}/> View Credits</a></div>}
        <h2>Generation progress</h2>
        <ol className="sm-gen-timeline">
          {stages.map((stage,index)=><li className={"sm-gen-milestone is-"+stage.state} key={stage.title}>
            <span className="sm-gen-milestone-icon" aria-hidden="true">{stage.state==="done"?<Check size={17}/>:stage.state==="active"?<LoaderCircle size={18}/>:<span className="sm-gen-empty-dot"/>}</span>
            <div className="sm-gen-milestone-content"><strong>{stage.title}</strong><span>{stage.description}</span></div>
            <small>{stage.state==="done"?"Done":stage.state==="active"?index===1?"Verifying":"In progress":"Pending"}</small>
          </li>)}
        </ol>
        <div className="sm-gen-wait">
          <Clock3 size={19}/><p><strong>{paymentRefunded?"Refund recorded":paymentDisputed?"Payment dispute in progress":ready?"Your video is complete":releasedFailure?"Your Credits are available again":progress==="credits-needed"?"Generation has not started":progress==="prepared"?"Awaiting generation confirmation":review||failed?"Existing task is being checked":"This may take several minutes."}</strong>
          <span>{paymentRefunded?"No additional payment or generation will be started.":paymentDisputed?"Wait for the payment review on this order before attempting a new purchase.":ready?"Download your video below.":releasedFailure?"Use Edit photo or audio to create a fresh draft without reusing the rejected provider request.":progress==="credits-needed"?"The project is saved. No video generation or credit charge has started.":progress==="prepared"?"This prepared project has not been submitted. Return to Studio to review it.":review||failed?"This project is saved. Its payment and provider evidence are being checked without starting another task.":"You can leave this page. Your order remains saved and you can return to check progress."}</span></p>
        </div>
        {ready?<a className="sm-gen-download" href={downloadUrl!} download><Download size={18}/> Download video</a>:
          <button className="sm-gen-download" type="button" disabled><LockKeyhole size={17}/> Download video</button>}
        {ready&&reuseHref&&<a className="sm-gen-reuse" href={reuseHref}><RotateCcw size={16}/> {reuseBlank?"Create another video":"Create another version"}</a>}
        {ready&&reuseHref&&<p className="sm-gen-reuse-note">{reuseBlank
          ?"Start a new video. Upload your audio and photo and choose your settings."
          :"Reuse your photo, audio selection, prompt and settings—or change anything before generating a new video. Your finished video stays saved."}</p>}
        <p className="sm-gen-download-note">{ready?"Private MP4 available now.":"Available only after the video has been verified and securely stored."}</p>
      </div>
    </div>
    
    <p className="sm-gen-disclaimer">AI-generated results may vary, including facial expressions, camera movement and lip synchronization. Your statutory rights remain unaffected.</p>
  </section>;
}
