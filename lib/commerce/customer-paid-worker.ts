/** Automatic but fail-closed customer provider worker.
 * A customer payment is necessary but never sufficient: a dedicated, reviewed
 * non-pilot contract and explicit bounded spending authorization must exist.
 * This module performs no work merely by being imported.
 */
import {readFile} from "node:fs/promises";
import {ownerConfirmedBytePlusPolicy} from "./owner-confirmed-provider-policy.ts";
import {productionCustomerReleaseApproved} from "./customer-live-config.ts";
import path from "node:path";
import {CommerceStore} from "./store.ts";
import {dispatchReviewedCustomerBytePlus} from "./customer-byteplus-dispatch.ts";
import {CustomerR2PrivateInputDelivery} from "./customer-r2-inputs.ts";
import {verifyPrivatePaidMediaSnapshot} from "./verify-paid-media.ts";
import {runPaidRecoveryBatch} from "./paid-recovery-batch.ts";
import {validateStudioPolicy,type StudioPolicy} from "../live/studio-policy.ts";
import {planUpperBoundMicroUsd} from "../live/contract.ts";
import {loadBytePlusCredentials} from "../live/signing.ts";
import {createSignedTransport} from "../live/signed-transport.ts";
import {BytePlusProtocol} from "../live/byteplus.ts";
import {loadR2Config} from "../live/r2-config.ts";
import {privateOutputTransport} from "../live/output-transport.ts";

const STAGING="dfaeabed-03df-43ed-aa71-50f343a75041";
export type ReviewedCustomerWorkerPolicy={
 reviewedBy:string;
 reviewedAt:string;
 expiresAt:string;
 billingEvidence:string;
 outputEvidence:string;
 contract:StudioPolicy["contract"];
 dailyCapMicroUsd:number;
 lifetimeCapMicroUsd:number;
};

export function customerWorkerEnabled(env:Record<string,string|undefined>){
 const live=productionCustomerReleaseApproved(env);
 const test=env.RAILWAY_ENVIRONMENT_ID===STAGING &&
   env.STRIPE_CHECKOUT_ENABLED==="true" &&
   /^sk_test_[A-Za-z0-9_]+$/.test(env.STRIPE_SECRET_KEY||"") &&
   /^whsec_[A-Za-z0-9_]+$/.test(env.STRIPE_WEBHOOK_SECRET||"");
 return (test||live) &&
  env.CUSTOMER_PAID_WORKER_ENABLED==="true" &&
  env.CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED==="true" &&
  env.CUSTOMER_BYTEPLUS_OWNER_CONFIRMED_PRICING==="true" &&
  Number.isSafeInteger(Number(env.CUSTOMER_PAID_WORKER_ACTIVATED_AT)) &&
  Number(env.CUSTOMER_PAID_WORKER_ACTIVATED_AT)>0 &&
  Number(env.CUSTOMER_PAID_WORKER_ACTIVATED_AT)<=Date.now() &&
  env.CUSTOMER_ACCOUNTS_ENABLED==="true" &&
  env.CUSTOMER_R2_STORAGE_ENABLED==="true";
}

export function validateCustomerWorkerPolicy(raw:unknown,now=Date.now(),environmentId?:string):ReviewedCustomerWorkerPolicy{
 const p=raw as ReviewedCustomerWorkerPolicy;
 if(!p||typeof p!=="object" ||
    !Number.isSafeInteger(p.dailyCapMicroUsd)||p.dailyCapMicroUsd<1 ||
    !Number.isSafeInteger(p.lifetimeCapMicroUsd)||p.lifetimeCapMicroUsd<1 ||
    p.dailyCapMicroUsd>1_000_000_000 ||p.lifetimeCapMicroUsd>1_000_000_000 ||
    p.dailyCapMicroUsd>p.lifetimeCapMicroUsd||
    !p.billingEvidence?.trim()||p.billingEvidence.trim().length<20||
    !p.outputEvidence?.trim()||p.outputEvidence.trim().length<20||
    p.contract?.pilotAdmission)
  throw Error("Customer BytePlus contract or budget review missing");
 const reviewed=validateStudioPolicy(p);
 // Do not extrapolate the vendor's 5-second operator test to customer clips.
 // Verified billing must include a finite upper bound for every cost component.
 const b=reviewed.contract.billing;
 if([b.microUsdPerSecond,b.minimumBillableMs,b.billingQuantumMs,
     b.minimumChargeMicroUsd,b.fixedFeeMicroUsd,b.taxBasisPointsUpperBound]
    .some(x=>!Number.isSafeInteger(x)||x===null||Number(x)<0))
  throw Error("Verified inclusive customer billing terms required");
 if(Date.parse(p.expiresAt)-now>30*86400000)
  throw Error("Customer provider review cannot extend more than 30 days");
 // The private file itself does not establish Production provenance. Never
 // accept the Staging pilot merely because it was copied to a live volume.
 if(environmentId==="36adc41d-7e54-4396-ad1a-fd432ba0441d" &&
    (!p.contract.revision.startsWith("production-") ||
     p.reviewedBy.startsWith("SingMotion-owner-user-confirmation-2026-11-05")))
  throw Error("Independent production customer provider policy review required");
 for(const seconds of [
  reviewed.contract.generatedDurationBound!.minInputSeconds,
  reviewed.contract.generatedDurationBound!.maxInputSeconds,
 ]){
  if(planUpperBoundMicroUsd(seconds,reviewed.contract)>p.dailyCapMicroUsd)
   throw Error("Single customer clip would exceed reviewed daily provider ceiling");
 }
 return p;
}
export async function loadCustomerWorkerPolicy(root:string,env:Record<string,string|undefined>=process.env){
 // A private, explicitly approved policy takes precedence. If none was
 // installed, use the dated 2026-11-05 owner-attested billing/delivery policy
 // ONLY on protected Staging with explicit owner confirmation; never Production.
 try{
  const bytes=await readFile(path.join(root,"customer-byteplus-policy.json"));
  if(bytes.length<40||bytes.length>65536)throw Error("Invalid customer provider policy file");
  return validateCustomerWorkerPolicy(JSON.parse(bytes.toString("utf8")),
   Date.now(),env.RAILWAY_ENVIRONMENT_ID);
 }catch(error){
  if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;
  // A protected Railway variable can supply a reviewed server-only policy
  // when the private volume has no policy file. Never override an existing
  // file, including an invalid one; never accept a staging pilot in Production.
  const configured=env.CUSTOMER_BYTEPLUS_POLICY_JSON;
  if(configured!==undefined){
   const size=Buffer.byteLength(configured,"utf8");
   if(size<40||size>65536)throw Error("Invalid customer provider policy configuration");
   return validateCustomerWorkerPolicy(JSON.parse(configured),Date.now(),
    env.RAILWAY_ENVIRONMENT_ID);
  }
  // A dated operator policy may be reused for private Staging only.
  // Production needs its own separately reviewed policy, finite per-job
  // reservation ceilings and approved exact output hosts.
  if(env.RAILWAY_ENVIRONMENT_ID!==STAGING||
     env.CUSTOMER_BYTEPLUS_OWNER_CONFIRMED_PRICING!=="true")
   throw Error("An approved private production customer provider policy is required");
  return validateCustomerWorkerPolicy(ownerConfirmedBytePlusPolicy());
 }
}
export type CustomerWorkerResults={
 status:"disabled"|"ready";
 submitted:number;
 alreadyClaimed:number;
 uncertain:number;
 requiresReview:number;
 recovered:number;
};

/** Once per periodic worker tick; never attempts an unauthorized second submit.
 * One failed order does not block other independent eligible orders.
 */
export async function runCustomerPaidWorkerBatch(
 root:string,
 env:Record<string,string|undefined>=process.env,
 limit=2,
):Promise<CustomerWorkerResults>{
 if(!customerWorkerEnabled(env))
  return {status:"disabled",submitted:0,alreadyClaimed:0,uncertain:0,requiresReview:0,recovered:0};
 if(!Number.isSafeInteger(limit)||limit<1||limit>5)throw Error("Invalid paid dispatch batch");
 const policy=await loadCustomerWorkerPolicy(root,env);
 // Validate every external dependency BEFORE claiming a single paid order.
 const byteplus=loadBytePlusCredentials(env);
 if(byteplus.accessKeyId.length<8||byteplus.secretAccessKey.length<16)
  throw Error("BytePlus credentials are not configured");
 loadR2Config(env);
 const store=new CommerceStore(path.join(root,"commerce.sqlite"));
 const transport=createSignedTransport(fetch,()=>loadBytePlusCredentials(env));
 const protocol=new BytePlusProtocol(transport);
 const result:CustomerWorkerResults={status:"ready",submitted:0,alreadyClaimed:0,uncertain:0,requiresReview:0,recovered:0};
 try{
  // Recover only already acknowledged provider IDs; no new paid submissions.
  const recoveries=await runPaidRecoveryBatch(store,root,policy.contract,
   transport,privateOutputTransport,AbortSignal.timeout(180000),5);
  result.recovered=recoveries.filter(x=>x.state==="delivered"||x.state==="already-delivered").length;
  result.requiresReview+=recoveries.filter(x=>x.state==="requires-review"||x.state==="unverified").length;
  // Aggregate allowlisted reasons only: never log order IDs, provider job IDs,
  // output URLs, raw provider responses, credentials or customer information.
  const reviewCounts=Object.fromEntries(
   ["provider_status_unavailable","provider_authentication","provider_throttled","provider_transient","provider_protocol","provider_rejected","provider_denied","provider_prefilter","provider_unsupported_status","provider_completed_without_url","provider_noncompletion","provider_done_missing_output","provider_empty_output_payload","provider_invalid_output_video_url","provider_missing_task_data","provider_invalid_output_json","provider_invalid_output_object","provider_output_payload_too_large","private_source_failed","private_provider-host_failed","private_provider-dns_failed","private_provider-network_failed","private_provider-http_failed","private_provider-headers_failed","private_provider-private-file_failed","private_provider-media_failed","private_provider-media-format_failed","private_provider-media-codec_failed","private_provider-media-dimensions_failed","private_provider-media-duration_failed","private_provider-media-framerate_failed","private_provider-media-normalization_failed","private_provider-download_failed","private_provider-validation_failed","private_tempo-restoration_failed","private_private-archive_failed","private_output_validation_failed"]
    .map(reason=>[reason,recoveries.filter(x=>x.diagnostic===reason).length])
  );
  if(Object.values(reviewCounts).some(count=>count>0))
   console.info("Customer paid recovery review categories",reviewCounts);

  for(const orderId of store.pendingPaidFulfillmentSince(Number(env.CUSTOMER_PAID_WORKER_ACTIVATED_AT),limit)){
   const lease=new CustomerR2PrivateInputDelivery(store,orderId,root,env);
   try{
    const outcome=await dispatchReviewedCustomerBytePlus(store,orderId,{
     contract:policy.contract,
     delivery:lease,
     inputHosts:lease.inputHosts,
     protocol,
     dailyCapMicroUsd:policy.dailyCapMicroUsd,
     lifetimeCapMicroUsd:policy.lifetimeCapMicroUsd,
     reviewEvidence:policy.billingEvidence+"; "+policy.outputEvidence,
     signal:AbortSignal.timeout(150000),
     verify:verifyPrivatePaidMediaSnapshot,
    },env);
    if(outcome==="submitted")result.submitted++;
    else if(outcome==="already-claimed")result.alreadyClaimed++;
    else result.uncertain++;
   }catch{
    // Never put a claimed/uncertain request back in the queue for re-submission.
    result.requiresReview++;
   }finally{lease.close()}
  }
  return result;
 }finally{store.close()}
}
