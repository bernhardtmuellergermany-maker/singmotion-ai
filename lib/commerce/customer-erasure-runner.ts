/** Resumable noninteractive customer erasure coordinator.
 * Each invocation advances a bounded number of frozen accounts. All financial
 * Stripe calls use immutable, idempotent intents, media removal verifies exact
 * owner-bound cloud keys, and the finalizer preserves legal payment evidence.
 * Never claim "completed" until each irreversible step is verified.
 */
import path from "node:path";
import {existsSync} from "node:fs";
import {CommerceStore} from "./store.ts";
import {quoteCustomerErasureRefund} from "./customer-erasure-refund-quote.ts";
import {ensureDeletionRefundIntents,stageDeletionRefundIntents,advanceDeletionRefundIntent} from "./customer-erasure-refund-intents.ts";
import {readErasureJob,advanceErasureJob} from "./customer-erasure-job.ts";
import {assessCustomerMediaErasure,eraseCustomerMedia,CustomerMediaErasureBlocked} from "./customer-erasure-media.ts";
import {finalizeErasedCustomerData,AccountErasureFinalizationBlocked} from "./customer-erasure-finalize.ts";

export type ErasureRunSummary={checked:number;advanced:number;completed:number;deferred:number};
type Dependencies={
 stripeFetch?:typeof fetch;
 eraseMedia?:typeof eraseCustomerMedia;
 now?:number;
 limit?:number;
};
const issue=(error:unknown):string=>{
 if(error instanceof CustomerMediaErasureBlocked||
    error instanceof AccountErasureFinalizationBlocked)
  return error.code;
 return "AUTOMATED_ERASURE_STEP_UNVERIFIED";
};
const safe=(code:string)=>/^[A-Z0-9_]{3,80}$/.test(code)?code:"AUTOMATED_ERASURE_STEP_UNVERIFIED";
export async function runCustomerErasureJobs(
 root:string,deps:Dependencies={}
):Promise<ErasureRunSummary>{
 const result={checked:0,advanced:0,completed:0,deferred:0};
 const filename=path.join(root,"commerce.sqlite");
 if(!existsSync(filename))return result;
 const store=new CommerceStore(filename);
 const db=store.db;
 const bound=Math.max(1,Math.min(5,deps.limit??2));
 try{
  const jobs=db.prepare("SELECT account_id AS id,state FROM customer_erasure_jobs WHERE state NOT IN ('completed','needs-attention') ORDER BY updated_at ASC LIMIT ?")
   .all(bound) as {id:string;state:string}[];
  for(const row of jobs){
   result.checked++;
   try{
    const job=readErasureJob(db,row.id);
    if(!job||job.state==="completed"||job.state==="needs-attention")continue;
    if(job.state==="requested"){
     const quote=quoteCustomerErasureRefund(db,row.id);
     if(!quote.ready){
      result.deferred++;continue; // may be a still-pending Checkout or provider reservation
     }
     // A provider submission still running must not be erased. It is safe to
     // wait without authorizing a payout or losing the user's recovery token.
     assessCustomerMediaErasure(root,row.id);
     db.exec("BEGIN IMMEDIATE");
     try{
      const fresh=quoteCustomerErasureRefund(db,row.id);
      if(!fresh.ready||readErasureJob(db,row.id)?.state!=="requested")
       throw Error("Erasure conditions changed while freezing purchase ledger");
      ensureDeletionRefundIntents(db);
      stageDeletionRefundIntents(db,row.id,fresh.lines);
      advanceErasureJob(db,row.id,fresh.lines.length?"refunding":"removing-media");
      db.exec("COMMIT");
     }catch(e){db.exec("ROLLBACK");throw e}
     result.advanced++;continue;
    }
    if(job.state==="refunding"){
     ensureDeletionRefundIntents(db);
     const intents=db.prepare("SELECT purchase_id AS id,state FROM customer_erasure_refund_intents WHERE account_id=? ORDER BY created ASC,purchase_id ASC")
      .all(row.id) as {id:string;state:string}[];
     if(intents.some(x=>x.state==="failed"))
      throw new AccountErasureFinalizationBlocked("REFUND_FAILED");
     const pending=intents.find(x=>x.state!=="succeeded");
     if(pending){
      const updated=await advanceDeletionRefundIntent(db,pending.id,process.env,deps.stripeFetch??fetch);
      if(updated.state==="failed")throw new AccountErasureFinalizationBlocked("REFUND_FAILED");
      if(updated.state!=="succeeded"){result.deferred++;continue}
      result.advanced++;continue;
     }
     // All original Stripe payments have confirmed successful refunds.
     advanceErasureJob(db,row.id,"removing-media");result.advanced++;continue;
    }
    if(job.state==="removing-media"){
     await (deps.eraseMedia??eraseCustomerMedia)(root,row.id);
     advanceErasureJob(db,row.id,"removing-data");result.advanced++;continue;
    }
    if(job.state==="removing-data"){
     // A cross-store crash can leave a partially finished media step. Recheck.
     const media=assessCustomerMediaErasure(root,row.id);
     if(media.assets||media.studioProjects||media.providerTasks||
        media.paidOutputs||media.inputLeases||media.cloudSources)
      throw new AccountErasureFinalizationBlocked("MEDIA_NOT_ERASED");
     if(finalizeErasedCustomerData(store,row.id)){result.completed++;result.advanced++;}
    }
   }catch(e){
    const code=safe(issue(e));
    const previous=readErasureJob(db,row.id);
    if(!previous||previous.state==="completed")continue;
    const attempts=db.prepare("UPDATE customer_erasure_jobs SET attempts=attempts+1,updated_at=?,issue=? WHERE account_id=? AND state=?")
     .run(Date.now(),code,row.id,previous.state);
    if(!attempts.changes)continue;
    // Payment or media uncertainty must never progress to "completed".
    // Independent probes can restore transient access; repeated unverified
    // work is paused rather than looping financial mutations indefinitely.
    if(previous.attempts>=10||["REFUND_FAILED","INVALID_LOCAL_ASSET","UNKNOWN_ACCOUNT_REFERENCE",
       "UNTRUSTED_INPUT_LEASE","R2_PAID_VIDEO_OWNER_MISMATCH"].includes(code))
     advanceErasureJob(db,row.id,"needs-attention",code);
    result.deferred++;
   }
  }
  return result;
 }finally{store.close()}
}
