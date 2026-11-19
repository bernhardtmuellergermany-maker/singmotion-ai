/**
 * Last, idempotent step of a frozen customer-erasure job. Removes account
 * identity and unnecessary operational data; keeps only minimized,
 * pseudonymized payment/credit evidence required to handle legal, tax,
 * Stripe webhook, refunds and dispute reconciliation.
 *
 * Never runs while a Stripe refund is pending or media cleanup unverified.
 * Financial records are NEVER sent to clients after the account disappears.
 */
import {DatabaseSync} from "node:sqlite";
import {createHash} from "node:crypto";
import type {CommerceStore} from "./store.ts";
import {quoteCustomerErasureRefund} from "./customer-erasure-refund-quote.ts";
import {readErasureJob,advanceErasureJob} from "./customer-erasure-job.ts";

type Row={name:string};
const ident=(v:string)=>'"'+v.replaceAll('"','""')+'"';
const tables=(db:DatabaseSync)=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Row[];
const has=(db:DatabaseSync,name:string)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
const columns=(db:DatabaseSync,name:string)=>db.prepare("PRAGMA table_info("+ident(name)+")").all() as {name:string;type:string}[];
const eraseBy=(db:DatabaseSync,table:string,column:string,value:string)=>{
 if(has(db,table)&&columns(db,table).some(c=>c.name===column))
  db.prepare("DELETE FROM "+ident(table)+" WHERE "+ident(column)+"=?").run(value);
};
const anonymizeBy=(db:DatabaseSync,table:string,column:string,value:string,replacement:string)=>{
 if(has(db,table)&&columns(db,table).some(c=>c.name===column))
  db.prepare("UPDATE "+ident(table)+" SET "+ident(column)+"=? WHERE "+ident(column)+"=?")
   .run(replacement,value);
};
export class AccountErasureFinalizationBlocked extends Error{
 readonly code:string;
 constructor(code:string){super(code);this.code=code}
}
export function finalizeErasedCustomerData(store:CommerceStore,accountId:string):boolean{
 const db=store.db;
 if(!/^[a-f0-9-]{36}$/i.test(accountId))throw new AccountErasureFinalizationBlocked("INVALID_ACCOUNT_ID");
 const job=readErasureJob(db,accountId);
 if(job?.state==="completed")return true;
 if(job?.state!=="removing-data")throw new AccountErasureFinalizationBlocked("ERASURE_NOT_READY");
 db.exec("BEGIN IMMEDIATE");
 try{
  // Allow safe replay after a crash between irreversible cloud deletion and
  // SQL finalization. Completion and account removal share this transaction.
  const account=db.prepare("SELECT email FROM customer_accounts WHERE id=?").get(accountId) as {email:string}|undefined;
  if(!account){
   advanceErasureJob(db,accountId,"completed");
   db.exec("COMMIT");return true;
  }
  // Existing subscriptions are independent financial obligations, never
  // silently cancelled by a refund of newly purchased prepaid Credits.
  if(has(db,"customer_subscriptions")&&
     db.prepare("SELECT 1 FROM customer_subscriptions WHERE account_id=? AND status NOT IN ('cancelled','canceled','expired','inactive') LIMIT 1")
      .get(accountId))
   throw new AccountErasureFinalizationBlocked("ACTIVE_SUBSCRIPTION");
  const quote=quoteCustomerErasureRefund(db,accountId);
  if(!quote.ready)throw new AccountErasureFinalizationBlocked("FINANCIAL_RECONCILIATION_REQUIRED");
  if(quote.lines.length){
   if(!has(db,"customer_erasure_refund_intents"))
    throw new AccountErasureFinalizationBlocked("MISSING_REFUND_EVIDENCE");
   for(const line of quote.lines){
    const intent=db.prepare("SELECT account_id,credits,cents,session_id,state,refund_id FROM customer_erasure_refund_intents WHERE purchase_id=?")
     .get(line.purchaseId) as {account_id:string;credits:number;cents:number;session_id:string;state:string;refund_id:string|null}|undefined;
    if(!intent||intent.account_id!==accountId||intent.cents!==line.cents||
       intent.credits!==line.credits||intent.session_id!==line.sessionId||
       intent.state!=="succeeded"||!intent.refund_id)
     throw new AccountErasureFinalizationBlocked("UNSETTLED_REFUND");
   }
  }
  // Legacy subscription commitments must be explicitly terminated and
  // their legal entitlements resolved before erasing an active subscriber.
  if(has(db,"customer_subscriptions")){
   const active=db.prepare("SELECT 1 FROM customer_subscriptions WHERE account_id=? AND status NOT IN ('cancelled','canceled','expired','inactive') LIMIT 1")
    .get(accountId);
   if(active)throw new AccountErasureFinalizationBlocked("ACTIVE_SUBSCRIPTION");
  }
  const owner="customer-"+accountId,subject="customer:"+accountId,
   erased="closed:"+createHash("sha256").update(accountId).digest("hex");
  const orderIds=has(db,"customer_orders")?
   db.prepare("SELECT id FROM customer_orders WHERE account_id=?").all(accountId) as {id:string}[]:[];
  // Unknown account-linked tables are not silently discarded. They may hold
  // new provider evidence or private content requiring a verified deletion.
  const known=new Set([
   "customer_accounts","customer_sessions","customer_session_policies",
   "customer_email_verifications","customer_google_identities","customer_password_resets",
   "customer_email_preferences","customer_erasure_jobs","customer_erasure_refund_intents",
   "customer_orders","customer_credits","customer_holds","customer_subscriptions",
   "customer_plan_usage","customer_split_quotes","credit_topup_purchases",
   "credit_wallet_ledger","credit_video_reservations","credit_purchase_tax_context",
   "customer_hidden_paid_orders","customer_guest_order_claims",
   "customer_early_performance_consents","free_promo_video_deliveries",
   "customer_studio_credit_video_ready_outbox","customer_video_ready_notifications",
   "promo_redemptions","commerce_audit",
   "customer_fulfillment_queue","customer_provider_jobs","customer_order_inputs",
   "customer_prepared_media","customer_video_deliveries","customer_provider_input_leases",
   "customer_provider_submissions","customer_provider_cost_reservations",
   "cloud_paid_videos","support_cases","support_case_events",
   "support_case_mail_outbox","support_stripe_refund_intents"
  ]);
  const search=(table:string,id:string,email:string)=>{
   const terms=[id,"customer:"+id,"customer-"+id,email],filters:string[]=[],args:string[]=[];
   for(const col of columns(db,table)){
    if(!/(TEXT|CHAR|CLOB|JSON|VARCHAR)/i.test(col.type))continue;
    for(const word of terms){
     const field=ident(col.name);
     filters.push("instr(lower("+field+"),lower(?))>0");
     args.push(word);
    }
   }
   return filters.length&&!!db.prepare("SELECT 1 FROM "+ident(table)+" WHERE "+filters.join(" OR ")+" LIMIT 1").get(...args);
  };
  for(const table of tables(db)){
   if(known.has(table.name))continue;
   if(search(table.name,accountId,account.email))
    throw new AccountErasureFinalizationBlocked("UNKNOWN_ACCOUNT_REFERENCE");
   if(orderIds.length&&columns(db,table.name).some(c=>c.name==="order_id")){
    const query=db.prepare("SELECT 1 FROM "+ident(table.name)+" WHERE order_id=? LIMIT 1");
    if(orderIds.some(o=>query.get(o.id)))
     throw new AccountErasureFinalizationBlocked("UNKNOWN_FINANCIAL_REFERENCE");
   }
  }
  // Support/dispute records are not ordinary user content. A case or unsent
  // notice must be resolved and safely retained before account closure.
  if(has(db,"support_cases")){
   const find=db.prepare("SELECT 1 FROM support_cases WHERE reference=? LIMIT 1");
   if(orderIds.some(o=>find.get(o.id)))
    throw new AccountErasureFinalizationBlocked("OPEN_FINANCIAL_SUPPORT_EVIDENCE");
  }
  if(has(db,"support_case_mail_outbox")&&
     db.prepare("SELECT 1 FROM support_case_mail_outbox WHERE lower(recipient)=lower(?) AND sent_at IS NULL LIMIT 1").get(account.email))
   throw new AccountErasureFinalizationBlocked("PENDING_SUPPORT_NOTIFICATION");
  // Discard personal operational information and sessions.
  for(const table of ["customer_sessions","customer_session_policies","customer_email_verifications",
    "customer_google_identities","customer_password_resets","customer_email_preferences",
    "customer_hidden_paid_orders","customer_guest_order_claims",
    "customer_subscriptions","customer_plan_usage","customer_split_quotes",
    "free_promo_video_deliveries","customer_studio_credit_video_ready_outbox",
    "customer_video_ready_notifications"])
   eraseBy(db,table,"account_id",accountId);
  for(const table of ["customer_holds","customer_credits","customer_early_performance_consents",
    "promo_redemptions"])anonymizeBy(db,table,"account_id",accountId,erased);
  if(has(db,"credit_topup_purchases")){
   const purchases=db.prepare("SELECT id FROM credit_topup_purchases WHERE subject=?").all(subject) as {id:string}[];
   for(const purchase of purchases)
    db.prepare("UPDATE credit_topup_purchases SET subject=?,email=?,checkout_url=NULL,request_key=? WHERE id=?")
     .run(erased,"deleted-account@singmotion.invalid","erased:"+purchase.id,purchase.id);
  }
  if(has(db,"credit_wallet_ledger")){
   // Terminate the whole spendable balance after recording verified purchased
   // refunds. Remaining promotional Credits expire without cash payout.
   const row=db.prepare("SELECT COALESCE(SUM(delta),0) AS balance FROM credit_wallet_ledger WHERE subject=?")
    .get(subject) as {balance:number};
   if(!Number.isSafeInteger(row.balance)||row.balance<0)
    throw new AccountErasureFinalizationBlocked("UNSETTLED_WALLET_BALANCE");
   const hash=createHash("sha256").update(accountId).digest("hex");
   if(row.balance>0)
    db.prepare("INSERT OR IGNORE INTO credit_wallet_ledger VALUES(?,?,?,?,?,?)")
     .run("erasure-close:"+hash,subject,-row.balance,"erasure-close","erasure-close:"+hash,Date.now());
   // Keep the ledger arithmetically intact but remove the account UUID from
   // the promotional grant identifier before pseudonymizing all subjects.
   db.prepare("UPDATE credit_wallet_ledger SET id=?,reference=? WHERE subject=? AND kind='beta-welcome' AND reference=?")
    .run("erased-bonus:"+hash,"erased-bonus:"+hash,subject,"beta-welcome:v1:"+accountId);
  }
  anonymizeBy(db,"credit_wallet_ledger","subject",subject,erased);
  anonymizeBy(db,"credit_video_reservations","subject",subject,erased);
  for(const order of orderIds){
   // Retain only the charge/refund audit shell. No customer email, guest
   // recovery secret, original prompt, title or project-specific content.
   db.prepare("UPDATE customer_orders SET account_id=NULL,guest_hash=NULL,guest_expiry=NULL,email=?,project_id=?,quote_evidence=?,request_key=? WHERE id=?")
    .run("deleted-account@singmotion.invalid","erased:"+order.id,"{}","erased:"+order.id,order.id);
   for(const table of ["customer_prepared_media","customer_order_inputs","customer_provider_input_leases",
     "cloud_paid_videos","customer_video_deliveries","customer_provider_submissions",
     "customer_fulfillment_queue","customer_provider_jobs","customer_provider_cost_reservations"])
    eraseBy(db,table,"order_id",order.id);
  }
  if(has(db,"commerce_audit"))
   db.prepare("DELETE FROM commerce_audit WHERE actor=? OR instr(record,?)>0 OR instr(lower(record),lower(?))>0")
    .run(subject,accountId,account.email);
  if(has(db,"support_case_mail_outbox"))
   db.prepare("DELETE FROM support_case_mail_outbox WHERE lower(recipient)=lower(?)").run(account.email);
  // No identity should remain in incidental tables (payment evidence already
  // minimized and erasure job/status receipts intentionally retained).
  const allowedResidue=new Set(["customer_accounts","customer_erasure_jobs","customer_erasure_refund_intents"]);
  for(const table of tables(db)){
   if(allowedResidue.has(table.name))continue;
   if(search(table.name,accountId,account.email))
    throw new AccountErasureFinalizationBlocked("ACCOUNT_REFERENCE_REMAINS");
  }
  if(db.prepare("DELETE FROM customer_accounts WHERE id=?").run(accountId).changes!==1)
   throw new AccountErasureFinalizationBlocked("ACCOUNT_DELETE_CONFLICT");
  advanceErasureJob(db,accountId,"completed");
  db.exec("COMMIT");
  return true;
 }catch(error){db.exec("ROLLBACK");throw error}
}
