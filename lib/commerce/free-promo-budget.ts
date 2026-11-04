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
type Approval={orderId:string;accountId:string;maxMicroUsd:number;expiresAt:number;signature:string};
type Budget={perJobMicroUsd:number;rollingDayMicroUsd:number;lifetimeMicroUsd:number};
export type FreePromoAuthorization={orderId:string;accountId:string;reservedMicroUsd:number;state:"authorized"|"submitted_or_unknown"|"delivered"|"requires_review"};
function validBudget(policy:Budget){
 for(const value of Object.values(policy))if(!Number.isSafeInteger(value)||value<1||value>1_000_000_000)
  throw Error("Invalid free-video spending policy");
 if(policy.perJobMicroUsd>policy.rollingDayMicroUsd||policy.rollingDayMicroUsd>policy.lifetimeMicroUsd)
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
   if(total.n+approval.maxMicroUsd>policy.lifetimeMicroUsd||
    day.n+approval.maxMicroUsd>policy.rollingDayMicroUsd)
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
