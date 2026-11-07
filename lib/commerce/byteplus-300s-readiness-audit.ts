/** Read-only evidence checklist for the same 5–300 second target in Staging
 * and Production. It never contacts BytePlus, authorizes spending, or treats
 * a structurally valid local JSON file as provider-issued evidence.
 * Only stable codes leave this module; no secrets, hosts or media are logged.
 */
import {SHARED_BYTEPLUS_TARGET_POLICY as TARGET} from "./shared-byteplus-target-policy.ts";
import {validateStudioPolicy,type StudioPolicy} from "../live/studio-policy.ts";
import {planUpperBoundMicroUsd} from "../live/contract.ts";

export type BytePlus300AuditCode=
 "REVIEWED_POLICY_REQUIRED"|
 "NON_PILOT_BILLING_REQUIRED"|
 "INDEPENDENT_PROVIDER_EVIDENCE_REQUIRED"|
 "DURATION_COVERAGE_MISSING"|
 "GENERATED_DURATION_EXCEEDS_MODEL"|
 "OUTPUT_ENVELOPE_INCOMPLETE"|
 "PRIVATE_TRANSFER_EVIDENCE_REQUIRED"|
 "EXACT_OUTPUT_HOSTS_REQUIRED"|
 "MAX_JOB_COST_NOT_REVIEWABLE";

export type BytePlus300Audit={
 targetRevision:string;
 minInputSeconds:number;
 maxInputSeconds:number;
 baseRateMicroUsdPerGeneratedSecond:number;
 // No daily or lifetime *product* quota. Provider billing/credit lines
 // and individual customer-worker reservations remain separate.
 dailyBudgetMicroUsd:null;
 lifetimeBudgetMicroUsd:null;
 reviewStructurallyComplete:boolean;
 vendorAccountVerified:false;
 paidDispatchApproved:false;
 blockers:BytePlus300AuditCode[];
};

function coveringPolicies(root:StudioPolicy){
 const policies=[root,...(root.durationBands||[])];
 const ranges=policies.map(p=>({
  policy:p,
  min:p.contract.generatedDurationBound!.minInputSeconds,
  max:p.contract.generatedDurationBound!.maxInputSeconds,
 })).sort((a,b)=>a.min-b.min);
 let coveredTo=TARGET.minInputSeconds;
 const used:StudioPolicy[]=[];
 for(const r of ranges){
  if(r.max<coveredTo)continue;
  if(r.min>coveredTo)return null;
  used.push(r.policy);
  coveredTo=Math.max(coveredTo,r.max);
  if(coveredTo>=TARGET.maxInputSeconds)return used;
 }
 return null;
}

/** This is a LOCAL completeness audit, not confirmation of external truth.
 * Even a clean audit requires independently verified BytePlus account terms,
 * separately approved payment flow, and explicit single-job authorization.
 */
export function auditBytePlus300SecondPolicy(raw:unknown):BytePlus300Audit{
 const blockers=new Set<BytePlus300AuditCode>();
 let root:StudioPolicy|undefined;
 try{root=validateStudioPolicy(raw)}
 catch{blockers.add("REVIEWED_POLICY_REQUIRED")}
 if(root){
  const policies=coveringPolicies(root);
  if(!policies)blockers.add("DURATION_COVERAGE_MISSING");
  for(const p of policies||[root]){
   const c=p.contract,b=c.generatedDurationBound!;
   if(c.pilotAdmission||c.billing.minimumBillableMs===null||
      c.billing.billingQuantumMs===null||
      c.billing.minimumChargeMicroUsd===null||
      c.billing.fixedFeeMicroUsd===null||
      c.billing.taxBasisPointsUpperBound===null)
    blockers.add("NON_PILOT_BILLING_REQUIRED");
   if(c.revision.startsWith("super-admin-runtime-")||
      p.reviewedBy.startsWith("authenticated-super-admin-")||
      p.reviewedBy.startsWith("server-owned-super-admin-")||
      p.reviewedBy.startsWith("SingMotion-owner-user-confirmation-"))
    blockers.add("INDEPENDENT_PROVIDER_EVIDENCE_REQUIRED");
   if(b.maxInputSeconds+b.maxAdditionalSeconds>300)
    blockers.add("GENERATED_DURATION_EXCEEDS_MODEL");
   if(!c.output.maxDurationSeconds||
      c.output.maxDurationSeconds<b.maxInputSeconds+b.maxAdditionalSeconds||
      c.output.audioCodec!=="aac"||
      !["h264","hevc"].includes(c.output.videoCodec))
    blockers.add("OUTPUT_ENVELOPE_INCOMPLETE");
   if(!c.output.transfer?.evidence?.trim())
    blockers.add("PRIVATE_TRANSFER_EVIDENCE_REQUIRED");
   if(!c.outputHosts.length)
    blockers.add("EXACT_OUTPUT_HOSTS_REQUIRED");
   try{planUpperBoundMicroUsd(b.maxInputSeconds,c)}
   catch{blockers.add("MAX_JOB_COST_NOT_REVIEWABLE")}
  }
 }
 return {
  targetRevision:TARGET.revision,
  minInputSeconds:TARGET.minInputSeconds,
  maxInputSeconds:TARGET.maxInputSeconds,
  baseRateMicroUsdPerGeneratedSecond:TARGET.microUsdPerGeneratedSecond,
  dailyBudgetMicroUsd:null,
  lifetimeBudgetMicroUsd:null,
  reviewStructurallyComplete:blockers.size===0,
  vendorAccountVerified:false,
  paidDispatchApproved:false,
  blockers:[...blockers],
 };
}
