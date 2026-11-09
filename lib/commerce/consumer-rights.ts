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
export async function sendRightsEmail(input:{to:string;subject:string;text:string},env:NodeJS.ProcessEnv=process.env,sender:typeof fetch=fetch){
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
 return ["SingMotion AI – Eingangsbestätigung Widerruf","",
 "Wir bestätigen den Eingang deiner Widerrufserklärung, nicht deren rechtliche Wirksamkeit.",
 "Eingegangen (UTC): "+v.receivedAt,"Vorgangsnummer: "+v.id,
 "Name: "+v.name,"Vertrag / Bestellung: "+v.orderReference,
 "Bestätigungsadresse: "+v.email,"","Erklärung: Hiermit widerrufe ich den bezeichneten Vertrag.",
 "","Gesetzliche Ansprüche und die Prüfung der Rechtslage bleiben unberührt.",
 "SingMotion AI · support@singmotion.ai"].join("\n");
}
