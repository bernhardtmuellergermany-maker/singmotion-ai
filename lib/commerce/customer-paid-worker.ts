/** Automatic but fail-closed customer provider worker.
 * A customer payment is necessary but never sufficient: a dedicated, reviewed
 * non-pilot contract and explicit bounded spending authorization must exist.
 * This module performs no work merely by being imported.
 */
import {readFile} from "node:fs/promises";
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
 return env.RAILWAY_ENVIRONMENT_ID===STAGING &&
  env.CUSTOMER_PAID_WORKER_ENABLED==="true" &&
  env.CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED==="true" &&
  env.CUSTOMER_ACCOUNTS_ENABLED==="true" &&
  env.CUSTOMER_R2_STORAGE_ENABLED==="true" &&
  env.STRIPE_CHECKOUT_ENABLED==="true" &&
  /^sk_test_[A-Za-z0-9_]+$/.test(env.STRIPE_SECRET_KEY||"") &&
  /^whsec_[A-Za-z0-9_]+$/.test(env.STRIPE_WEBHOOK_SECRET||"");
}

export function validateCustomerWorkerPolicy(raw:unknown,now=Date.now()):ReviewedCustomerWorkerPolicy{
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
 for(const seconds of [
  reviewed.contract.generatedDurationBound!.minInputSeconds,
  reviewed.contract.generatedDurationBound!.maxInputSeconds,
 ]){
  if(planUpperBoundMicroUsd(seconds,reviewed.contract)>p.dailyCapMicroUsd)
   throw Error("Single customer clip would exceed reviewed daily provider ceiling");
 }
 return p;
}
export async function loadCustomerWorkerPolicy(root:string){
 const bytes=await readFile(path.join(root,"customer-byteplus-policy.json"));
 if(bytes.length<40||bytes.length>65536)throw Error("Invalid customer provider policy file");
 return validateCustomerWorkerPolicy(JSON.parse(bytes.toString("utf8")));
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
 const policy=await loadCustomerWorkerPolicy(root);
 // Validate every external dependency BEFORE claiming a single paid order.
 loadBytePlusCredentials(env);
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
  for(const orderId of store.pendingPaidFulfillment(limit)){
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
