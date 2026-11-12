import {randomUUID} from "node:crypto";
import type {DatabaseSync} from "node:sqlite";
import {MAX_CREDIT_TOPUP,MIN_CREDIT_TOPUP,proposedTopupCents} from "./credit-topup-quote.ts";

const STAGING_ID="dfaeabed-03df-43ed-aa71-50f343a75041";

/** New credit purchases are sandbox-only, independently of video checkout. */
export function stripeCreditTopupsTestEnabled(env:Record<string,string|undefined>):boolean {
 return env.RAILWAY_ENVIRONMENT_ID===STAGING_ID &&
  env.STRIPE_CREDIT_TOPUPS_TEST_ENABLED==="true" &&
  env.STRIPE_CHECKOUT_ENABLED==="true" &&
  /^sk_test_[A-Za-z0-9_]+$/.test(env.STRIPE_SECRET_KEY||"") &&
  /^whsec_[A-Za-z0-9_]+$/.test(env.STRIPE_WEBHOOK_SECRET||"");
}

export type WalletIdentity={subject:string;email:string;customerId:string|null};
export type Topup={id:string;subject:string;email:string;credits:number;cents:number;status:string;sessionId:string|null;checkoutUrl:string|null;requestKey:string;created:number};

/**
 * Ledger isolated from historical one-video Checkout and Hobby entitlements.
 * Customer historical cents are never silently converted into purchased credits.
 * The same wallet works for an authenticated customer or a CMS super-admin's own
 * separately scoped staff identity, without exposing another customer's data.
 */
export class CreditWallet {
 constructor(private readonly db:DatabaseSync){
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
  if(!/^cs_test_[A-Za-z0-9_]+$/.test(sessionId)||
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
      input.currency!=="eur"||input.paymentStatus!=="paid"||input.livemode!==false)
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
   if(!record||record.cents!==input.amount||input.currency!=="eur"||input.livemode!==false)
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
