import {randomUUID} from "node:crypto";
import type {DatabaseSync} from "node:sqlite";
import {CreditWallet} from "./credit-wallet.ts";

/** The existing Wallet ledger is the single balance authority.
 * Gifts are separate from purchases and carry NO Stripe revenue.
 * Opening the admin dialog never writes anything.
 */
export const GIFT_REASONS=[
 "welcome","goodwill","compensation","marketing","influencer","vip","other",
] as const;
export type GiftReason=typeof GIFT_REASONS[number];
export type ManualCreditGift={
 id:string;customerId:string;credits:number;reason:GiftReason;campaignId:string|null;
 actor:string;note:string|null;created:number;reversedAt:number|null;
};

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actorPattern=/^[a-zA-Z0-9_-]{1,100}$/;
const keyPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class GiftError extends Error{
 constructor(message:string,public readonly status=409){super(message);}
}
function cap(env:Record<string,string|undefined>,name:string,fallback:number){
 const value=env[name];
 if(value===undefined)return fallback;
 if(!/^[1-9][0-9]{0,5}$/.test(value))throw new GiftError("Credit grant limits misconfigured",503);
 const n=Number(value);
 if(!Number.isSafeInteger(n)||n>100000)throw new GiftError("Credit grant limits misconfigured",503);
 return n;
}
/** Feature gates deliberately fail closed outside the selected environment. */
export function manualGiftEnabled(env:Record<string,string|undefined>):boolean{
 const id=env.RAILWAY_ENVIRONMENT_ID;
 return env.CMS_ENABLED==="true"&&env.ADMIN_MANUAL_CREDITS_ENABLED==="true"&&
 (id==="dfaeabed-03df-43ed-aa71-50f343a75041"||
 (id==="36adc41d-7e54-4396-ad1a-fd432ba0441d"&&
 env.ADMIN_MANUAL_CREDITS_PRODUCTION_APPROVED==="true"));
}

export class ManualCreditGifts{
 private readonly wallet:CreditWallet;
 constructor(private readonly db:DatabaseSync,private readonly env:Record<string,string|undefined>){
  this.wallet=new CreditWallet(db);
  db.exec(`
   CREATE TABLE IF NOT EXISTS admin_credit_gifts(
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    credits INTEGER NOT NULL CHECK(credits>0),
    reason TEXT NOT NULL,
    campaign_id TEXT,
    actor TEXT NOT NULL,
    internal_note TEXT,
    request_key TEXT NOT NULL UNIQUE,
    created INTEGER NOT NULL,
    reversed_at INTEGER,
    correction_reference TEXT UNIQUE
   );
   CREATE INDEX IF NOT EXISTS admin_credit_gifts_customer_idx ON admin_credit_gifts(customer_id,created DESC);
   CREATE INDEX IF NOT EXISTS admin_credit_gifts_actor_idx ON admin_credit_gifts(actor,created DESC);
  `);
 }
 private transact<T>(f:()=>T):T{
  this.db.exec("BEGIN IMMEDIATE");
  try{const result=f();this.db.exec("COMMIT");return result}
  catch(error){this.db.exec("ROLLBACK");throw error}
 }
 private row(r:Record<string,unknown>):ManualCreditGift{
  return {id:String(r.id),customerId:String(r.customer_id),credits:Number(r.credits),
   reason:r.reason as GiftReason,campaignId:r.campaign_id===null?null:String(r.campaign_id),
   actor:String(r.actor),note:r.internal_note===null?null:String(r.internal_note),
   created:Number(r.created),reversedAt:r.reversed_at===null?null:Number(r.reversed_at)};
 }
 private account(id:string){
  const row=this.db.prepare("SELECT id,email FROM customer_accounts WHERE id=?")
   .get(id) as {id:string;email:string}|undefined;
  if(!row)throw new GiftError("Eindeutiges Bestandskundenkonto nicht gefunden.",404);
  return row;
 }
 limits(){
  return {maxPerGrant:cap(this.env,"ADMIN_MANUAL_CREDITS_MAX_GRANT",5000),
   maxActor24h:cap(this.env,"ADMIN_MANUAL_CREDITS_ACTOR_DAILY_LIMIT",10000),
   maxGlobal24h:cap(this.env,"ADMIN_MANUAL_CREDITS_GLOBAL_DAILY_LIMIT",25000)};
 }
 /** No manual update to the balance; an immutable ledger delta only. */
 grant(input:{customerId:string;credits:number;reason:GiftReason;campaignId?:string|null;
  actor:string;note?:string|null;requestKey:string}):{gift:ManualCreditGift;availableCredits:number;replayed:boolean}{
  if(!uuid.test(input.customerId)||!actorPattern.test(input.actor)||!keyPattern.test(input.requestKey)||
     !Number.isSafeInteger(input.credits)||input.credits<=0||
     !GIFT_REASONS.includes(input.reason)||
     (input.note!=null&&(typeof input.note!=="string"||input.note.length>1000))||
     (input.campaignId!=null&&!uuid.test(input.campaignId)))
   throw new GiftError("Ungültige Kundenzuordnung, Credit-Anzahl oder Buchungsreferenz.",400);
  const {maxPerGrant,maxActor24h,maxGlobal24h}=this.limits();
  if(input.credits>maxPerGrant)throw new GiftError("Limit pro Einzelgutschrift überschritten.",422);
  return this.transact(()=>{
   const account=this.account(input.customerId);
   const existing=this.db.prepare("SELECT * FROM admin_credit_gifts WHERE request_key=?")
    .get(input.requestKey) as Record<string,unknown>|undefined;
   if(existing){
    const gift=this.row(existing);
    if(gift.customerId!==input.customerId||gift.credits!==input.credits||
       gift.reason!==input.reason||gift.campaignId!==(input.campaignId??null)||
       gift.note!==(input.note??null)||gift.actor!==input.actor)
     throw new GiftError("Idempotenzkonflikt: Buchungsreferenz wurde bereits anders verwendet.");
    return {gift,availableCredits:this.wallet.available("customer:"+account.id),replayed:true};
   }
   if(input.campaignId){
    const table=this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='marketing_campaigns'").get();
    const matched=table?this.db.prepare("SELECT id FROM marketing_campaigns WHERE id=?")
     .get(input.campaignId):null;
    if(!matched)throw new GiftError("Zugehörige Kampagne existiert nicht.",400);
   }
   const earliest=Date.now()-86400000;
   const actorTotal=this.db.prepare("SELECT COALESCE(SUM(credits),0) sum FROM admin_credit_gifts WHERE actor=? AND created>=?")
    .get(input.actor,earliest) as {sum:number};
   const globalTotal=this.db.prepare("SELECT COALESCE(SUM(credits),0) sum FROM admin_credit_gifts WHERE created>=?")
    .get(earliest) as {sum:number};
   if(Number(actorTotal.sum)+input.credits>maxActor24h||Number(globalTotal.sum)+input.credits>maxGlobal24h)
    throw new GiftError("Tägliches Vergabebudget erreicht.",422);
   const now=Date.now(),id=randomUUID(),reference="admin-credit-gift:"+id;
   this.db.prepare("INSERT INTO credit_wallet_ledger(id,subject,delta,kind,reference,created) VALUES(?,?,?,?,?,?)")
    .run(reference,"customer:"+account.id,input.credits,"manual-gift",reference,now);
   this.db.prepare(`INSERT INTO admin_credit_gifts
    (id,customer_id,credits,reason,campaign_id,actor,internal_note,request_key,created)
    VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(id,account.id,input.credits,input.reason,input.campaignId??null,
     input.actor,input.note??null,input.requestKey,now);
   // Commerce audit persists in the SAME SQLite transaction as the wallet credit.
   this.db.prepare("INSERT INTO commerce_audit(actor,action,record,created) VALUES(?,?,?,?)")
    .run(input.actor,"manual-credit-gift",id,now);
   const gift=this.db.prepare("SELECT * FROM admin_credit_gifts WHERE id=?").get(id) as Record<string,unknown>;
   return {gift:this.row(gift),availableCredits:this.wallet.available("customer:"+account.id),replayed:false};
  });
 }
 /** Full-value correction only, never delete/edit an original gift.
  * A pre-existing spending or reservation holds available funds and blocks reversal.
  */
 correct(input:{giftId:string;actor:string;reason:string;requestKey:string}){
  if(!uuid.test(input.giftId)||!actorPattern.test(input.actor)||!keyPattern.test(input.requestKey)||
    typeof input.reason!=="string"||input.reason.trim().length<20||input.reason.length>1000)
   throw new GiftError("Korrektur erfordert vollständige Referenz und dokumentierten Grund.",400);
  return this.transact(()=>{
   const record=this.db.prepare("SELECT * FROM admin_credit_gifts WHERE id=?")
    .get(input.giftId) as Record<string,unknown>|undefined;
   if(!record)throw new GiftError("Gutschrift nicht gefunden.",404);
   const gift=this.row(record),subject="customer:"+gift.customerId;
   const prior=record.correction_reference===null?null:String(record.correction_reference);
   const reference="admin-credit-correction:"+input.requestKey;
   if(prior){
    if(prior!==reference)throw new GiftError("Gutschrift wurde bereits korrigiert.");
    return {gift,availableCredits:this.wallet.available(subject),replayed:true};
   }
   if(this.wallet.available(subject)<gift.credits)
    throw new GiftError("Credits bereits verwendet oder reserviert. Manuelle Reconciliation erforderlich.");
   const now=Date.now();
   this.db.prepare("INSERT INTO credit_wallet_ledger(id,subject,delta,kind,reference,created) VALUES(?,?,?,?,?,?)")
    .run(reference,subject,-gift.credits,"manual-gift-correction",reference,now);
   this.db.prepare("UPDATE admin_credit_gifts SET reversed_at=?,correction_reference=? WHERE id=? AND reversed_at IS NULL")
    .run(now,reference,input.giftId);
   this.db.prepare("INSERT INTO commerce_audit(actor,action,record,created) VALUES(?,?,?,?)")
    .run(input.actor,"manual-credit-correction",input.giftId,now);
   return {gift:{...gift,reversedAt:now},availableCredits:this.wallet.available(subject),replayed:false};
  });
 }
 list(customerId?:string,limit=100):ManualCreditGift[]{
  if(customerId!==undefined&&!uuid.test(customerId))throw new GiftError("Invalid customer ID",400);
  const rows=customerId?this.db.prepare("SELECT * FROM admin_credit_gifts WHERE customer_id=? ORDER BY created DESC LIMIT ?")
   .all(customerId,limit):this.db.prepare("SELECT * FROM admin_credit_gifts ORDER BY created DESC LIMIT ?").all(limit);
  return (rows as Record<string,unknown>[]).map(row=>this.row(row));
 }
 summary(){
  const row=this.db.prepare("SELECT COUNT(*) n,COALESCE(SUM(credits),0) credits FROM admin_credit_gifts")
   .get() as {n:number;credits:number};
  return {count:row.n,credits:row.credits,referenceValueCents:row.credits};
 }
}
