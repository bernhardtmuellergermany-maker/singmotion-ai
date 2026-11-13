import {randomUUID} from "node:crypto";
import type {DatabaseSync} from "node:sqlite";
import {MAX_CREDIT_TOPUP,MIN_CREDIT_TOPUP,proposedTopupCents} from "./credit-topup-quote.ts";

const STAGING_ID="dfaeabed-03df-43ed-aa71-50f343a75041";

/** Test webhook settlement remains enabled after the checkout kill switch
 * so previously paid customers never lose a pending verified top-up.
 */
export function stripeCreditWebhookTestEnabled(env:Record<string,string|undefined>):boolean {
 return env.RAILWAY_ENVIRONMENT_ID===STAGING_ID &&
  /^sk_test_[A-Za-z0-9_]+$/.test(env.STRIPE_SECRET_KEY||"") &&
  /^whsec_[A-Za-z0-9_]+$/.test(env.STRIPE_WEBHOOK_SECRET||"");
}
/** New credit purchases are sandbox-only, independently of video checkout. */
export function stripeCreditTopupsTestEnabled(env:Record<string,string|undefined>):boolean {
 // Legacy per-video Stripe Checkout is independent from the separately
 // authorised and account-bound prepaid sandbox purchase flow.
 return stripeCreditWebhookTestEnabled(env) &&
  env.STRIPE_CREDIT_TOPUPS_TEST_ENABLED==="true";
}

const PRODUCTION_ID="36adc41d-7e54-4396-ad1a-fd432ba0441d";
/** Checkout and signing require independent live billing and tax approvals.
 * Never infer user consent or enable recurring charges from this flag. */
export function stripeCreditTopupsLiveEnabled(env:Record<string,string|undefined>):boolean {
 return env.RAILWAY_ENVIRONMENT_ID===PRODUCTION_ID &&
  env.STRIPE_CREDIT_TOPUPS_LIVE_ENABLED==="true" &&
  env.STRIPE_LIVE_CHECKOUT_ENABLED==="true" &&
  env.PUBLIC_CUSTOMER_LAUNCH_APPROVED==="true" &&
  env.STRIPE_ACCOUNT_LIVE_REVIEW_APPROVED==="true" &&
  env.STRIPE_CREDIT_TAX_REVIEW_APPROVED==="true" &&
  /^txcd_[A-Za-z0-9]+$/.test(env.STRIPE_CREDIT_TAX_CODE||"") &&
  /^(?:sk|rk)_live_[A-Za-z0-9_]+$/.test(env.STRIPE_SECRET_KEY||"") &&
  /^whsec_[A-Za-z0-9_]+$/.test(env.STRIPE_WEBHOOK_SECRET||"");
}
export type WalletIdentity={subject:string;email:string;customerId:string|null};
export type Topup={id:string;subject:string;email:string;credits:number;cents:number;status:string;sessionId:string|null;checkoutUrl:string|null;requestKey:string;created:number};
export type VideoReservationState="reserved"|"review"|"settled"|"released";
type VideoReservationRow={project_id:string;subject:string;credits:number;state:VideoReservationState;created:number;updated:number};
export type VideoReservation={projectId:string;subject:string;credits:number;state:VideoReservationState;created:number;updated:number};

/**
 * Ledger isolated from historical one-video Checkout and Hobby entitlements.
 * Customer historical cents are never silently converted into purchased credits.
 * The same wallet works for an authenticated customer or a CMS super-admin's own
 * separately scoped staff identity, without exposing another customer's data.
 */
export class CreditWallet {
 private readonly db:DatabaseSync;
 constructor(db:DatabaseSync){
  this.db=db;
  db.exec(`
   CREATE TABLE IF NOT EXISTS credit_topup_purchases(
    id TEXT PRIMARY KEY,subject TEXT NOT NULL,email TEXT NOT NULL,
    credits INTEGER NOT NULL,cents INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','paid','reversed')),
    request_key TEXT UNIQUE NOT NULL,stripe_session_id TEXT UNIQUE,
    checkout_url TEXT,created INTEGER NOT NULL,paid_at INTEGER
   );
   CREATE INDEX IF NOT EXISTS credit_topup_subject_idx ON credit_topup_purchases(subject,created DESC);
   CREATE TABLE IF NOT EXISTS credit_wallet_ledger(
    id TEXT PRIMARY KEY,subject TEXT NOT NULL,delta INTEGER NOT NULL,
    kind TEXT NOT NULL,reference TEXT UNIQUE NOT NULL,created INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS credit_wallet_subject_idx ON credit_wallet_ledger(subject,created DESC);
   CREATE TABLE IF NOT EXISTS credit_video_reservations(
    project_id TEXT PRIMARY KEY,subject TEXT NOT NULL,
    credits INTEGER NOT NULL CHECK(credits>0),
    state TEXT NOT NULL CHECK(state IN ('reserved','review','settled','released')),
    created INTEGER NOT NULL,updated INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS credit_video_subject_idx ON credit_video_reservations(subject,state,created DESC);
  `);
 }
 private tx<T>(fn:()=>T):T{
  this.db.exec("BEGIN IMMEDIATE");
  try{const result=fn();this.db.exec("COMMIT");return result;}
  catch(e){this.db.exec("ROLLBACK");throw e;}
 }
 private map(row:Record<string,unknown>):Topup{
  return {id:String(row.id),subject:String(row.subject),email:String(row.email),
   credits:Number(row.credits),cents:Number(row.cents),status:String(row.status),
   sessionId:row.stripe_session_id===null?null:String(row.stripe_session_id),
   checkoutUrl:row.checkout_url===null?null:String(row.checkout_url),
   requestKey:String(row.request_key),created:Number(row.created)};
 }
 pending(identity:WalletIdentity,credits:number,requestKey:string):Topup {
  const cents=proposedTopupCents(credits);
  if(cents===null||credits<MIN_CREDIT_TOPUP||credits>MAX_CREDIT_TOPUP)
   throw Error("Invalid credit amount");
  if(!/^[0-9a-f-]{36}$/i.test(requestKey))throw Error("Invalid idempotency key");
  return this.tx(()=>{
   const existing=this.db.prepare("SELECT * FROM credit_topup_purchases WHERE request_key=?")
    .get(requestKey) as Record<string,unknown>|undefined;
   if(existing){
    const row=this.map(existing);
    if(row.subject!==identity.subject||row.credits!==credits||row.cents!==cents)
     throw Error("Top-up idempotency conflict");
    return row;
   }
   const id=randomUUID();
   this.db.prepare(`INSERT INTO credit_topup_purchases
    (id,subject,email,credits,cents,status,request_key,created)
    VALUES(?,?,?,?,?,'pending',?,?)`).run(id,identity.subject,identity.email,credits,cents,requestKey,Date.now());
   const added=this.db.prepare("SELECT * FROM credit_topup_purchases WHERE id=?").get(id) as Record<string,unknown>;
   return this.map(added);
  });
 }
 findById(id:string):Topup|null {
  const row=this.db.prepare("SELECT * FROM credit_topup_purchases WHERE id=?")
   .get(id) as Record<string,unknown>|undefined;
  return row?this.map(row):null;
 }
 findBySession(id:string):Topup|null {
  const row=this.db.prepare("SELECT * FROM credit_topup_purchases WHERE stripe_session_id=?")
   .get(id) as Record<string,unknown>|undefined;
  return row?this.map(row):null;
 }
 bind(id:string,sessionId:string,url:string):Topup {
  if(!/^cs_(?:test|live)_[A-Za-z0-9_]+$/.test(sessionId)||
     !/^https:\/\/checkout\.stripe\.com\//.test(url))throw Error("Invalid Stripe sandbox Checkout");
  return this.tx(()=>{
   const prior=this.findById(id);
   if(!prior||prior.status!=="pending"||
      (prior.sessionId!==null&&prior.sessionId!==sessionId))
    throw Error("Top-up checkout binding conflict");
   this.db.prepare("UPDATE credit_topup_purchases SET stripe_session_id=?,checkout_url=? WHERE id=?")
    .run(sessionId,url,id);
   return this.findById(id)!;
  });
 }
 settle(input:{id:string;sessionId:string;amount:number;currency:string;paymentStatus:string;livemode:boolean}):boolean {
  return this.tx(()=>{
   const record=this.findById(input.id);
   if(!record||record.sessionId!==input.sessionId||record.cents!==input.amount||
      input.currency!=="eur"||input.paymentStatus!=="paid"||
      input.livemode!==record.sessionId?.startsWith("cs_live_"))
    throw Error("Top-up payment verification mismatch");
   if(record.status==="reversed")return false;
   if(record.status==="paid")return false;
   const eventId="credit-topup:"+record.id;
   this.db.prepare("INSERT INTO credit_wallet_ledger VALUES(?,?,?,?,?,?)")
    .run(eventId,record.subject,record.credits,"purchase",eventId,Date.now());
   this.db.prepare("UPDATE credit_topup_purchases SET status='paid',paid_at=? WHERE id=? AND status='pending'")
    .run(Date.now(),record.id);
   return true;
  });
 }
 reverse(input:{sessionId:string;amount:number;currency:string;livemode:boolean;kind:"refund"|"dispute"}):boolean {
  return this.tx(()=>{
   const record=this.findBySession(input.sessionId);
   if(!record||record.cents!==input.amount||input.currency!=="eur"||
      input.livemode!==record.sessionId?.startsWith("cs_live_"))
    throw Error("Top-up reversal verification mismatch");
   if(record.status==="reversed")return false;
   if(record.status==="paid"){
    const eventId="credit-reversal:"+record.id;
    this.db.prepare("INSERT INTO credit_wallet_ledger VALUES(?,?,?,?,?,?)")
     .run(eventId,record.subject,-record.credits,input.kind,eventId,Date.now());
   }
   this.db.prepare("UPDATE credit_topup_purchases SET status='reversed' WHERE id=?")
    .run(record.id);
   return true;
  });
 }

 /** A wallet hold is recorded BEFORE any provider submission and is unique per
  * immutable project ID. It reduces spendable funds without charging early. */
 videoReservation(projectId:string):VideoReservation|null {
  const r=this.db.prepare("SELECT project_id,subject,credits,state,created,updated FROM credit_video_reservations WHERE project_id=?")
   .get(projectId) as VideoReservationRow|undefined;
  return r?{projectId:r.project_id,subject:r.subject,credits:r.credits,state:r.state,created:r.created,updated:r.updated}:null;
 }
 reserved(subject:string):number {
  const r=this.db.prepare("SELECT COALESCE(SUM(credits),0) AS total FROM credit_video_reservations WHERE subject=? AND state IN ('reserved','review')")
   .get(subject) as {total:number};
  return Number(r.total);
 }
 available(subject:string):number {return this.total(subject)-this.reserved(subject);}
 reserveVideo(projectId:string,subject:string,credits:number):VideoReservation {
  if(!/^[a-f0-9-]{36}$/i.test(projectId)||
     !/^(?:customer|super-admin):[A-Za-z0-9_-]{1,100}$/.test(subject)||
     !Number.isSafeInteger(credits)||credits<=0||credits>7500)
   throw Error("Invalid video credit reservation");
  return this.tx(()=>{
   const prior=this.videoReservation(projectId);
   if(prior){
    if(prior.subject!==subject||prior.credits!==credits)throw Error("Video reservation owner/price conflict");
    if(prior.state==="settled"||prior.state==="released")throw Error("Video reservation is final");
    return prior;
   }
   if(this.available(subject)<credits)throw Error("Insufficient video credits");
   const now=Date.now();
   this.db.prepare("INSERT INTO credit_video_reservations VALUES(?,?,?,'reserved',?,?)")
    .run(projectId,subject,credits,now,now);
   return this.videoReservation(projectId)!;
  });
 }
 /** Completed + validated MP4: bill once. Verified zero-charge prefilter:
  * release once. Uncertain/other failures: hold until reconciliation.
  * Historical jobs without a hold are NEVER retroactively charged. */
 reconcileVideo(projectId:string,outcome:"completed"|"nonbillable"|"review"):VideoReservation|null {
  return this.tx(()=>{
   const hold=this.videoReservation(projectId);
   if(!hold||hold.state==="settled"||hold.state==="released")return hold;
   const state=outcome==="completed"?"settled":outcome==="nonbillable"?"released":"review";
   if(state==="settled"||state==="released"){
    const key=(state==="settled"?"video-charge:":"video-release:")+projectId;
    this.db.prepare("INSERT INTO credit_wallet_ledger VALUES(?,?,?,?,?,?)")
     .run(key,hold.subject,state==="settled"?-hold.credits:0,
       state==="settled"?"video":"video-release",key,Date.now());
   }
   this.db.prepare("UPDATE credit_video_reservations SET state=?,updated=? WHERE project_id=?")
    .run(state,Date.now(),projectId);
   return this.videoReservation(projectId);
  });
 }
 /** Explicit Super Admin goodwill refund for a permanently failed task,
  * including provider failures that may still have incurred internal BytePlus costs.
  * Never callable for an ongoing/uncertain task or a defective delivered MP4:
  * terminal evidence is independently checked in the privileged API.
  * Supports the two DIFFERENT financial states: release a hold (delta=0)
  * or reverse a settled video Credit debit (delta=+credits), exactly once. */
 supportRefundVideo(projectId:string,actor:string,reason:string,failureCode:string):VideoReservation{
  if(!/^[a-f0-9-]{36}$/i.test(projectId)||!/^[A-Za-z0-9_-]{1,110}$/.test(actor)||
     reason.trim().length<20||reason.length>1200||
     !["CONTENT_PREFILTER_REJECTED","PROVIDER_JOB_FAILED","PROVIDER_TASK_CANCELED"].includes(failureCode))
    throw Error("Protected Super Admin refund evidence required");
  return this.tx(()=>{
    const hold=this.videoReservation(projectId);
    if(!hold)throw Error("Video reservation not found");
    if(hold.state==="released")return hold;
    const eventId="support-video-refund:"+projectId;
    const existing=this.db.prepare("SELECT delta FROM credit_wallet_ledger WHERE reference=?").get(eventId) as {delta:number}|undefined;
    if(existing)throw Error("Support refund ledger conflict");
    this.db.prepare("INSERT INTO credit_wallet_ledger VALUES(?,?,?,?,?,?)")
      .run(eventId,hold.subject,hold.state==="settled"?hold.credits:0,
        "support-video-refund",eventId,Date.now());
    this.db.prepare("UPDATE credit_video_reservations SET state='released',updated=? WHERE project_id=? AND state=?")
      .run(Date.now(),projectId,hold.state);
    return this.videoReservation(projectId)!;
  });
 }
 videoReservations(subject:string):VideoReservation[]{
  return (this.db.prepare("SELECT project_id,subject,credits,state,created,updated FROM credit_video_reservations WHERE subject=? ORDER BY created DESC LIMIT 100")
   .all(subject) as VideoReservationRow[]).map(r=>({projectId:r.project_id,subject:r.subject,
    credits:r.credits,state:r.state,created:r.created,updated:r.updated}));
 }
 total(subject:string):number {
  const v=this.db.prepare("SELECT COALESCE(SUM(delta),0) AS total FROM credit_wallet_ledger WHERE subject=?")
   .get(subject) as {total:number};
  return Number(v.total);
 }
 entries(subject:string):Array<{id:string;credits:number;type:string;created:number;reference:string}>{
  return (this.db.prepare("SELECT id,delta,kind,reference,created FROM credit_wallet_ledger WHERE subject=? ORDER BY created DESC,id DESC LIMIT 150")
   .all(subject) as Array<{id:string;delta:number;kind:string;reference:string;created:number}>)
   .map(v=>({id:v.id,credits:v.delta,type:v.kind,reference:v.reference,created:v.created}));
 }
 purchases(subject:string){
  return this.db.prepare("SELECT id,credits,cents,status,created FROM credit_topup_purchases WHERE subject=? ORDER BY created DESC LIMIT 50")
   .all(subject) as Array<{id:string;credits:number;cents:number;status:string;created:number}>;
 }
}
