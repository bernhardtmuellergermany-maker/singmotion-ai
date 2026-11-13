/** Customer-facing status copy. Never infer a charge, refund or task failure from a browser timeout. */
export type CustomerNotice = {
  key: string;
  kind: "info" | "success" | "warning" | "error";
  title: string;
  message: string;
  action?: {label:string;href:string};
  /** Only positive/transient messages disappear automatically. Errors and unsettled money remain visible. */
  dismissAfterMs?: number;
};

export type CreditCharge = {
  credits: number;
  status: "estimated" | "reserved" | "review" | "settled" | "released" | "legacy";
};

const number = (n:number) => new Intl.NumberFormat("en-GB").format(n);
/** Only same-origin, owner-checked Studio copy URLs may act on failed project media.
 * The Studio copy endpoint creates a fresh draft; never reuses a provider task
 * or an old paid reservation. A fallback opens Studio, not the wallet. */
export function editInputsAction(editHref?:string|null):{label:string;href:string} {
  return {label:"Edit photo or audio",
    href:typeof editHref==="string"&&/^\/studio\?copy=live_[a-f0-9-]{36}$/i.test(editHref)
      ?editHref:"/studio"};
}

export function generationFeedback(
  progress: "credits-needed" | "verifying-payment" | "prepared" | "queued" | "processing" | "review" | "ready" | "failed" | "unavailable",
  charge?: CreditCharge | null,
  available?: number | null,
  editHref?:string|null,
): CustomerNotice | null {
  if (progress === "ready")
    return {key:"video-ready",kind:"success",title:"Your video is ready",
      message:"Your private video has been verified. You can play or download it below.",dismissAfterMs:9000};
  if (progress === "credits-needed") {
    const needed=charge?.credits;
    const shortfall=typeof needed==="number"&&typeof available==="number"?Math.max(0,needed-available):null;
    return {key:"credits-needed",kind:"warning",title:"Not enough Credits to generate",
      message:`Your project is saved and generation has not started. No Credits were charged.${shortfall!==null?` Add ${number(shortfall)} more Credits to continue.`:""}`,
      action:{label:"Buy Credits",href:"/credits#buy-credits"}};
  }
  if (progress === "verifying-payment")
    return {key:"payment-verifying",kind:"info",title:"Waiting for payment confirmation",
      message:"Stripe has not yet confirmed this payment to SingMotion. Do not pay again while we check your existing order."};
  if (progress === "failed") {
    if(charge?.status==="released")
      return {key:"generation-failed-released",kind:"warning",title:"Video not created · Credits returned",
        message:`${number(charge.credits)} reserved Credits have been released to your available balance. You can update your audio or photo in a new draft. Nothing is generated or charged until you explicitly approve a new request.`,
        action:editInputsAction(editHref)};
    if(charge?.status==="review"||charge?.status==="reserved")
      return {key:"generation-failed-held",kind:"warning",title:"Video stopped · Credit reservation being checked",
        message:`${number(charge.credits)} Credits remain reserved while we verify whether the provider generated or billed the existing task. You are not being charged again. Please do not submit another paid request.`};
    return {key:"generation-failed",kind:"error",title:"Video could not be completed",
      message:"The original task remains saved. We cannot confirm a Credit return from this status. No new paid task will start automatically."};
  }
  if (progress === "review")
    return {key:"generation-review",kind:"warning",title:"We are checking your existing video",
      message:charge?.status==="review"||charge?.status==="reserved"?
        `${number(charge.credits)} Credits remain reserved; no final debit or refund has been confirmed. Do not submit this request again.`:
        "The provider or delivery status is uncertain. No second paid request will be started automatically. Check back for a verified update."};
  if (progress === "unavailable")
    return {key:"generation-unavailable",kind:"warning",title:"Status temporarily unavailable",
      message:"We cannot verify your video right now. This does not mean the video or payment failed. Reconnect and open this saved project; do not submit or pay again."};
  if (progress === "prepared")
    return {key:"generation-prepared",kind:"info",title:"Your project is saved",
      message:"Audio, photo and settings are ready for review. Video generation has not started and no Credits have been charged."};
  if (progress === "queued")
    return {key:"generation-queued",kind:"info",title:"Your video is queued",
      message:charge?.status==="reserved"?
        `${number(charge.credits)} Credits are reserved, not yet charged. You can leave and return to this project.`:
        "Your existing request is queued. You can leave and return to this project; do not submit it again."};
  if (progress === "processing")
    return {key:"generation-processing",kind:"info",title:"Your video is being generated",
      message:"The provider is processing your request. The completion time cannot be predicted. You can safely return to this saved project later."};
  return null;
}

/** Only a verified ledger state can confirm a credit return. */
export function providerFeedback(
  state:string,stage:string,charge?:CreditCharge|null,createdAt?:number,
  now=Date.now(),editHref?:string|null,
):CustomerNotice|null {
  const codes=[...String(stage||"").matchAll(/\[([A-Z][A-Z0-9_]{2,79})\]/g)].map(match=>match[1]);
  const has=(code:string)=>codes.includes(code);
  if(state==="failed"){
    // Code is server-generated from the persisted BytePlus task, never from
    // an upload filename or user-supplied message. Only the durable wallet
    // state 'released' proves that a hold is spendable again.
    if(has("CONTENT_PREFILTER_REJECTED")){
      if(charge?.status==="released")
        return {key:"provider-prefilter-released",kind:"warning",
          title:"Photo or audio not accepted · Credits released",
          message:`The video provider rejected the submitted photo or audio before generating a video. ${number(charge.credits)} reserved Credits have been released and are available again. Update your photo or audio, then review a NEW request when you're ready.`,
          action:editInputsAction(editHref)};
      return {key:"provider-prefilter-awaiting-ledger",kind:"warning",
        title:"Photo or audio not accepted · Credit release pending",
        message:"The provider rejected the input before generating a video. We cannot yet confirm that the Credit reservation was released to your available balance. You can edit a new draft now, but do not start another paid generation until the original reservation is resolved.",
        action:editInputsAction(editHref)};
    }
    if(has("PROVIDER_JOB_FAILED")||has("PROVIDER_TASK_CANCELED"))
      return {key:"provider-terminal-billing-review",kind:"warning",
        title:"The video provider stopped this task",
        message:"The original task was not completed. A provider failure does not prove that it was free of charge. We are checking the existing reservation; no second request will be submitted automatically."};
    if(["MISSING_OUTPUT","INVALID_OUTPUT","OUTPUT_MP4_VALIDATION_FAILED","OUTPUT_DOWNLOAD_OR_VALIDATION_FAILED","OUTPUT_STORAGE_FAILED","TEMPO_RESTORATION_FAILED"].some(has))
      return {key:"provider-output-validation",kind:"warning",
        title:"Your video output could not be verified",
        message:"The source photo and audio may be fine. The result was not delivered successfully. Please keep this project: its original provider task and Credit reservation must be checked, not submitted again."};
    return generationFeedback("failed",charge,undefined,editHref);
  }
  if(state==="uncertain"||state==="output_observed"||state==="submitting"||state==="authorized")
    return generationFeedback("review",charge);
  if((state==="submitted"||state==="processing")&&typeof createdAt==="number"&&Number.isFinite(createdAt)&&createdAt>0&&now-createdAt>45*60*1000)
    return {key:"provider-delayed",kind:"warning",title:"Your video is taking longer than usual",
      message:"The existing provider task is still being checked automatically. Your files are saved. No second video will be submitted or charged, and the reserved Credits will only be released after a confirmed non-billable result."};
  if(state==="submitted")return generationFeedback("queued",charge);
  if(state==="processing")return generationFeedback("processing",charge);
  if(state==="prepared")return generationFeedback("prepared",charge);
  if(state==="completed")return generationFeedback("ready",charge);
  return null;
}

/** The paid order is charged through Stripe, NOT the prepaid Credit wallet.
 * Only the verified owner-scoped order status may justify "payment refunded".
 * A provider failure without a verified external refund never promises money. */
export function paidOrderFeedback(
  paymentStatus:string|null|undefined,
  fulfillmentState:string|null|undefined,
  editDraftHref?:string|null,
):CustomerNotice|null {
  if(paymentStatus==="refunded"){
    const draftSafe=typeof editDraftHref==="string"&&
      /^\/studio\?copy=draft_[A-Za-z0-9_-]{1,80}$/.test(editDraftHref);
    return {key:"order-payment-refunded",kind:"success",title:"Your video payment was refunded",
      message:"This order has been marked refunded. A refund to your original payment method can take time to appear. No new video is started automatically.",
      action:draftSafe?{label:"Edit photo or audio",href:editDraftHref}:{label:"Start a new Studio draft",href:"/studio?new=1"}};
  }
  if(paymentStatus==="disputed")
    return {key:"order-payment-disputed",kind:"warning",title:"Your payment is under review",
      message:"The payment is in a dispute or reversal process. Do not place another order for this video. No new generation is started automatically."};
  if(paymentStatus==="paid"&&["failed","requires-review"].includes(fulfillmentState??""))
    return {key:"paid-output-not-delivered",kind:"warning",title:"Your paid video could not be delivered",
      message:"The payment is confirmed, but the existing provider task or video delivery was not successful. Billing and refund eligibility must be verified before a replacement is charged. Do not pay again or submit a duplicate order."};
  return null;
}

export function checkoutFeedback(result:string|null):CustomerNotice|null {
  if(result==="cancelled")
    return {key:"checkout-cancelled",kind:"info",title:"Checkout cancelled",
      message:"You returned without completing this purchase. No Credits have been added for this checkout. Your previous balance is unchanged.",dismissAfterMs:15000};
  if(result==="success")
    return {key:"checkout-returned",kind:"info",title:"Payment confirmation pending",
      message:"You returned from Stripe. Credits are added only after the verified payment reaches your wallet. Check the balance below before paying again.",dismissAfterMs:20000};
  return null;
}

export function requestErrorFeedback(error:string,context:"upload"|"payment"|"generation"):CustomerNotice {
  const offline=/network|fetch|offline|timeout|timed out|connection|abort|interrupted|not respond/i.test(error);
  if(offline) return {key:"connection-"+context,kind:"warning",title:"Connection interrupted",
    message:context==="payment"?
      "We cannot confirm whether Stripe received your request. Reconnect and check your wallet before attempting another payment.":
      context==="generation"?
        "We cannot confirm whether your request reached the provider. Open the saved project to check its status; do not start a second paid request.":
        "The upload may be incomplete. Reconnect, then check whether the file appears in your Studio before uploading again."};
  if(/insufficient|not enough.*credit/i.test(error))return generationFeedback("credits-needed")!;
  if(/429|rate.?limit|too many requests/i.test(error))
    return {key:"rate-limit-"+context,kind:"warning",title:"Too many requests",
      message:"Please wait before trying again. Your saved video or payment is not automatically repeated."};
  if(/declined|payment failed|card.*(failed|rejected)/i.test(error)&&context==="payment")
    return {key:"payment-declined",kind:"error",title:"Payment was not completed",
      message:"No new Credits are available from this attempt. Check the Stripe payment result and your wallet before trying a different payment method."};
  if(/maintenance|service unavailable|503|502|gateway|temporarily unavailable/i.test(error))
    return {key:"service-unavailable-"+context,kind:"warning",title:"Service temporarily unavailable",
      message:"SingMotion cannot confirm this step right now. Your existing project remains saved where confirmed; do not create a duplicate payment or generation."};
  if(context==="upload"&&/invalid|unsupported|too (large|small)|exceeds|file size|decode|format|corrupt/i.test(error))
    return {key:"invalid-upload",kind:"error",title:"Please check your audio or photo",
      message:"The file was not accepted. Check its format, dimensions and file size. Choose a supported file and upload it again."};
  if(/401|403|sign.?in|session|authorization|authentication/i.test(error))
    return {key:"session-required",kind:"warning",title:"Your session needs attention",
      message:"Sign in again to confirm your account and saved project. Do not submit another paid request until you have checked the existing one.",
      action:{label:"Sign in",href:"/login"}};
  if(context==="upload")
    return {key:"upload-rejected",kind:"error",title:"Audio or photo could not be uploaded",
      message:"Check the file type, size and whether the audio or image opens correctly. Replace the file, then try uploading again."};
  if(context==="payment")
    return {key:"payment-error",kind:"error",title:"Payment could not be started",
      message:"Stripe Checkout is not available right now. No wallet credit has been confirmed. Check your wallet before retrying."};
  return {key:"generation-error",kind:"error",title:"We could not confirm your generation request",
    message:"Your project remains saved. Check its status before retrying. A network or provider error is not proof that your Credits were refunded."};
}
