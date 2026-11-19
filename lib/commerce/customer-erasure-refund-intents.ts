/**
 * Stripe partial-credit refund intents for account erasure.
 *
 * A refund is a financial mutation. Always persist the exact buyer-bound
 * intent BEFORE a POST, and use one stable Stripe idempotency key. Repeated
 * worker attempts must inspect the known Refund ID instead of creating a
 * replacement. This module does NOT erase customer records, issue credits
 * or finalize an erasure; higher-level job state must be frozen and reviewed.
 */
import type {DatabaseSync} from "node:sqlite";
import type {ErasureRefundLine} from "./customer-erasure-refund-quote.ts";
import {customerStripeCredential,type StripePaymentMode} from "./stripe-payment-mode.ts";
import {readErasureJob} from "./customer-erasure-job.ts";
import {validStripeRefundId} from "./stripe-reversal-identifiers.ts";
const PRODUCTION="36adc41d-7e54-4396-ad1a-fd432ba0441d";
const STAGING="dfaeabed-03df-43ed-aa71-50f343a75041";
type Env=Record<string,string|undefined>;
export type DeletionRefundIntent={
 accountId:string;purchaseId:string;sessionId:string;credits:number;cents:number;
 state:"ready"|"pending"|"succeeded"|"failed";refundId:string|null;sentAt:number|null;
};
export function ensureDeletionRefundIntents(db:DatabaseSync){
 db.exec(`CREATE TABLE IF NOT EXISTS customer_erasure_refund_intents(
 purchase_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,
 session_id TEXT NOT NULL,credits INTEGER NOT NULL CHECK(credits>0),
 cents INTEGER NOT NULL CHECK(cents>0),state TEXT NOT NULL
 CHECK(state IN ('ready','pending','succeeded','failed')),
 refund_id TEXT UNIQUE,sent_at INTEGER,created INTEGER NOT NULL,updated INTEGER NOT NULL
 )`);
}
const read=(db:DatabaseSync,purchaseId:string):DeletionRefundIntent|null=>{
 const row=db.prepare("SELECT account_id AS accountId,purchase_id AS purchaseId,session_id AS sessionId,credits,cents,state,refund_id AS refundId,sent_at AS sentAt FROM customer_erasure_refund_intents WHERE purchase_id=?")
 .get(purchaseId) as DeletionRefundIntent|undefined;
 return row??null;
};
export function stageDeletionRefundIntents(db:DatabaseSync,accountId:string,lines:readonly ErasureRefundLine[]):DeletionRefundIntent[]{
 if(!/^[a-f0-9-]{36}$/i.test(accountId))throw Error("Invalid account");
 const job=readErasureJob(db,accountId);
 if(!job||!["requested","refunding"].includes(job.state))
  throw Error("Deletion refund requires a frozen customer account");
 ensureDeletionRefundIntents(db);
 const now=Date.now(),results:DeletionRefundIntent[]=[];
 // No browser-supplied amounts. Caller must pass only verified ledger quote
 // and use an enclosing write transaction when freezing account purchase.
 for(const line of lines){
  const purchase=db.prepare("SELECT subject,status,credits,cents,stripe_session_id FROM credit_topup_purchases WHERE id=?")
   .get(line.purchaseId) as {subject:string;status:string;credits:number;cents:number;stripe_session_id:string|null}|undefined;
  if(!purchase||purchase.subject!=="customer:"+accountId||
     purchase.status!=="paid"||purchase.stripe_session_id!==line.sessionId||
     !Number.isSafeInteger(line.credits)||!Number.isSafeInteger(line.cents)||
     line.credits<1||line.credits>purchase.credits||line.cents<1||line.cents>purchase.cents||
     line.cents!==line.credits)
   throw Error("Deletion refund intent differs from paid ledger");
  const existing=read(db,line.purchaseId);
  if(existing){
   if(existing.accountId!==accountId||existing.sessionId!==line.sessionId||
      existing.cents!==line.cents||existing.credits!==line.credits)
    throw Error("Deletion refund intent idempotency conflict");
   results.push(existing);continue;
  }
  db.prepare("INSERT INTO customer_erasure_refund_intents VALUES(?,?,?, ?,?,'ready',NULL,NULL,?,?)")
   .run(line.purchaseId,accountId,line.sessionId,line.credits,line.cents,now,now);
  results.push(read(db,line.purchaseId)!);
 }
 return results;
}
type StripeSession={id?:string;mode?:string;livemode?:boolean;currency?:string;
 payment_status?:string;amount_total?:number;payment_intent?:string;
 metadata?:{creditTopupId?:string;flow?:string}};
type StripeRefund={id?:string;object?:string;payment_intent?:string;amount?:number;
 currency?:string;status?:string;livemode?:boolean;
 metadata?:{erasure_intent?:string;erasure_purchase?:string}};
async function request<T>(pathname:string,key:string,verb:"GET"|"POST",body:URLSearchParams|undefined,
 sender:typeof fetch):Promise<T>{
 const r=await sender("https://api.stripe.com/v1/"+pathname,{
  method:verb,
  headers:{Authorization:"Bearer "+key,
   ...(verb==="POST"?{"Content-Type":"application/x-www-form-urlencoded"}:{}) ,
   ...(verb==="POST"&&body?{"Idempotency-Key":body.get("metadata[erasure_intent]")!}:{})},
  ...(body?{body}:{}),signal:AbortSignal.timeout(12000),cache:"no-store"
 });
 if(!r.ok)throw Error("Original-payment refund could not be verified by Stripe");
 return r.json() as Promise<T>;
}
/** Completes at most ONE immutable purchase refund intent; never processes
 * an unbound purchase. No automatic retry after an explicit Stripe failure.
 */
export async function advanceDeletionRefundIntent(
 db:DatabaseSync,purchaseId:string,env:Env=process.env,sender:typeof fetch=fetch
):Promise<DeletionRefundIntent>{
 const intent=read(db,purchaseId);
 if(!intent)throw Error("Missing deletion refund intent");
 if(readErasureJob(db,intent.accountId)?.state!=="refunding")
  throw Error("Stripe refund is not authorized by active erasure job");
 if(intent.state==="succeeded"||intent.state==="failed")return intent;
 const isLive=intent.sessionId.startsWith("cs_live_");
 if(!isLive&&!intent.sessionId.startsWith("cs_test_"))throw Error("Invalid payment mode");
 const mode:StripePaymentMode=isLive?"live":"test";
 if((isLive&&env.RAILWAY_ENVIRONMENT_ID!==PRODUCTION)||
    (!isLive&&env.RAILWAY_ENVIRONMENT_ID!==STAGING))
  throw Error("Deletion refund Stripe environment mismatch");
 const key=customerStripeCredential(env,mode);
 if(!key)throw Error("Refund provider access unavailable");
 const session=await request<StripeSession>("checkout/sessions/"+encodeURIComponent(intent.sessionId),key,"GET",undefined,sender);
 if(session.id!==intent.sessionId||session.livemode!==isLive||
    session.mode!=="payment"||session.payment_status!=="paid"||
    session.currency!=="eur"||typeof session.amount_total!=="number"||
    session.amount_total<intent.cents||!session.metadata||
    session.metadata.flow!=="singmotion_credit_topup"||
    session.metadata.creditTopupId!==intent.purchaseId||
    typeof session.payment_intent!=="string"||!/^pi_[A-Za-z0-9_]+$/.test(session.payment_intent))
  throw Error("Stripe credit purchase does not match stored account intent");
 const idempotency="sm-erasure-v1-"+intent.purchaseId;
 let refund:StripeRefund;
 if(intent.refundId){
  refund=await request<StripeRefund>("refunds/"+encodeURIComponent(intent.refundId),key,"GET",undefined,sender);
 }else{
  // Claim before making any irreversible network request. If a process dies
  // after Stripe creates the refund but before the reply is persisted, never
  // create a second refund based merely on a stale idempotency key.
  const claimed=db.prepare("UPDATE customer_erasure_refund_intents SET state='pending',sent_at=?,updated=? WHERE purchase_id=? AND state='ready' AND refund_id IS NULL")
   .run(Date.now(),Date.now(),intent.purchaseId);
  if(claimed.changes===1){
   refund=await request<StripeRefund>("refunds",key,"POST",
    new URLSearchParams({payment_intent:session.payment_intent,amount:String(intent.cents),
     reason:"requested_by_customer",
     "metadata[erasure_intent]":idempotency,
     "metadata[erasure_purchase]":intent.purchaseId}),sender);
  }else{
   // Recovery uses the provider's real refund list and purchase metadata,
   // never an unbounded retry that could double-pay after 24h.
   const discovered=await request<{data?:StripeRefund[];has_more?:boolean}>(
    "refunds?payment_intent="+encodeURIComponent(session.payment_intent)+"&limit=100",key,"GET",undefined,sender);
   if(discovered.has_more||!Array.isArray(discovered.data))
    throw Error("Refund history needs financial reconciliation before deletion");
   const matches=discovered.data.filter(r=>r.metadata?.erasure_intent===idempotency&&
    r.metadata?.erasure_purchase===intent.purchaseId&&r.amount===intent.cents);
   if(matches.length!==1)
    throw Error("Refund creation result still pending independent verification");
   refund=matches[0];
  }
 }
 const refundId=refund?.id;
 if(!validStripeRefundId(refundId)||
    refund.object!=="refund"||refund.payment_intent!==session.payment_intent||
    refund.amount!==intent.cents||refund.currency!=="eur"||
    (refund.livemode!==undefined&&refund.livemode!==isLive))
  throw Error("Stripe returned mismatched deletion refund");
 if(intent.refundId&&intent.refundId!==refundId)
  throw Error("Deletion refund ID was unexpectedly replaced");
 const status=refund.status==="succeeded"?"succeeded":
  refund.status==="failed"||refund.status==="canceled"?"failed":"pending";
 db.prepare("UPDATE customer_erasure_refund_intents SET state=?,refund_id=?,updated=? WHERE purchase_id=? AND (refund_id IS NULL OR refund_id=?)")
  .run(status,refundId,Date.now(),intent.purchaseId,refundId);
 return read(db,intent.purchaseId)!;
}
