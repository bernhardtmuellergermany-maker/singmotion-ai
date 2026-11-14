/** Durable completion mail outbox. No BytePlus calls, no guest capability
 * or raw provider reference is ever emailed. Dispatch only after validated
 * local/R2 video delivery and committed paid fulfillment. */
import {DatabaseSync} from "node:sqlite";
import path from "node:path";
import {stat} from "node:fs/promises";
import {shouldSendCustomerVideoReadyEmail} from "./customer-email-preferences.ts";
import {sendRightsEmail} from "./consumer-rights.ts";
import {customerIdentityOrigin} from "../customer-identity-origin.ts";

export function ensureVideoReadyOutbox(db:DatabaseSync){
 db.exec(`CREATE TABLE IF NOT EXISTS customer_video_ready_outbox(
  order_id TEXT PRIMARY KEY,
  sent_at INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  created_at INTEGER NOT NULL,
  suppressed_at INTEGER)`);
 const columns=db.prepare("PRAGMA table_info(customer_video_ready_outbox)").all() as {name:string}[];
 if(!columns.some(col=>col.name==="suppressed_at"))db.exec("ALTER TABLE customer_video_ready_outbox ADD COLUMN suppressed_at INTEGER");
}
export function videoReference(orderId:string):string{
 if(!/^[a-f0-9-]{36}$/.test(orderId))throw Error("Invalid video reference");
 return "VID-"+orderId.slice(0,8).toUpperCase();
}
export function orderReference(orderId:string):string{
 if(!/^[a-f0-9-]{36}$/.test(orderId))throw Error("Invalid order reference");
 return "SM-"+orderId.toUpperCase();
}
export function videoReadyEmailText(orderId:string,origin:string,guest:boolean):string{
 const ref=orderReference(orderId),vid=videoReference(orderId);
 return [
  "Dein SingMotion AI Musikvideo ist fertig!","",
  "Deine bezahlte Videoproduktion wurde geprüft und sicher gespeichert.",
  "Auftragsnummer: "+ref,
  "Videonummer: "+vid,
  "Privater Bestellbereich: "+origin+"/orders/"+orderId,
  "",
  guest
   ? "Ohne Kundenkonto: Öffne den Bestellbereich im ursprünglichen Browser über deinen privaten Bestelllink. Auf einem neuen Gerät kannst du dort einen einmaligen E-Mail-Zugangscode anfordern."
   : "Melde dich mit deinem Kundenkonto an, um dein Video anzusehen oder herunterzuladen.",
  guest
   ? "Erstellst du später ein Konto mit dieser bestätigten E-Mail-Adresse, kannst du dein Gastvideo dort mit einem verifizierten privaten Bestellzugang unter „Gastvideo übernehmen“ hinzufügen."
   : "Das Video bleibt in deinem persönlichen Bestellbereich verfügbar, solange die angegebene Speicherfrist gilt.",
  "",
  "Die Auftrags- oder Videonummer allein berechtigt NICHT zum Zugriff. Teile geheime Bestelllinks und Zugangscodes nicht mit anderen.",
  "Bei Fragen: support@singmotion.ai",
 ].join("\n");
}

/** Idempotent periodic worker path; no email before a delivered paid receipt.
 * Failed Resend calls stay queued. The provider idempotency key is stable so
 * a network timeout does not intentionally create a second notification. */
export async function retryVideoReadyNotifications(
 file:string,
 env:Record<string,string|undefined>=process.env,
 sender:typeof fetch=fetch,
):Promise<{attempted:number;sent:number}>{
 if(!env.RESEND_API_KEY||!env.ACCOUNT_EMAIL_FROM)return {attempted:0,sent:0};
 const origin=customerIdentityOrigin(env);
 if(!origin)return {attempted:0,sent:0};
 const db=new DatabaseSync(file);
 db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL");
 let attempted=0,sent=0;
 try{
  ensureVideoReadyOutbox(db);
  db.exec(`INSERT OR IGNORE INTO customer_video_ready_outbox(order_id,created_at)
   SELECT o.id,CAST(strftime('%s','now') AS INTEGER)*1000
   FROM customer_orders o
   JOIN customer_fulfillment_queue q ON q.order_id=o.id AND q.state='delivered'
   JOIN customer_video_deliveries d ON d.order_id=o.id
   WHERE o.status='paid'`);
  const rows=db.prepare(`SELECT n.order_id,o.email,o.account_id,o.created AS order_created
   FROM customer_video_ready_outbox n
   JOIN customer_orders o ON o.id=n.order_id AND o.status='paid'
   JOIN customer_fulfillment_queue q ON q.order_id=n.order_id AND q.state='delivered'
   JOIN customer_video_deliveries d ON d.order_id=n.order_id
   WHERE n.sent_at IS NULL AND n.suppressed_at IS NULL AND
     (n.last_attempt_at IS NULL OR n.last_attempt_at<=?)
   ORDER BY n.created_at,n.order_id LIMIT 3`)
   .all(Date.now()-60_000) as Array<{order_id:string;email:string;account_id:string|null;order_created:number}>;
  for(const row of rows){
   const claimed=db.prepare(`UPDATE customer_video_ready_outbox
     SET attempt_count=attempt_count+1,last_attempt_at=?
     WHERE order_id=? AND sent_at IS NULL AND
       (last_attempt_at IS NULL OR last_attempt_at<=?)`)
    .run(Date.now(),row.order_id,Date.now()-60_000);
   if(claimed.changes!==1)continue;
   attempted++;
   // Email contains no secret token, provider URL or private filename.
   const mail={from:env.ACCOUNT_EMAIL_FROM,to:[row.email],
    subject:"SingMotion AI – Dein Musikvideo ist fertig ("+videoReference(row.order_id)+")",
    text:videoReadyEmailText(row.order_id,origin,!row.account_id)};
   try{
    const response=await sender("https://api.resend.com/emails",{
     method:"POST",
     headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json",
      "Idempotency-Key":"video-ready-"+row.order_id},
     body:JSON.stringify(mail),signal:AbortSignal.timeout(10000),cache:"no-store",
    });
    if(response.ok){
     db.prepare("UPDATE customer_video_ready_outbox SET sent_at=? WHERE order_id=? AND sent_at IS NULL")
      .run(Date.now(),row.order_id);
     sent++;
    }
   }catch{/* keep durable retry; never resubmit BytePlus */}
  }
 }finally{db.close()}
 return {attempted,sent};
}

/** Customer credit Studio videos use a different provider lifecycle from
 * legacy directly paid orders. Poll only delivered, validated MP4s; this
 * background mail outbox never starts a provider job or changes Credits.
 */
export async function retryStudioCreditVideoReadyNotifications(
 root:string,
 env:Record<string,string|undefined>=process.env,
 sender:typeof fetch=fetch
):Promise<{attempted:number;sent:number;suppressed:number}>{
 const result={attempted:0,sent:0,suppressed:0};
 if(!env.RESEND_API_KEY||!env.ACCOUNT_EMAIL_FROM)return result;
 const origin=customerIdentityOrigin(env);if(!origin)return result;
 const commerce=new DatabaseSync(path.join(root,"commerce.sqlite"));
 const live=new DatabaseSync(path.join(root,"live-test.sqlite"));
 commerce.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;");
 live.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;");
 try{
  commerce.exec(`CREATE TABLE IF NOT EXISTS customer_studio_video_ready_outbox(
    attempt_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    completed_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    sent_at INTEGER,
    suppressed_at INTEGER,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_attempt_at INTEGER
  )`);
  const rows=live.prepare(`SELECT a.id,a.data,p.owner
   FROM live_attempts a JOIN live_studio_projects p ON p.attempt_id=a.id
   WHERE p.owner LIKE 'customer-%'
   AND json_extract(a.data,'$.state')='completed'
   AND json_extract(a.data,'$.outputPath') IS NOT NULL
   ORDER BY a.rowid DESC LIMIT 100`).all() as Array<{id:string;data:string;owner:string}>;
  const accounts=commerce.prepare("SELECT email FROM customer_accounts WHERE id=?");
  for(const row of rows){
   if(!/^customer-[a-f0-9-]{36}$/.test(row.owner))continue;
   let parsed:{updatedAt?:number;outputPath?:string;state?:string};
   try{parsed=JSON.parse(row.data)}catch{continue}
   const output=parsed.outputPath;
   if(parsed.state!=="completed"||typeof output!=="string")continue;
   const relative=path.relative(path.join(root,"live-output"),output);
   if(relative.startsWith("..")||path.isAbsolute(relative)||!relative)continue;
   const file=await stat(output).catch(()=>null);
   if(!file?.isFile())continue;
   const accountId=row.owner.slice("customer-".length);
   if(!accounts.get(accountId))continue;
   const completedAt=Number(parsed.updatedAt)||Date.now();
   commerce.prepare(`INSERT OR IGNORE INTO customer_studio_video_ready_outbox
    (attempt_id,account_id,completed_at,created_at)
    VALUES(?,?,?,?)`).run(row.id,accountId,completedAt,Date.now());
  }
  const pending=commerce.prepare(`SELECT n.attempt_id,n.account_id,n.completed_at,a.email
   FROM customer_studio_video_ready_outbox n
   JOIN customer_accounts a ON a.id=n.account_id
   WHERE n.sent_at IS NULL AND n.suppressed_at IS NULL
     AND (n.last_attempt_at IS NULL OR n.last_attempt_at<=?)
   ORDER BY n.created_at,n.attempt_id LIMIT 3`)
    .all(Date.now()-60_000) as Array<{attempt_id:string;account_id:string;completed_at:number;email:string}>;
  for(const entry of pending){
   const claimed=commerce.prepare(`UPDATE customer_studio_video_ready_outbox
    SET attempt_count=attempt_count+1,last_attempt_at=?
    WHERE attempt_id=? AND sent_at IS NULL AND suppressed_at IS NULL
    AND (last_attempt_at IS NULL OR last_attempt_at<=?)`)
    .run(Date.now(),entry.attempt_id,Date.now()-60_000);
   if(claimed.changes!==1)continue;
   if(!shouldSendCustomerVideoReadyEmail(commerce,entry.account_id,entry.completed_at)){
    commerce.prepare("UPDATE customer_studio_video_ready_outbox SET suppressed_at=? WHERE attempt_id=? AND sent_at IS NULL")
      .run(Date.now(),entry.attempt_id);
    result.suppressed++;continue;
   }
   result.attempted++;
   // No private R2 URLs, raw provider IDs, tokens or customer file names.
   const mail={
    from:env.ACCOUNT_EMAIL_FROM,to:[entry.email],
    subject:"SingMotion AI – Dein Musikvideo ist fertig",
    text:["Dein SingMotion AI Musikvideo ist fertig!","",
      "Öffne deinen persönlichen Projektbereich, um dein Video anzusehen oder herunterzuladen:",
      origin+"/projects/live_"+entry.attempt_id,"",
      "Melde dich dazu mit deinem SingMotion AI Kundenkonto an.",
      "Du kannst diese E-Mails unter Account Settings → Email notifications deaktivieren.",
      "Bei Fragen: support@singmotion.ai"].join("\n")
   };
   try{
    const response=await sender("https://api.resend.com/emails",{
     method:"POST",headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,
      "Content-Type":"application/json","Idempotency-Key":"studio-video-ready-"+entry.attempt_id},
     body:JSON.stringify(mail),signal:AbortSignal.timeout(10000),cache:"no-store"
    });
    if(response.ok){
     commerce.prepare("UPDATE customer_studio_video_ready_outbox SET sent_at=? WHERE attempt_id=? AND sent_at IS NULL")
      .run(Date.now(),entry.attempt_id);
     result.sent++;
    }
   }catch{/* Persisted retry; never repeat BytePlus generation. */}
  }
 }finally{live.close();commerce.close()}
 return result;
}
