import {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";

export type WithdrawalDeclaration={name:string;orderReference:string;email:string};
export const validConsumerEmail=(s:string)=>s.length<=254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s);
export function validateWithdrawal(value:unknown):WithdrawalDeclaration {
 if(!value||typeof value!=="object"||Array.isArray(value))throw Error("Invalid declaration");
 const v=value as Record<string,unknown>;
 const name=typeof v.name==="string"?v.name.trim():"";
 const orderReference=typeof v.orderReference==="string"?v.orderReference.trim():"";
 const email=typeof v.email==="string"?v.email.trim().toLowerCase():"";
 if(name.length<2||name.length>150||orderReference.length<2||orderReference.length>150||
    !validConsumerEmail(email)||/[\r\n]/.test(name+orderReference+email))
   throw Error("Name, contract reference and confirmation email required");
 return {name,orderReference,email};
}
export function ensureWithdrawalTable(db:DatabaseSync){
 db.exec(`CREATE TABLE IF NOT EXISTS consumer_withdrawals(
 id TEXT PRIMARY KEY,name TEXT NOT NULL,order_reference TEXT NOT NULL,
 email TEXT NOT NULL,received_at TEXT NOT NULL,receipt_sent_at TEXT,
 operator_notified_at TEXT)`);
}
export function recordWithdrawal(db:DatabaseSync,v:WithdrawalDeclaration){
 ensureWithdrawalTable(db);
 const id=randomUUID(),receivedAt=new Date().toISOString();
 db.prepare("INSERT INTO consumer_withdrawals(id,name,order_reference,email,received_at) VALUES(?,?,?,?,?)")
   .run(id,v.name,v.orderReference,v.email,receivedAt);
 return {id,receivedAt,...v};
}
export async function sendRightsEmail(input:{to:string;subject:string;text:string},env:Record<string,string|undefined>=process.env,sender:typeof fetch=fetch){
 if(!env.RESEND_API_KEY||!env.ACCOUNT_EMAIL_FROM)return false;
 try {
  const result=await sender("https://api.resend.com/emails",{
   method:"POST",headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},
   body:JSON.stringify({from:env.ACCOUNT_EMAIL_FROM,to:[input.to],subject:input.subject,text:input.text}),
   cache:"no-store",signal:AbortSignal.timeout(10000),
  });
  return result.ok;
 }catch{return false;}
}
export function withdrawalReceiptText(v:WithdrawalDeclaration & {id:string;receivedAt:string}){
 return ["SingMotion AI – Withdrawal receipt","",
 "We confirm receipt of your withdrawal declaration, not whether it is legally effective.",
 "Received (UTC): "+v.receivedAt,"Reference: "+v.id,
 "Name: "+v.name,"Contract / order: "+v.orderReference,
 "Confirmation address: "+v.email,"","Declaration: I withdraw from the identified contract.",
 "","Statutory rights and a review of the applicable legal position remain unaffected.",
 "SingMotion AI · support@singmotion.ai"].join("\n");
}

/** Durable email outbox retry. Run periodically from the existing worker.
 * Never changes the original acceptance timestamp or resolves legal validity. */
export async function retryPendingWithdrawalReceipts(file:string,env:Record<string,string|undefined>=process.env,sender:typeof fetch=fetch){
 if(!env.RESEND_API_KEY||!env.ACCOUNT_EMAIL_FROM)return {attempted:0,sent:0};
 const db=new DatabaseSync(file);
 db.exec("PRAGMA busy_timeout=5000");
 let attempted=0,sent=0;
 try{
  ensureWithdrawalTable(db);
  const entries=db.prepare(`SELECT id,name,order_reference,email,received_at,receipt_sent_at,operator_notified_at
   FROM consumer_withdrawals
   WHERE receipt_sent_at IS NULL OR operator_notified_at IS NULL
   ORDER BY received_at ASC LIMIT 3`).all() as Array<{
    id:string;name:string;order_reference:string;email:string;received_at:string;
    receipt_sent_at:string|null;operator_notified_at:string|null;
   }>;
  for(const row of entries){
   const receipt={id:row.id,name:row.name,orderReference:row.order_reference,
    email:row.email,receivedAt:row.received_at};
   attempted++;
   const body=withdrawalReceiptText(receipt);
   if(!row.receipt_sent_at){
    const ok=await sendRightsEmail({to:row.email,subject:"SingMotion AI – Withdrawal declaration received",text:body},env,sender);
    if(ok){db.prepare("UPDATE consumer_withdrawals SET receipt_sent_at=? WHERE id=? AND receipt_sent_at IS NULL").run(new Date().toISOString(),row.id);sent++;}
   }
   if(!row.operator_notified_at){
    const to=env.CONTACT_EMAIL_TO||"support@singmotion.ai";
    const ok=await sendRightsEmail({to,subject:"[SingMotion AI] New withdrawal declaration "+row.id,text:body},env,sender);
    if(ok)db.prepare("UPDATE consumer_withdrawals SET operator_notified_at=? WHERE id=? AND operator_notified_at IS NULL").run(new Date().toISOString(),row.id);
   }
  }
 }finally{db.close();}
 return {attempted,sent};
}
