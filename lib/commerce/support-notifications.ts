import {DatabaseSync} from "node:sqlite";
import {existsSync} from "node:fs";
import {SupportCases} from "./support-cases.ts";

/** Queue safe support notifications for permanently invalid MP4 deliveries
 * and failed paid orders, without sending raw user media or task credentials.
 * This is a read-only inspection of provider state; not a new generation. */
export function queueFailedOutputSupportEmails(
 commerceFile:string,liveFile:string,operatorEmail="support@singmotion.ai",
):number{
 if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(operatorEmail)||!existsSync(commerceFile))return 0;
 const commerce=new DatabaseSync(commerceFile);
 commerce.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL");
 let added=0;
 try{
  new SupportCases(commerce);
  const queue=(id:string,reason:string,kind:string)=>{
   if(!/^[a-f0-9-]{36}$/i.test(id))return;
   const key="support-operator:"+kind+":"+id;
   const body=["SingMotion AI – Technical support case","",
    "Reference ID: "+id,"Issue: "+reason,
    "Inspect the exact project/order in the private Super Admin console:",
    "Open /support-admin in the same SingMotion environment.",
    "Do not automatically refund a possibly billable provider result or resubmit the same task.",
   ].join("\n");
   const changed=commerce.prepare(`INSERT OR IGNORE INTO support_case_mail_outbox
     (event_key,reference,recipient,subject,body,created_at)
     VALUES(?,?,?,?,?,?)`).run(key,id,operatorEmail,
      "SingMotion AI Support – "+id.slice(0,8).toUpperCase(),body,Date.now());
   added+=changed.changes;
  };
  if(existsSync(liveFile)){
   const live=new DatabaseSync(liveFile,{readOnly:true});
   try{
    const codes=["INVALID_OUTPUT","MISSING_OUTPUT","OUTPUT_STORAGE_FAILED","TEMPO_RESTORATION_FAILED",
      "OUTPUT_MP4_VALIDATION_FAILED","OUTPUT_DOWNLOAD_OR_VALIDATION_FAILED"];
    const placeholders=codes.map(()=>"?").join(",");
    const rows=live.prepare(`SELECT id,json_extract(data,'$.failureCode') code
       FROM live_attempts WHERE json_valid(data)=1 AND json_extract(data,'$.state')='failed'
       AND json_extract(data,'$.failureCode') IN (${placeholders})
       ORDER BY rowid DESC LIMIT 50`).all(...codes) as Array<{id:string;code:string}>;
    for(const row of rows)queue(row.id,"Invalid or undelivered MP4 ("+row.code+")","output");
   }finally{live.close()}
  }
  const paid=commerce.prepare(`SELECT o.id FROM customer_orders o JOIN customer_fulfillment_queue q
     ON q.order_id=o.id AND q.state='failed'
     WHERE o.status='paid' AND EXISTS(
       SELECT 1 FROM customer_provider_submissions s WHERE s.order_id=o.id)
     AND NOT EXISTS(SELECT 1 FROM customer_video_deliveries d WHERE d.order_id=o.id)
     ORDER BY o.created DESC LIMIT 50`).all() as Array<{id:string}>;
  for(const row of paid)queue(row.id,"Paid video was not delivered; provider/billing status needs inspection","paid-output");
 }finally{commerce.close()}
 return added;
}

/** Durable, bounded, idempotent customer email notifications from verified
 * refund / resolution events. Never sends private media, URLs, or credentials. */
export async function retrySupportCaseEmails(
 file:string,env:Record<string,string|undefined>=process.env,
 sender:typeof fetch=fetch,
):Promise<{attempted:number;sent:number}> {
 if(!env.RESEND_API_KEY||!env.ACCOUNT_EMAIL_FROM)return {attempted:0,sent:0};
 const db=new DatabaseSync(file);
 db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL");
 let attempted=0,sent=0;
 try{
  new SupportCases(db);
  const rows=db.prepare(`SELECT event_key,recipient,subject,body FROM support_case_mail_outbox
    WHERE sent_at IS NULL AND (last_attempt_at IS NULL OR last_attempt_at<=?)
    ORDER BY created_at,event_key LIMIT 4`).all(Date.now()-60_000) as Array<{
      event_key:string;recipient:string;subject:string;body:string}>;
  for(const row of rows){
   const updated=db.prepare(`UPDATE support_case_mail_outbox
     SET last_attempt_at=?,attempt_count=attempt_count+1
     WHERE event_key=? AND sent_at IS NULL AND (last_attempt_at IS NULL OR last_attempt_at<=?)`)
     .run(Date.now(),row.event_key,Date.now()-60_000);
   if(updated.changes!==1)continue;
   attempted++;
   try{
    const reply=await sender("https://api.resend.com/emails",{
     method:"POST",headers:{
       Authorization:"Bearer "+env.RESEND_API_KEY,
       "Content-Type":"application/json",
       "Idempotency-Key":row.event_key,
     },
     body:JSON.stringify({
       from:env.ACCOUNT_EMAIL_FROM,to:[row.recipient],
       subject:row.subject,text:row.body,
     }),
     cache:"no-store",signal:AbortSignal.timeout(10000),
    });
    if(reply.ok){
      db.prepare("UPDATE support_case_mail_outbox SET sent_at=? WHERE event_key=? AND sent_at IS NULL")
       .run(Date.now(),row.event_key);
      sent++;
    }
   }catch{/* persist for next retry; no paid API involved */}
  }
 }finally{db.close()}
 return {attempted,sent};
}
