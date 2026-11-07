/** Durable, no-dispatch authorization for three-video zero-EUR vouchers.
 * This is a strict **pre-provider** budget reservation, not a customer payment,
 * not a BytePlus job and not a promotion redemption. Separate verified output
 * settlement and an operator-reviewed worker are still required.
 */
import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import type {DatabaseSync} from "node:sqlite";
import type {PreparedMedia} from "../live/store.ts";
import {reviewedVideoInputDigest,reviewedVideoQuoteDigest} from "./reviewed-video.ts";

const uuid=/^[a-f0-9-]{36}$/;
const signedHex=/^[a-f0-9]{64}$/;
export type Approval={orderId:string;accountId:string;maxMicroUsd:number;expiresAt:number;signature:string};
type Budget={operatorEnabled:boolean;perJobMicroUsd:number;perPromoMicroUsd:number;rollingDayMicroUsd:number;lifetimeMicroUsd:number};
export type FreePromoAuthorization={orderId:string;accountId:string;reservedMicroUsd:number;state:"authorized"|"submitted_or_unknown"|"delivered"|"requires_review"};
function validBudget(policy:Budget){
 if(policy.operatorEnabled!==true)throw Error("Free-video provider budget kill switch disabled");
 for(const value of [policy.perJobMicroUsd,policy.perPromoMicroUsd,policy.rollingDayMicroUsd,policy.lifetimeMicroUsd])if(!Number.isSafeInteger(value)||value<1||value>1_000_000_000)
  throw Error("Invalid free-video spending policy");
 if(policy.perJobMicroUsd>policy.perPromoMicroUsd||policy.perPromoMicroUsd>policy.lifetimeMicroUsd||
  policy.perJobMicroUsd>policy.rollingDayMicroUsd||policy.rollingDayMicroUsd>policy.lifetimeMicroUsd)
  throw Error("Inconsistent free-video spending caps");
}
function message(value:Omit<Approval,"signature">){
 return `singmotion-free-promo-v1:${value.orderId}:${value.accountId}:${value.maxMicroUsd}:${value.expiresAt}`;
}
/** This signer is for the authenticated, trusted operator tool only; never
 * import it into a browser route or expose the signing key to clients. */
export function signOperatorFreePromoApproval(value:Omit<Approval,"signature">,secret:string):Approval{
 if(typeof secret!=="string"||secret.length<32)throw Error("Strong operator approval secret required");
 if(!uuid.test(value.orderId)||!uuid.test(value.accountId)||
  !Number.isSafeInteger(value.maxMicroUsd)||value.maxMicroUsd<1||
  !Number.isSafeInteger(value.expiresAt))
  throw Error("Invalid free-promo approval");
 return {...value,signature:createHmac("sha256",secret).update(message(value)).digest("hex")};
}
function verifyApproval(value:Approval,secret:string,now:number){
 const expected=signOperatorFreePromoApproval(
  {orderId:value.orderId,accountId:value.accountId,maxMicroUsd:value.maxMicroUsd,expiresAt:value.expiresAt},secret);
 if(!signedHex.test(value.signature)||
   !timingSafeEqual(Buffer.from(value.signature,"hex"),Buffer.from(expected.signature,"hex"))||
   value.expiresAt<=now||value.expiresAt>now+15*60_000)
  throw Error("Missing, expired or forged operator authorization");
}
/** Trusted worker verification; signatures are never accepted from clients without
 * a separate authenticated operator control plane. */
export function verifyOperatorFreePromoApproval(approval:Approval,secret:string,now=Date.now()){
 verifyApproval(approval,secret,now);
}
export class FreePromoBudgetLedger{
 private readonly db:DatabaseSync;
 constructor(db:DatabaseSync){
  this.db=db;
  db.exec(`CREATE TABLE IF NOT EXISTS free_promo_budget_authorizations(
   order_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,code TEXT NOT NULL,
   reserved_micro_usd INTEGER NOT NULL,state TEXT NOT NULL
     CHECK(state IN ('authorized','submitted_or_unknown','delivered','requires_review')),
   created INTEGER NOT NULL,updated INTEGER NOT NULL
  );`);
 }
 /** Reserve the only possible free-provider submission attempt before network IO.
  * Does NOT submit, deliver or redeem; uncertain outcomes require human review.
  * Persistent state is never reset automatically after a crash.
  * Rechecks the short-lived signed operator approval and exact reserved cost.
  */
 claimProviderAttempt(approval:Approval,secret:string,operatorEnabled:boolean,now=Date.now()):
  "claimed"|"already-claimed"{
  if(operatorEnabled!==true)throw Error("Free-video provider budget kill switch disabled");
  if(!Number.isSafeInteger(now))throw Error("Invalid free-video claim");
  verifyApproval(approval,secret,now);
  const {orderId,accountId}=approval;
  this.db.exec("BEGIN IMMEDIATE");
  try{
   const row=this.db.prepare(`SELECT a.state,a.account_id,a.reserved_micro_usd,o.status,o.price_cents,o.quote_evidence,
     p.state AS promo_state,c.enabled,c.starts_at,c.ends_at,c.kind,
     m.media_json,i.input_digest,i.review_digest
     FROM free_promo_budget_authorizations a
     JOIN customer_orders o ON o.id=a.order_id AND o.account_id=a.account_id
     JOIN promo_redemptions p ON p.order_id=a.order_id AND p.account_id=a.account_id
     JOIN promo_codes c ON c.code=a.code AND c.code=p.code
     JOIN customer_prepared_media m ON m.order_id=a.order_id
     JOIN customer_order_inputs i ON i.order_id=a.order_id
     WHERE a.order_id=?`).get(orderId) as
     {state:FreePromoAuthorization["state"];account_id:string;reserved_micro_usd:number;status:string;promo_state:string;
      price_cents:number;quote_evidence:string;enabled:number;starts_at:number;ends_at:number;
      kind:string;media_json:string;input_digest:string;review_digest:string}|undefined;
   if(!row||row.account_id!==accountId||row.reserved_micro_usd!==approval.maxMicroUsd||
    row.status!=="awaiting_payment"||
    row.promo_state!=="reserved"||row.price_cents!==0||row.kind!=="free_videos"||
    row.enabled!==1||now<row.starts_at||now>=row.ends_at)
    throw Error("Free-video claim not eligible");
   if(row.state!=="authorized"){
    this.db.exec("COMMIT");
    return "already-claimed";
   }
   const media=JSON.parse(row.media_json) as PreparedMedia;
   if(media.owner!==`customer-${accountId}`||
    !Number.isFinite(media.durationSeconds)||media.durationSeconds<5||media.durationSeconds>10||
    typeof media.sourceJobId!=="string"||media.sourceJobId.length<8)
    throw Error("Free-video claim media invalid");
   const input=reviewedVideoInputDigest(media);
   if(input!==row.input_digest||
    reviewedVideoQuoteDigest(input,row.price_cents,row.quote_evidence)!==row.review_digest)
    throw Error("Free-video claim reviewed media changed");
   const updated=this.db.prepare(`UPDATE free_promo_budget_authorizations
     SET state='submitted_or_unknown',updated=?
     WHERE order_id=? AND account_id=? AND state='authorized'`).run(now,orderId,accountId);
   if(updated.changes!==1)throw Error("Free-video submission barrier unavailable");
   this.db.prepare("INSERT INTO commerce_audit(actor,action,record,created) VALUES(?,?,?,?)")
    .run("verified-promo-operator","free-promo-provider-attempt-claimed",orderId,now);
   this.db.exec("COMMIT");
   return "claimed";
  }catch(error){this.db.exec("ROLLBACK");throw error}
 }
 /** Put one ambiguous provider submission into human review without resending,
  * releasing a voucher, changing a payment or decreasing reserved provider cost.
  * Requires a NEW short-lived signed operator approval; reason is an allowlisted
  * code, never arbitrary customer information or a provider credential.
  */
 flagProviderAttemptForReview(
  approval:Approval,secret:string,
  reason:"timeout"|"provider-uncertain"|"operator-hold",now=Date.now(),
 ):"flagged"|"already-flagged"{
  if(!["timeout","provider-uncertain","operator-hold"].includes(reason))
   throw Error("Invalid free-promo review reason");
  if(!Number.isSafeInteger(now)||now<1)throw Error("Invalid free-promo review timestamp");
  verifyApproval(approval,secret,now);
  this.db.exec("BEGIN IMMEDIATE");
  try{
   const row=this.db.prepare(`SELECT account_id,reserved_micro_usd,state
     FROM free_promo_budget_authorizations WHERE order_id=?`).get(approval.orderId) as
     {account_id:string;reserved_micro_usd:number;state:FreePromoAuthorization["state"]}|undefined;
   if(!row||row.account_id!==approval.accountId||row.reserved_micro_usd!==approval.maxMicroUsd)
    throw Error("Free-promo review approval not eligible");
   if(row.state==="requires_review"){
    this.db.exec("COMMIT");
    return "already-flagged";
   }
   if(row.state!=="submitted_or_unknown")
    throw Error("Only ambiguous free-provider submissions require review");
   const changed=this.db.prepare(`UPDATE free_promo_budget_authorizations
     SET state='requires_review',updated=?
     WHERE order_id=? AND account_id=? AND state='submitted_or_unknown'`)
    .run(now,approval.orderId,approval.accountId);
   if(changed.changes!==1)throw Error("Free-promo review transition unavailable");
   this.db.prepare("INSERT INTO commerce_audit(actor,action,record,created) VALUES(?,?,?,?)")
    .run("verified-promo-operator","free-promo-provider-requires-review",approval.orderId+":"+reason,now);
   this.db.exec("COMMIT");
   return "flagged";
  }catch(error){this.db.exec("ROLLBACK");throw error}
 }
 /** Read-only operator reconciliation queue for ambiguous provider attempts.
  * Results are bounded, contain no email or media fields and never retry,
  * release a voucher, alter an order or clear reserved spending.
  * Call only from a trusted operator context, never a public customer route.
  */
 staleProviderAttempts(now=Date.now(),minimumAgeMs=15*60_000,limit=100):
  Array<{orderId:string;state:"submitted_or_unknown"|"requires_review";ageMs:number;reservedMicroUsd:number}>{
  if(!Number.isSafeInteger(now)||now<1||
   !Number.isSafeInteger(minimumAgeMs)||minimumAgeMs<60_000||minimumAgeMs>30*86400_000||
   !Number.isSafeInteger(limit)||limit<1||limit>100)
   throw Error("Invalid free-promo reconciliation scan bounds");
  const rows=this.db.prepare(`SELECT order_id,state,updated,reserved_micro_usd
    FROM free_promo_budget_authorizations
    WHERE state IN ('submitted_or_unknown','requires_review')
      AND updated>=0 AND updated<=?
    ORDER BY updated ASC,order_id ASC LIMIT ?`)
   .all(now-minimumAgeMs,limit) as Array<
    {order_id:string;state:"submitted_or_unknown"|"requires_review";updated:number;reserved_micro_usd:number}>;
  return rows.map(row=>({orderId:row.order_id,state:row.state,
   ageMs:now-row.updated,reservedMicroUsd:row.reserved_micro_usd}));
 }
 /** Read-only, owner-free operator cost exposure for one promo and globally.
  * Each sum includes ALL reserved/ambiguous/reviewed/delivered attempts so an
  * uncertain charged task cannot silently restore spending allowance.
  * Never expose account identities, private media, or secrets.
  */
 costExposure(code:string,now=Date.now()):{
  code:string;promoReservedMicroUsd:number;rollingDayReservedMicroUsd:number;
  globalReservedMicroUsd:number;ambiguousCount:number;requiresReviewCount:number;
 }{
  if(typeof code!=="string"||!/^[A-Z0-9][A-Z0-9-]{4,38}[A-Z0-9]$/.test(code)||
   !Number.isSafeInteger(now)||now<86400000)
   throw Error("Invalid free-promo cost exposure query");
  const aggregate=(where:string,params:Array<string|number>)=>{
   const row=this.db.prepare(`SELECT COALESCE(SUM(reserved_micro_usd),0) AS total
     FROM free_promo_budget_authorizations ${where}`).get(...params) as {total:number};
   if(!Number.isSafeInteger(row.total)||row.total<0)
    throw Error("Corrupt free-promo spending ledger");
   return row.total;
  };
  const promo=aggregate("WHERE code=?",[code]);
  const day=aggregate("WHERE created>=?",[now-86400000]);
  const global=aggregate("",[]);
  const states=this.db.prepare(`SELECT
    SUM(CASE WHEN state='submitted_or_unknown' THEN 1 ELSE 0 END) AS ambiguous,
    SUM(CASE WHEN state='requires_review' THEN 1 ELSE 0 END) AS requires_review
    FROM free_promo_budget_authorizations WHERE code=?`).get(code) as
    {ambiguous:number|null;requires_review:number|null};
  return {code,promoReservedMicroUsd:promo,rollingDayReservedMicroUsd:day,
   globalReservedMicroUsd:global,ambiguousCount:states.ambiguous??0,
   requiresReviewCount:states.requires_review??0};
 }
 /** Read-only alert assessment. The operator kill switch may be OFF while
  * costs are monitored. No emails, external calls or budget mutations occur.
  */
 assessCostAlerts(code:string,policy:Budget,now=Date.now()):{
  severity:"ok"|"warning"|"blocked";
  reasons:Array<"operator-disabled"|"per-promo-near-cap"|"per-promo-at-cap"|
   "daily-near-cap"|"daily-at-cap"|"global-near-cap"|"global-at-cap"|
   "ambiguous-submissions"|"operator-reviews">;
 }{
  // Validate each numeric ceiling but deliberately allow a disabled operator
  // to inspect costs. Authorization and submission stay fail-closed.
  validBudget({...policy,operatorEnabled:true});
  const exposure=this.costExposure(code,now);
  type Reason="operator-disabled"|"per-promo-near-cap"|"per-promo-at-cap"|
   "daily-near-cap"|"daily-at-cap"|"global-near-cap"|"global-at-cap"|
   "ambiguous-submissions"|"operator-reviews";
  const reasons:Reason[]=[];
  let severity:"ok"|"warning"|"blocked"="ok";
  const add=(reason:Reason,blocking=false)=>{
   reasons.push(reason);
   severity=blocking?"blocked":severity==="ok"?"warning":severity;
  };
  if(policy.operatorEnabled!==true)add("operator-disabled",true);
  const assess=(used:number,cap:number,near:Reason,full:Reason)=>{
   if(used>=cap)add(full,true);
   else if(used*100>=cap*80)add(near);
  };
  assess(exposure.promoReservedMicroUsd,policy.perPromoMicroUsd,"per-promo-near-cap","per-promo-at-cap");
  assess(exposure.rollingDayReservedMicroUsd,policy.rollingDayMicroUsd,"daily-near-cap","daily-at-cap");
  assess(exposure.globalReservedMicroUsd,policy.lifetimeMicroUsd,"global-near-cap","global-at-cap");
  if(exposure.ambiguousCount>0)add("ambiguous-submissions");
  if(exposure.requiresReviewCount>0)add("operator-reviews");
  return {severity,reasons};
 }
 /** Atomic one-time reservation under a separately authenticated operator
  * approval. Never updates customer_orders to paid or touches provider APIs.
  * The order must already have an immutable server-reviewed media snapshot.
  */
 authorize(approval:Approval,secret:string,policy:Budget,now=Date.now()):FreePromoAuthorization{
  validBudget(policy);verifyApproval(approval,secret,now);
  if(approval.maxMicroUsd>policy.perJobMicroUsd)
   throw Error("Free video exceeds per-job cost cap");
  this.db.exec("BEGIN IMMEDIATE");
  try{
   const existing=this.db.prepare("SELECT * FROM free_promo_budget_authorizations WHERE order_id=?")
    .get(approval.orderId) as {order_id:string;account_id:string;reserved_micro_usd:number;state:FreePromoAuthorization["state"]}|undefined;
   if(existing){
    if(existing.account_id!==approval.accountId||existing.reserved_micro_usd!==approval.maxMicroUsd)
     throw Error("Free promo approval idempotency conflict");
    this.db.exec("COMMIT");
    return {orderId:approval.orderId,accountId:existing.account_id,
     reservedMicroUsd:existing.reserved_micro_usd,state:existing.state};
   }
   const record=this.db.prepare(`SELECT o.account_id,o.price_cents,o.status,o.quote_evidence,
     p.code,p.state,p.original_cents,p.discount_cents,
     c.kind,c.free_videos,c.max_video_seconds,c.enabled,c.starts_at,c.ends_at,
     m.media_json,i.input_digest,i.review_digest
     FROM customer_orders o
     JOIN promo_redemptions p ON p.order_id=o.id
     JOIN promo_codes c ON c.code=p.code
     JOIN customer_prepared_media m ON m.order_id=o.id
     JOIN customer_order_inputs i ON i.order_id=o.id
     WHERE o.id=?`).get(approval.orderId) as {
       account_id:string|null;price_cents:number;status:string;quote_evidence:string;
       code:string;state:string;original_cents:number;discount_cents:number;
       kind:string;free_videos:number;max_video_seconds:number;enabled:number;
       starts_at:number;ends_at:number;media_json:string;input_digest:string;review_digest:string;
     }|undefined;
   if(!record||record.account_id!==approval.accountId||record.status!=="awaiting_payment"||
    record.price_cents!==0||record.state!=="reserved"||record.kind!=="free_videos"||
    record.free_videos!==3||record.max_video_seconds!==10||
    record.original_cents<1||record.original_cents!==record.discount_cents||
    record.enabled!==1||now<record.starts_at||now>=record.ends_at)
    throw Error("Zero-EUR reserved three-video entitlement not eligible");
   const media=JSON.parse(record.media_json) as PreparedMedia;
   if(media.owner!==`customer-${approval.accountId}`||
    !Number.isFinite(media.durationSeconds)||media.durationSeconds<5||media.durationSeconds>10||
    media.sourceJobId.length<8)
    throw Error("Invalid verified customer media duration or owner");
   const actual=reviewedVideoInputDigest(media);
   const reviewed=reviewedVideoQuoteDigest(actual,record.price_cents,record.quote_evidence);
   if(actual!==record.input_digest||reviewed!==record.review_digest)
    throw Error("Free-promo reviewed media commitment changed");
   const total=this.db.prepare("SELECT COALESCE(SUM(reserved_micro_usd),0) AS n FROM free_promo_budget_authorizations").get() as {n:number};
   const day=this.db.prepare("SELECT COALESCE(SUM(reserved_micro_usd),0) AS n FROM free_promo_budget_authorizations WHERE created>=?").get(now-86400000) as {n:number};
   const promoTotal=this.db.prepare("SELECT COALESCE(SUM(reserved_micro_usd),0) AS n FROM free_promo_budget_authorizations WHERE code=?").get(record.code) as {n:number};
   if(total.n+approval.maxMicroUsd>policy.lifetimeMicroUsd||
    day.n+approval.maxMicroUsd>policy.rollingDayMicroUsd||
    promoTotal.n+approval.maxMicroUsd>policy.perPromoMicroUsd)
    throw Error("Free-video provider spending ceiling reached");
   this.db.prepare(`INSERT INTO free_promo_budget_authorizations
     (order_id,account_id,code,reserved_micro_usd,state,created,updated)
     VALUES(?,?,?,?,'authorized',?,?)`).run(approval.orderId,approval.accountId,record.code,approval.maxMicroUsd,now,now);
   this.db.prepare("INSERT INTO commerce_audit(actor,action,record,created) VALUES(?,?,?,?)")
    .run("verified-promo-operator","free-promo-cost-authorized",approval.orderId+":"+createHash("sha256").update(expectedKey(approval)).digest("hex"),now);
   this.db.exec("COMMIT");
   return {orderId:approval.orderId,accountId:approval.accountId,
    reservedMicroUsd:approval.maxMicroUsd,state:"authorized"};
  }catch(error){this.db.exec("ROLLBACK");throw error}
 }
}
function expectedKey(value:Approval){return value.signature}
