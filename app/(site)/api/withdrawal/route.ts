import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {dataDir,limit} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";
import {applicationOrigin} from "@/lib/request-origin";
import {validateWithdrawal,recordWithdrawal,sendRightsEmail,withdrawalReceiptText} from "@/lib/commerce/consumer-rights";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{"Cache-Control":"no-store"}});
export async function POST(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 const origin=applicationOrigin(req.url,req.headers.get("host"));
 if(!origin||req.headers.get("origin")!==origin)return reply({error:"Invalid request origin."},403);
 if(Number(req.headers.get("content-length"))>3000)return reply({error:"Request too large."},413);
 let body:string;
 try{body=await req.text();if(Buffer.byteLength(body)>3000)return reply({error:"Request too large."},413);}
 catch{return reply({error:"Invalid request."},400)}
 let input;
 try{input=validateWithdrawal(JSON.parse(body));}
 catch{return reply({error:"Please check the consumer name, contract reference and confirmation email."},400)}
 const ip=req.headers.get("cf-connecting-ip")||req.headers.get("x-forwarded-for")?.split(",")[0]||"unknown";
 try{limit("withdrawal:"+ip,12,60*60*1000);}
 catch{return reply({error:"Too many requests. You can still submit your withdrawal by email to support@singmotion.ai."},429)}
 let db:DatabaseSync|undefined;
 try{
  db=new DatabaseSync(path.join(dataDir,"commerce.sqlite"));
  const receipt=recordWithdrawal(db,input);
  // The declaration is accepted at this timestamp independent of any later legal assessment.
  const customerSent=await sendRightsEmail({to:input.email,subject:"SingMotion AI – Withdrawal declaration received",text:withdrawalReceiptText(receipt)});
  if(customerSent)db.prepare("UPDATE consumer_withdrawals SET receipt_sent_at=? WHERE id=?").run(new Date().toISOString(),receipt.id);
  const operator=process.env.CONTACT_EMAIL_TO||"support@singmotion.ai";
  const operatorSent=await sendRightsEmail({to:operator,subject:"[SingMotion AI] New withdrawal declaration "+receipt.id,text:withdrawalReceiptText(receipt)});
  if(operatorSent)db.prepare("UPDATE consumer_withdrawals SET operator_notified_at=? WHERE id=?").run(new Date().toISOString(),receipt.id);
  if(!customerSent||!operatorSent)console.error("WITHDRAWAL_MAIL_PENDING",receipt.id,{customerSent,operatorSent});
  return reply({accepted:true,id:receipt.id,receivedAt:receipt.receivedAt,confirmationSent:customerSent,
   message:customerSent?"Withdrawal declaration received. An email confirmation was sent.":"Withdrawal declaration recorded. The email receipt could not be delivered yet. Please keep the reference number shown."});
 }catch{
  console.error("WITHDRAWAL_STORAGE_UNAVAILABLE");
  return reply({error:"Online submission is currently unavailable. Please email your declaration to support@singmotion.ai."},503);
 }finally{db?.close();}
}
