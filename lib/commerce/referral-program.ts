import {randomBytes} from "node:crypto";
import type {DatabaseSync} from "node:sqlite";
import {CreditWallet} from "./credit-wallet.ts";
import {erasureInProgress} from "./customer-erasure-job.ts";

/** Referral rewards are prepaid-wallet marketing gifts, never Stripe revenue.
 * All configuration and reward state is durable on the commerce volume.
 * Default is OFF, even when deployed to production. */
export type ReferralSettings={
 enabled:boolean;referrerCredits:number;friendCredits:number;minimumPurchaseCredits:number;
 holdDays:number;maxTotalCredits:number;maxPerReferrer:number;revision:number;
};
export type ReferralReconcile={queued:number;awarded:number;cancelled:number;review:number};
const CODE=/^[A-Za-z0-9_-]{16}$/;
const UUID=/^[a-f0-9-]{36}$/i;
const DAY=86400000;
const settingsColumns="enabled,referrer_credits,friend_credits,minimum_purchase_credits,hold_days,max_total_credits,max_per_referrer,revision";
type Row={enabled:number;referrer_credits:number;friend_credits:number;minimum_purchase_credits:number;hold_days:number;max_total_credits:number;max_per_referrer:number;revision:number};
export class ReferralError extends Error{
 readonly status:number;
 constructor(message:string,status=400){super(message);this.status=status;}
}
export class ReferralProgram{
 private readonly db:DatabaseSync;
 constructor(db:DatabaseSync){
  this.db=db;
  db.exec([
   "CREATE TABLE IF NOT EXISTS referral_settings(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL CHECK(enabled IN(0,1)),referrer_credits INTEGER NOT NULL,friend_credits INTEGER NOT NULL,minimum_purchase_credits INTEGER NOT NULL,hold_days INTEGER NOT NULL,max_total_credits INTEGER NOT NULL,max_per_referrer INTEGER NOT NULL,revision INTEGER NOT NULL)",
   "CREATE TABLE IF NOT EXISTS referral_codes(customer_id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,created INTEGER NOT NULL)",
   "CREATE TABLE IF NOT EXISTS referral_attributions(referred_id TEXT PRIMARY KEY,referrer_id TEXT NOT NULL,code TEXT NOT NULL,created INTEGER NOT NULL)",
   "CREATE INDEX IF NOT EXISTS referral_by_referrer ON referral_attributions(referrer_id,created)",
   "CREATE TABLE IF NOT EXISTS referral_rewards(purchase_id TEXT PRIMARY KEY,referred_id TEXT NOT NULL,referrer_id TEXT NOT NULL,referrer_credits INTEGER NOT NULL,friend_credits INTEGER NOT NULL,created INTEGER NOT NULL,eligible_at INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN('pending','awarded','cancelled','review')),updated INTEGER NOT NULL)",
   "CREATE INDEX IF NOT EXISTS referral_reward_status ON referral_rewards(status,eligible_at)"
  ].join(";")+";");
  db.prepare("INSERT OR IGNORE INTO referral_settings VALUES(1,0,125,100,500,14,25000,10,1)").run();
 }
 settings():ReferralSettings{
  const r=this.db.prepare("SELECT "+settingsColumns+" FROM referral_settings WHERE id=1").get() as Row;
  return {enabled:r.enabled===1,referrerCredits:r.referrer_credits,friendCredits:r.friend_credits,
   minimumPurchaseCredits:r.minimum_purchase_credits,holdDays:r.hold_days,
   maxTotalCredits:r.max_total_credits,maxPerReferrer:r.max_per_referrer,revision:r.revision};
 }
 saveSettings(input:ReferralSettings,actor:string):ReferralSettings{
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(actor)||
   typeof input.enabled!=="boolean"||
   !Number.isSafeInteger(input.referrerCredits)||input.referrerCredits<0||input.referrerCredits>5000||
   !Number.isSafeInteger(input.friendCredits)||input.friendCredits<0||input.friendCredits>5000||
   !Number.isSafeInteger(input.minimumPurchaseCredits)||input.minimumPurchaseCredits<500||input.minimumPurchaseCredits>100000||
   !Number.isSafeInteger(input.holdDays)||input.holdDays<1||input.holdDays>90||
   !Number.isSafeInteger(input.maxTotalCredits)||input.maxTotalCredits<1||input.maxTotalCredits>1000000||
   !Number.isSafeInteger(input.maxPerReferrer)||input.maxPerReferrer<1||input.maxPerReferrer>1000||
   !Number.isSafeInteger(input.revision)||input.revision<1||
   (input.enabled&&(input.referrerCredits+input.friendCredits<1||
    input.referrerCredits+input.friendCredits>input.maxTotalCredits)))
   throw new ReferralError("Invalid referral settings or promotional budget");
  this.db.exec("BEGIN IMMEDIATE");
  try{
   const changed=this.db.prepare("UPDATE referral_settings SET enabled=?,referrer_credits=?,friend_credits=?,minimum_purchase_credits=?,hold_days=?,max_total_credits=?,max_per_referrer=?,revision=revision+1 WHERE id=1 AND revision=?")
    .run(input.enabled?1:0,input.referrerCredits,input.friendCredits,
     input.minimumPurchaseCredits,input.holdDays,input.maxTotalCredits,input.maxPerReferrer,input.revision);
   if(changed.changes!==1)throw new ReferralError("Settings changed. Reload before saving.",409);
   this.db.prepare("INSERT INTO commerce_audit(actor,action,record,created) VALUES(?,?,?,?)")
    .run(actor,"referral-settings",String(input.revision+1),Date.now());
   this.db.exec("COMMIT");
   return this.settings();
  }catch(e){this.db.exec("ROLLBACK");throw e;}
 }
 private verifiedCustomer(id:string):boolean{
  const exists=this.db.prepare("SELECT 1 FROM customer_accounts WHERE id=?").get(id);
  if(!exists||erasureInProgress(this.db,id))return false;
  const state=this.db.prepare("SELECT verified_at FROM customer_email_verifications WHERE account_id=?")
   .get(id) as {verified_at:number|null}|undefined;
  return !state||state.verified_at!==null;
 }
 private codeFor(id:string):string{
  const existing=this.db.prepare("SELECT code FROM referral_codes WHERE customer_id=?").get(id) as {code:string}|undefined;
  if(existing)return existing.code;
  const code=randomBytes(12).toString("base64url");
  this.db.prepare("INSERT OR IGNORE INTO referral_codes VALUES(?,?,?)").run(id,code,Date.now());
  // Concurrent GET requests for the same account must return the canonical code.
  const persisted=this.db.prepare("SELECT code FROM referral_codes WHERE customer_id=?").get(id) as {code:string}|undefined;
  if(!persisted)throw Error("Referral code conflict");
  return persisted.code;
 }
 /** Only called in the SAME transaction as a freshly created customer account. */
 bindNewCustomer(referredId:string,code:string|undefined):boolean{
  if(!this.settings().enabled||!code||!CODE.test(code)||!UUID.test(referredId))return false;
  const row=this.db.prepare("SELECT customer_id FROM referral_codes WHERE code=?")
   .get(code) as {customer_id:string}|undefined;
  if(!row||row.customer_id===referredId||!this.verifiedCustomer(row.customer_id)||
   !this.db.prepare("SELECT 1 FROM customer_accounts WHERE id=?").get(referredId))return false;
  const changed=this.db.prepare("INSERT OR IGNORE INTO referral_attributions VALUES(?,?,?,?)")
   .run(referredId,row.customer_id,code,Date.now());
  return changed.changes===1;
 }
 /** Public /r/[code] route may check existence but cannot mutate attribution. */
 accepts(code:string):boolean{
  return this.settings().enabled&&CODE.test(code)&&!!this.db.prepare(
   "SELECT 1 FROM referral_codes WHERE code=?").get(code);
 }
 customerView(customerId:string){
  const config=this.settings();
  if(!config.enabled||!this.verifiedCustomer(customerId))
   return {enabled:false};
  const code=this.codeFor(customerId);
  const stats=this.db.prepare(
   "SELECT COUNT(*) total,COALESCE(SUM(CASE WHEN status IN('awarded','review') THEN referrer_credits ELSE 0 END),0) earned FROM referral_rewards WHERE referrer_id=?"
  ).get(customerId) as {total:number;earned:number};
  return {enabled:true,code,referrerCredits:config.referrerCredits,
   friendCredits:config.friendCredits,minimumPurchaseCredits:config.minimumPurchaseCredits,
   holdDays:config.holdDays,qualified:stats.total,earnedCredits:stats.earned};
 }
 adminStats(){
  return this.db.prepare(
   "SELECT COUNT(*) rewards,COALESCE(SUM(CASE WHEN status IN('pending','awarded','review') THEN referrer_credits+friend_credits ELSE 0 END),0) committedCredits,COALESCE(SUM(CASE WHEN status IN('awarded','review') THEN 1 ELSE 0 END),0) paid,COALESCE(SUM(CASE WHEN status='review' THEN 1 ELSE 0 END),0) reviews FROM referral_rewards"
  ).get();
 }
 /** Run on the existing private worker, never from a public HTTP write endpoint.
  * Checkout provenance is the verified Stripe-paid credit_topup_purchases row,
  * not a redirect or a customer-controlled claim. */
 reconcile(now=Date.now(),limit=20):ReferralReconcile{
  if(!Number.isSafeInteger(now)||now<1||!Number.isSafeInteger(limit)||limit<1||limit>50)
   throw new ReferralError("Invalid referral reconciliation bounds");
  const out:ReferralReconcile={queued:0,awarded:0,cancelled:0,review:0};
  const settings=this.settings();
  new CreditWallet(this.db);
  this.db.exec("BEGIN IMMEDIATE");
  try{
   if(settings.enabled){
    const candidates=this.db.prepare(
     "SELECT p.id,p.subject,p.paid_at,p.created,p.credits,a.referred_id,a.referrer_id "+
     "FROM credit_topup_purchases p JOIN referral_attributions a ON p.subject='customer:'||a.referred_id "+
     "WHERE p.status='paid' AND p.credits>=? AND NOT EXISTS(SELECT 1 FROM referral_rewards w WHERE w.purchase_id=p.id) "+
     "ORDER BY p.paid_at,p.id LIMIT ?"
    ).all(settings.minimumPurchaseCredits,limit) as Array<{
     id:string;subject:string;paid_at:number|null;created:number;credits:number;referred_id:string;referrer_id:string
    }>;
    for(const p of candidates){
     if(!this.verifiedCustomer(p.referred_id)||!this.verifiedCustomer(p.referrer_id))continue;
     // First paid/reversed topup ever: an older refunded purchase cannot earn a second bonus.
     const before=this.db.prepare(
      "SELECT 1 FROM credit_topup_purchases WHERE subject=? AND id<>? AND status IN('paid','reversed') "+
      "AND (COALESCE(paid_at,created)<? OR (COALESCE(paid_at,created)=? AND id<?)) LIMIT 1"
     ).get(p.subject,p.id,p.paid_at??p.created,p.paid_at??p.created,p.id);
     if(before)continue;
     const count=this.db.prepare("SELECT COUNT(*) n FROM referral_rewards WHERE referrer_id=? AND status IN('pending','awarded','review')")
      .get(p.referrer_id) as {n:number};
     if(count.n>=settings.maxPerReferrer)continue;
     const used=this.adminStats() as {committedCredits:number};
     if(used.committedCredits+settings.referrerCredits+settings.friendCredits>settings.maxTotalCredits)continue;
     this.db.prepare("INSERT INTO referral_rewards VALUES(?,?,?,?,?,? ,?,'pending',?)")
      .run(p.id,p.referred_id,p.referrer_id,settings.referrerCredits,settings.friendCredits,
       now,Math.max(now,p.paid_at??now)+settings.holdDays*DAY,now);
     out.queued++;
    }
   }
   const due=this.db.prepare(
    "SELECT purchase_id,referred_id,referrer_id,referrer_credits,friend_credits "+
    "FROM referral_rewards WHERE status='pending' AND eligible_at<=? ORDER BY eligible_at LIMIT ?"
   ).all(now,limit) as Array<{purchase_id:string;referred_id:string;referrer_id:string;
    referrer_credits:number;friend_credits:number}>;
   for(const r of due){
    const purchase=this.db.prepare("SELECT status,subject FROM credit_topup_purchases WHERE id=?")
     .get(r.purchase_id) as {status:string;subject:string}|undefined;
    const cancelled=!purchase||purchase.status==="reversed"||
     purchase.subject!=="customer:"+r.referred_id||
     !this.verifiedCustomer(r.referred_id)||!this.verifiedCustomer(r.referrer_id);
    if(cancelled){
     this.db.prepare("UPDATE referral_rewards SET status='cancelled',updated=? WHERE purchase_id=? AND status='pending'")
      .run(now,r.purchase_id);
     out.cancelled++;continue;
    }
    if(purchase.status!=="paid")continue;
    for(const [id,credits,role] of [[r.referrer_id,r.referrer_credits,"referrer"],[r.referred_id,r.friend_credits,"friend"]] as const){
     if(credits===0)continue;
     const key="referral:"+role+":"+r.purchase_id;
     this.db.prepare("INSERT INTO credit_wallet_ledger(id,subject,delta,kind,reference,created) VALUES(?,?,?,?,?,?)")
      .run(key,"customer:"+id,credits,"referral-bonus",key,now);
    }
    this.db.prepare("UPDATE referral_rewards SET status='awarded',updated=? WHERE purchase_id=? AND status='pending'")
     .run(now,r.purchase_id);
    this.db.prepare("INSERT INTO commerce_audit(actor,action,record,created) VALUES(?,?,?,?)")
     .run("referral-worker","referral-awarded",r.purchase_id,now);
    out.awarded++;
   }
   // A chargeback after bonus payout requires reviewed recovery. Never silently
   // subtract purchased funds or claim an already-spent bonus was reversed.
   const reversed=this.db.prepare(
    "SELECT w.purchase_id FROM referral_rewards w JOIN credit_topup_purchases p ON p.id=w.purchase_id "+
    "WHERE w.status='awarded' AND p.status='reversed' LIMIT ?"
   ).all(limit) as Array<{purchase_id:string}>;
   for(const r of reversed){
    this.db.prepare("UPDATE referral_rewards SET status='review',updated=? WHERE purchase_id=? AND status='awarded'")
     .run(now,r.purchase_id);
    this.db.prepare("INSERT INTO commerce_audit(actor,action,record,created) VALUES(?,?,?,?)")
     .run("referral-worker","referral-refund-review",r.purchase_id,now);
    out.review++;
   }
   this.db.exec("COMMIT");
  }catch(e){this.db.exec("ROLLBACK");throw e;}
  return out;
 }
}
