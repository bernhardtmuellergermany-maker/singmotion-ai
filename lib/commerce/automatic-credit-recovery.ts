/** Safe, bounded, no-provider-call Credit video compensation.
 * The live job state is authoritative for submission/output; the commerce
 * reservation is authoritative for money. This worker NEVER submits a task.
 */
import {DatabaseSync} from "node:sqlite";
import path from "node:path";
import {existsSync} from "node:fs";
import {CommerceStore} from "./store.ts";
import {CreditWallet} from "./credit-wallet.ts";
import {SupportCases} from "./support-cases.ts";

const STAGING="dfaeabed-03df-43ed-aa71-50f343a75041";
const PRODUCTION="36adc41d-7e54-4396-ad1a-fd432ba0441d";
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MINUTE=60_000;
type Evidence={
 state?:unknown;failureCode?:unknown;providerJobId?:unknown;outputPath?:unknown;
 updatedAt?:unknown;createdAt?:unknown;media?:{owner?:unknown}
};
export function automaticCreditRecoveryPolicy(env:Record<string,string|undefined>=process.env){
 const allowed=[STAGING,PRODUCTION].includes(env.RAILWAY_ENVIRONMENT_ID||"");
 const raw=env.AUTO_VIDEO_CREDIT_RECOVERY_TIMEOUT_MINUTES??"120";
 const mins=Number(raw);
 const valid=Number.isSafeInteger(mins)&&mins>=120&&mins<=10080;
 return {enabled:allowed&&env.AUTO_VIDEO_CREDIT_RECOVERY_ENABLED==="true"&&valid,
  timeoutMs:valid?mins*MINUTE:0};
}
export type CreditRecoveryResult={checked:number;returned:number;uncertain:number;failed:number;deferred:number};
/** Runs on the volume-owning server, not from a public endpoint.
 * Exactly one commerce transaction contains ledger, release, audit and mail.
 * A terminal uncertain state cannot be re-polled or auto-resubmitted.
 */
export function recoverVideoCredits(
 root:string,
 opts:{env?:Record<string,string|undefined>;now?:number;limit?:number}={}
):CreditRecoveryResult{
 const result:CreditRecoveryResult={checked:0,returned:0,uncertain:0,failed:0,deferred:0};
 const env=opts.env??process.env;
 const policy=automaticCreditRecoveryPolicy(env);
 const now=opts.now??Date.now();
 const limit=Math.min(20,Math.max(1,opts.limit??10));
 if(!policy.enabled||!Number.isSafeInteger(now)||now<=0)return result;
 const liveFile=path.join(root,"live-test.sqlite");
 const commerceFile=path.join(root,"commerce.sqlite");
 if(!existsSync(liveFile)||!existsSync(commerceFile))return result;
 const live=new DatabaseSync(liveFile,{readOnly:true});
 let commerce:CommerceStore|undefined;
 try{
  commerce=new CommerceStore(commerceFile,env);
  const wallet=new CreditWallet(commerce.db);
  const support=new SupportCases(commerce.db);
  // Rotate a durable scan cursor, so ancient active/invalid reservations
  // cannot starve later failed videos forever. No concurrent worker assumes
  // that the cursor itself is a financial authorization.
  commerce.db.exec(`CREATE TABLE IF NOT EXISTS auto_video_credit_scan_cursor(
   slot INTEGER PRIMARY KEY CHECK(slot=1),last_created INTEGER NOT NULL,last_id TEXT NOT NULL)`);
  const saved=commerce.db.prepare("SELECT last_created,last_id FROM auto_video_credit_scan_cursor WHERE slot=1")
    .get() as {last_created:number;last_id:string}|undefined;
  const select=commerce.db.prepare(`SELECT project_id,subject,credits,state,created
     FROM credit_video_reservations
     WHERE state IN ('reserved','review','settled')
       AND subject LIKE 'customer:%' AND created<=?
       AND (created>? OR (created=? AND project_id>?))
     ORDER BY created,project_id LIMIT ?`);
  type Row={project_id:string;subject:string;credits:number;state:string;created:number};
  let reservations=select.all(now-MINUTE,saved?.last_created??0,saved?.last_created??0,
    saved?.last_id??"",limit) as Row[];
  if(!reservations.length && saved)
    reservations=select.all(now-MINUTE,0,0,"",limit) as Row[];
  if(reservations.length){
    const last=reservations[reservations.length-1];
    commerce.db.prepare(`INSERT INTO auto_video_credit_scan_cursor(slot,last_created,last_id)
      VALUES(1,?,?) ON CONFLICT(slot) DO UPDATE SET
      last_created=excluded.last_created,last_id=excluded.last_id`)
      .run(last.created,last.project_id);
  }
  for(const row of reservations){
   result.checked++;
   if(!UUID.test(row.project_id)||!/^customer:[a-f0-9-]{36}$/.test(row.subject)||
      !Number.isSafeInteger(row.credits)||row.credits<=0){
    result.deferred++;continue;
   }
   let evidence:Evidence;
   try{
    const record=live.prepare("SELECT data FROM live_attempts WHERE id=?").get(row.project_id) as {data:string}|undefined;
    if(!record){result.deferred++;continue}
    evidence=JSON.parse(record.data) as Evidence;
   }catch{result.deferred++;continue}
   // The owner must match the wallet subject independently of supplied IDs.
   const expectedOwner="customer-"+row.subject.slice("customer:".length);
   if(evidence.media?.owner!==expectedOwner||evidence.outputPath!==null||
      !Number.isSafeInteger(evidence.updatedAt)||!Number.isSafeInteger(evidence.createdAt)||
      Number(evidence.updatedAt)>now||Number(evidence.createdAt)>now||
      Number(evidence.createdAt)<1||row.created>now){
    result.deferred++;continue;
   }
   const hasProviderTask=typeof evidence.providerJobId==="string"&&evidence.providerJobId.length>0;
   const isFailed=evidence.state==="failed";
   const isUncertain=evidence.state==="uncertain"&&
     evidence.failureCode==="SUBMISSION_OUTCOME_UNKNOWN"&&!hasProviderTask&&
     now-Math.max(Number(evidence.updatedAt),row.created)>=policy.timeoutMs;
   // Jobs still submitted/processing/output_observed are never refunded based
   // on age alone. They must be independently reconciled with the provider.
   if(!isFailed&&!isUncertain){result.deferred++;continue}
   // Repeat the final evidence check immediately before the commerce commit.
   // Both eligible live states are terminal in LiveTestStore.transition().
   try{
    const hold=wallet.videoReservation(row.project_id);
    if(!hold||hold.subject!==row.subject||!["reserved","review","settled"].includes(hold.state)){
     result.deferred++;continue;
    }
    const kind=isUncertain?"uncertain":"failed";
    const note=isUncertain
      ?"Automated goodwill: provider submission outcome unconfirmed beyond reviewed timeout; SingMotion accepts possible BytePlus charge."
      :"Automated compensation: terminal video failure without a delivered output; SingMotion accepts possible BytePlus charge.";
    // Note that this transaction does not claim provider non-billability.
    commerce.db.exec("BEGIN IMMEDIATE");
    try{
     const current=wallet.videoReservation(row.project_id);
     if(!current||current.subject!==row.subject||!["reserved","review","settled"].includes(current.state))
       throw Error("Reservation already reconciled");
     const event="auto-video-return:"+row.project_id;
     commerce.db.prepare("INSERT INTO credit_wallet_ledger VALUES(?,?,?,?,?,?)")
       .run(event,current.subject,current.state==="settled"?current.credits:0,
         "auto-video-credit-return",event,now);
     const update=commerce.db.prepare("UPDATE credit_video_reservations SET state='released',updated=? WHERE project_id=? AND state=?")
       .run(now,row.project_id,current.state);
     if(update.changes!==1)throw Error("Reservation changed during recovery");
     commerce.db.prepare("INSERT OR IGNORE INTO support_case_events VALUES(?,?,?,?,?,?)")
       .run(event,row.project_id,"credits-returned","auto-recovery",note,now);
     const email=commerce.db.prepare("SELECT email FROM customer_accounts WHERE id=?")
       .get(row.subject.slice("customer:".length)) as {email:string}|undefined;
     support.enqueue(row.project_id,"credits-returned",email?.email??null,"auto-recovery",note);
     commerce.db.exec("COMMIT");
     result.returned++;
     result[kind]++;
    }catch(e){commerce.db.exec("ROLLBACK");throw e}
   }catch{result.deferred++}
  }
 }finally{live.close();commerce?.close()}
 return result;
}
