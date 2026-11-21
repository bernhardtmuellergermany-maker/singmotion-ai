/** Durable, idempotent receipt after verified completion of account erasure.
 * Temporary email address is discarded immediately after Resend accepts it.
 */
import {DatabaseSync} from "node:sqlite";
import {existsSync} from "node:fs";
import {createHash} from "node:crypto";
type Env=Record<string,string|undefined>;
export function ensureCustomerErasureCompletionEmail(db:DatabaseSync){
 db.exec(`CREATE TABLE IF NOT EXISTS customer_erasure_completion_emails(
  account_id TEXT PRIMARY KEY,recipient TEXT,created_at INTEGER NOT NULL,
  last_attempt_at INTEGER,attempts INTEGER NOT NULL DEFAULT 0,sent_at INTEGER)`);
}
/** Call inside the transaction inserting the frozen erasure job. */
export function queueCustomerErasureCompletionEmail(db:DatabaseSync,accountId:string,email:string){
 if(!/^[a-f0-9-]{36}$/i.test(accountId)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  throw Error("Invalid completion email recipient");
 ensureCustomerErasureCompletionEmail(db);
 db.prepare("INSERT OR IGNORE INTO customer_erasure_completion_emails(account_id,recipient,created_at) VALUES(?,?,?)")
  .run(accountId,email,Date.now());
}
export async function retryCustomerErasureCompletionEmails(
 file:string,env:Env=process.env,sender:typeof fetch=fetch
):Promise<{attempted:number;sent:number}>{
 const result={attempted:0,sent:0};
 if(!existsSync(file)||!env.RESEND_API_KEY||!env.ACCOUNT_EMAIL_FROM)return result;
 const db=new DatabaseSync(file);
 db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL");
 try{
  ensureCustomerErasureCompletionEmail(db);
  const entries=db.prepare(`SELECT m.account_id AS accountId,m.recipient
   FROM customer_erasure_completion_emails m
   JOIN customer_erasure_jobs j ON j.account_id=m.account_id
   WHERE j.state='completed' AND m.sent_at IS NULL AND m.recipient IS NOT NULL
     AND (m.last_attempt_at IS NULL OR m.last_attempt_at<=?)
   ORDER BY j.completed_at,m.created_at LIMIT 4`).all(Date.now()-60_000)
   as {accountId:string;recipient:string}[];
  const intentsExist=!!db.prepare(
   "SELECT 1 FROM sqlite_master WHERE type='table' AND name='customer_erasure_refund_intents'").get();
  for(const entry of entries){
   const state=db.prepare("SELECT state FROM customer_erasure_jobs WHERE account_id=?")
    .get(entry.accountId) as {state:string}|undefined;
   if(state?.state!=="completed")continue;
   const total=intentsExist?(db.prepare(
    "SELECT COALESCE(SUM(cents),0) AS cents FROM customer_erasure_refund_intents WHERE account_id=? AND state='succeeded'"
   ).get(entry.accountId) as {cents:number}).cents:0;
   if(!Number.isSafeInteger(total)||total<0)continue;
   const payment=total>0?
    "Ihre bestätigte Rückzahlung für nicht verbrauchte gekaufte Credits beträgt "+
     (total/100).toLocaleString("de-DE",{style:"currency",currency:"EUR"})+
     ". Der Zahlungsanbieter hat die Erstattung auf Ihr ursprüngliches Zahlungsmittel bestätigt. Die Gutschrift kann je nach Bank etwas dauern.":
    "Es wurden keine erstattungsfähigen gekauften Credits festgestellt. Deshalb war keine Rückzahlung erforderlich.";
   const body=[
    "Guten Tag,","",
    "vielen Dank, dass Sie SingMotion AI genutzt haben.",
    "Ihr Kundenkonto wurde erfolgreich gelöscht. Ihre aktiven privaten Projekte und Dateien wurden entfernt.","",
    payment,"",
    "Gesetzlich vorgeschriebene, minimierte Zahlungsbelege und befristete Sicherungskopien unterliegen ihren jeweiligen Aufbewahrungsfristen.","",
    "Bei Fragen schreiben Sie an support@singmotion.ai.","",
    "Vielen Dank und alles Gute!","Ihr SingMotion AI Team",
   ].join("\n");
   const idempotency="sm-erasure-complete-v1-"+createHash("sha256").update(entry.accountId).digest("hex");
   result.attempted++;
   db.prepare("UPDATE customer_erasure_completion_emails SET last_attempt_at=?,attempts=attempts+1 WHERE account_id=? AND sent_at IS NULL")
    .run(Date.now(),entry.accountId);
   try{
    const response=await sender("https://api.resend.com/emails",{
     method:"POST",headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,
      "Content-Type":"application/json","Idempotency-Key":idempotency},
     body:JSON.stringify({from:env.ACCOUNT_EMAIL_FROM,to:[entry.recipient],
      subject:"Bestätigung Ihrer Kontolöschung – SingMotion AI",text:body}),
     cache:"no-store",signal:AbortSignal.timeout(10000),
    });
    if(response.ok){
     db.prepare("UPDATE customer_erasure_completion_emails SET recipient=NULL,sent_at=? WHERE account_id=? AND sent_at IS NULL")
      .run(Date.now(),entry.accountId);
     result.sent++;
    }
   }catch{/* Retry safely; no confirmed send and no refund side effects. */}
  }
  return result;
 }finally{db.close()}
}
