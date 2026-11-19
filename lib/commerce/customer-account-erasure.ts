/**
 * Conservative, password-confirmed customer erasure for accounts with no owned
 * media, paid purchases, unsettled Credits or provider evidence.
 *
 * This is deliberately NOT a generalized cross-store purge: R2, provider,
 * invoice and backup objects must never be silently forgotten when a row is
 * removed. Accounts with such records stay intact for the separate, verified
 * erasure and financial-resolution workflow.
 */
import {existsSync} from "node:fs";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import type {CommerceStore} from "./store.ts";

export type ErasureAssessment={
 eligible:boolean;
 code:"READY"|"ACCOUNT_MISSING"|"GOOGLE_REAUTH_REQUIRED"|"CREDITS_OR_PAYMENTS"|"MEDIA_OR_ORDERS"|"RECORDS_REQUIRE_REVIEW";
 message:string;
};
const ready:ErasureAssessment={eligible:true,code:"READY",
 message:"No paid balance, orders, owned media or outstanding work was found. This account can be deleted after password confirmation."};
const denied=(code:Exclude<ErasureAssessment["code"],"READY">,message:string):ErasureAssessment=>
 ({eligible:false,code,message});
const safeTable=(name:string)=>'"'+name.replaceAll('"','""')+'"';
const tableNames=(db:DatabaseSync)=>(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {name:string}[]).map(r=>r.name);
const tableColumns=(db:DatabaseSync,table:string)=>
 (db.prepare("PRAGMA table_info("+safeTable(table)+")").all() as {name:string;type:string}[]);
const hasTable=(db:DatabaseSync,name:string)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
const giftRef=(id:string)=>"beta-welcome:v1:"+id;

/** A read-only scan of a table detects explicit identities and embedded JSON.
 * Unknown owner-bearing tables are blockers, not silently orphaned records.
 */
function containsIdentity(db:DatabaseSync,table:string,id:string,email:string):boolean{
 const columns=tableColumns(db,table);
 const owner="customer-"+id,subject="customer:"+id;
 const clauses:string[]=[],params:string[]=[];
 for(const column of columns){
  const field=safeTable(column.name);
  const type=column.type.toUpperCase();
  if(!/TEXT|CHAR|CLOB|JSON|VARCHAR/.test(type))continue;
  // Exact values also find owner/user/email columns; instr finds manifests,
  // serialized projects and audit records without assuming JSON validity.
  clauses.push("("+field+"=? OR "+field+"=? OR "+field+"=? OR lower("+field+")=lower(?) OR instr("+field+",?)>0 OR instr("+field+",?)>0 OR instr(lower("+field+"),lower(?))>0)");
  params.push(id,owner,subject,email,owner,subject,email);
 }
 if(clauses.length===0)return false;
 return !!db.prepare("SELECT 1 FROM "+safeTable(table)+" WHERE "+clauses.join(" OR ")+" LIMIT 1").get(...params);
}
function ownGiftOnly(db:DatabaseSync,id:string):boolean{
 if(!hasTable(db,"credit_wallet_ledger"))return true;
 const items=db.prepare("SELECT id,delta,kind,reference FROM credit_wallet_ledger WHERE subject=?")
   .all("customer:"+id) as {id:string;delta:number;kind:string;reference:string}[];
 return items.every(row=>row.id===giftRef(id)&&row.reference===giftRef(id)&&
  row.kind==="beta-welcome"&&row.delta===250);
}
const removableCommerce=new Set([
 "customer_accounts","customer_sessions","customer_session_policies",
 "customer_email_verifications","customer_google_identities",
 "customer_password_resets","customer_email_preferences","credit_wallet_ledger",
]);
function checkCommerce(db:DatabaseSync,id:string,email:string):ErasureAssessment{
 if(!ownGiftOnly(db,id))return denied("CREDITS_OR_PAYMENTS",
  "Credits or their financial ledger require resolution before account deletion. Purchased Credits are not automatically forfeited or refunded.");
 // Every recorded top-up is financially relevant, including pending Checkout
 // attempts and reversals which must remain reconcilable with Stripe.
 const subject="customer:"+id;
 if((hasTable(db,"credit_topup_purchases")&&db.prepare("SELECT 1 FROM credit_topup_purchases WHERE subject=? OR email=? LIMIT 1").get(subject,email))||
    (hasTable(db,"credit_video_reservations")&&db.prepare("SELECT 1 FROM credit_video_reservations WHERE subject=? LIMIT 1").get(subject)))
  return denied("CREDITS_OR_PAYMENTS",
    "Credit purchases, reservations or payment reconciliation must be settled before account deletion.");
 for(const table of tableNames(db)){
  if(removableCommerce.has(table))continue;
  if(containsIdentity(db,table,id,email))
   return denied("MEDIA_OR_ORDERS","Orders, billing evidence or other linked records need safe retention or removal before the account can be deleted.");
 }
 return ready;
}
function checkOwnedRecords(db:DatabaseSync,id:string,email:string,allowSessions:boolean):boolean{
 for(const table of tableNames(db)){
  if(allowSessions&&table==="sessions")continue;
  if(containsIdentity(db,table,id,email))return false;
 }
 return true;
}
function openIfPresent(filename:string,readOnly=true):DatabaseSync|null{
 return existsSync(filename)?new DatabaseSync(filename,readOnly?{readOnly:true}:undefined):null;
}
function accountProfile(db:DatabaseSync,id:string):{email:string;password_hash:string}|undefined{
 return db.prepare("SELECT email,password_hash FROM customer_accounts WHERE id=?").get(id) as {email:string;password_hash:string}|undefined;
}
const googleReauth=()=>denied("GOOGLE_REAUTH_REQUIRED",
 "This account uses Google sign-in without a local password. Fresh Google re-authentication is not yet implemented for deletion; please contact privacy support. No account data has been deleted.");
/** Never changes a record. A guard here must be repeated under a write lock. */
export function assessCustomerErasure(store:CommerceStore,root:string,id:string):ErasureAssessment{
 const profile=accountProfile(store.db,id);
 if(!profile)return denied("ACCOUNT_MISSING","Account is no longer available.");
 if(profile.password_hash.startsWith("google-only:"))return googleReauth();
 const commerce=checkCommerce(store.db,id,profile.email);
 if(!commerce.eligible)return commerce;
 const demo=openIfPresent(path.join(root,"demo.sqlite"));
 const live=openIfPresent(path.join(root,"live-test.sqlite"));
 try{
  // Without a demo database, ownership of local assets cannot be established.
  if(!demo)return denied("RECORDS_REQUIRE_REVIEW","Media storage cannot be verified right now. No account data has been removed.");
  if(!checkOwnedRecords(demo,id,profile.email,true)||
     (live&&!checkOwnedRecords(live,id,profile.email,false)))
   return denied("MEDIA_OR_ORDERS","Saved uploads, videos, projects or provider work need verified deletion first. Your account and Credits have not been changed.");
  return ready;
 }finally{live?.close();demo?.close();}
}
/** Caller MUST freshly verify session, password and explicit confirmation.
 * Serialize the accounts ledger and media sessions, then re-check every gate
 * under write locks. No Stripe APIs or refundable financial rows are touched.
 */
export function eraseEmptyCustomerAccount(store:CommerceStore,root:string,id:string):ErasureAssessment{
 const demoFile=path.join(root,"demo.sqlite");
 if(!existsSync(demoFile))return denied("RECORDS_REQUIRE_REVIEW","Media storage is unavailable. Nothing has been deleted.");
 const demo=new DatabaseSync(demoFile);
 const live=openIfPresent(path.join(root,"live-test.sqlite"),false);
 let commerceLocked=false,demoLocked=false,liveLocked=false;
 try{
  store.db.exec("BEGIN IMMEDIATE");commerceLocked=true;
  demo.exec("BEGIN IMMEDIATE");demoLocked=true;
  if(live){live.exec("BEGIN IMMEDIATE");liveLocked=true;}
  const profile=accountProfile(store.db,id);
  if(!profile)return denied("ACCOUNT_MISSING","Account is no longer available.");
  if(profile.password_hash.startsWith("google-only:"))return googleReauth();
  const check=checkCommerce(store.db,id,profile.email);
  if(!check.eligible)return check;
  if(!checkOwnedRecords(demo,id,profile.email,true))
   return denied("MEDIA_OR_ORDERS","Owned media records were detected. Nothing has been deleted.");
  if(live&&!checkOwnedRecords(live,id,profile.email,false))
   return denied("MEDIA_OR_ORDERS","A video or provider record still needs secure cleanup. Nothing has been deleted.");
  const subject="customer:"+id;
  // The one verified promotional gift may be discarded. Never remove a
  // purchased top-up, consumed paid-credit evidence or provider reservation.
  if(hasTable(store.db,"credit_wallet_ledger"))
   store.db.prepare("DELETE FROM credit_wallet_ledger WHERE subject=? AND kind='beta-welcome' AND reference=?")
    .run(subject,giftRef(id));
  for(const table of ["customer_sessions","customer_session_policies",
     "customer_email_verifications","customer_google_identities",
     "customer_password_resets","customer_email_preferences"]){
   if(hasTable(store.db,table))store.db.prepare("DELETE FROM "+safeTable(table)+" WHERE account_id=?").run(id);
  }
  // Prevent any remaining authenticated media cookie from opening files.
  demo.prepare("DELETE FROM sessions WHERE owner=?").run("customer-"+id);
  const removed=store.db.prepare("DELETE FROM customer_accounts WHERE id=?").run(id);
  if(removed.changes!==1)throw Error("Account erasure transaction did not match one account");
  if(live){live.exec("COMMIT");liveLocked=false;}
  demo.exec("COMMIT");demoLocked=false;
  store.db.exec("COMMIT");commerceLocked=false;
  return ready;
 }finally{
  if(liveLocked)try{live?.exec("ROLLBACK")}catch{}
  if(demoLocked)try{demo.exec("ROLLBACK")}catch{}
  if(commerceLocked)try{store.db.exec("ROLLBACK")}catch{}
  live?.close();
  demo.close();
 }
}
