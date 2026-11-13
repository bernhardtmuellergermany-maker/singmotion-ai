import {DatabaseSync} from "node:sqlite";
import {SupportCases} from "./support-cases.ts";

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
