import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {quoteCustomerErasureRefund} from "@/lib/commerce/customer-erasure-refund-quote";
import {beginCustomerErasure} from "@/lib/commerce/customer-erasure-job";
import {dataDir,limit} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";
import {applicationOrigin} from "@/lib/request-origin";
import {customerAccountSettingsAccessible} from "@/lib/commerce/customer-live-config";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{
 "Cache-Control":"private, no-store","Vary":"Cookie","Referrer-Policy":"no-referrer",
 "X-Content-Type-Options":"nosniff"
}});
function access(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 if(!customerAccountSettingsAccessible(process.env))
  return reply({error:"Customer account settings are unavailable."},403);
 return null;
}
export async function GET(req:NextRequest){
 const denied=access(req);if(denied)return denied;
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try{
  const id=store.session(req.cookies.get("sm_customer")?.value||"");
  if(!id)return reply({error:"Customer sign-in required."},401);
  // Request availability is independent of a financial quote or media preflight.
  // Only the worker may issue an idempotent refund or erase confirmed assets.
  let quote:ReturnType<typeof quoteCustomerErasureRefund>|null=null;
  try{quote=quoteCustomerErasureRefund(store.db,id)}catch{/* verification can follow the request */}
  return reply({automatic:true,eligible:true,code:quote?.ready?"READY":"RECONCILIATION_PENDING",
   refundableCents:quote?.ready?quote.refundableCents:null,
   refundableCredits:quote?.ready?quote.refundableCredits:null,
   message:quote?.ready?
    "You can request account deletion now. Your unused purchased Credits are provisionally estimated at €"+
     (quote.refundableCents/100).toFixed(2)+
     ". We will verify the final refund to your original payment method before completing deletion.":
    "You can request deletion now while payments and private files are checked. Your account will be frozen immediately; the verified refund and data removal will continue afterward."});
 }catch{
  return reply({eligible:false,code:"RECORDS_REQUIRE_REVIEW",
   message:"Account deletion safety checks are temporarily unavailable. No data has been deleted."},503);
 }finally{store.close();}
}
export async function POST(req:NextRequest){
 const denied=access(req);if(denied)return denied;
 const origin=applicationOrigin(req.url,req.headers.get("host"));
 if(!origin||req.headers.get("origin")!==origin)
  return reply({error:"Invalid request origin."},403);
 if(Number(req.headers.get("content-length")||0)>600)
  return reply({error:"Request too large."},413);
 const raw=await req.text();
 if(Buffer.byteLength(raw)>600)return reply({error:"Request too large."},413);
 let body:unknown;
 try{body=JSON.parse(raw);}catch{return reply({error:"Invalid request."},400);}
 if(!body||typeof body!=="object"||Array.isArray(body))
  return reply({error:"Invalid request."},400);
 const input=body as {password?:unknown;confirmation?:unknown};
 if(input.confirmation!=="DELETE MY ACCOUNT"||
    typeof input.password!=="string"||input.password.length<1||input.password.length>256)
  return reply({error:"Enter your account password and the exact confirmation phrase."},400);
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try{
  const id=store.session(req.cookies.get("sm_customer")?.value||"");
  if(!id)return reply({error:"Customer sign-in required."},401);
  try{limit("customer-erasure:"+id,5,15*60*1000);}
  catch{return reply({error:"Too many attempts. Try again later."},429);}
  if(!store.verifyCustomerPassword(id,input.password))
   return reply({error:"Incorrect password. Google-only accounts need a verified re-authentication flow before self-service deletion."},403);
  // The customer's verified request cannot be refused because a Stripe
  // payment, provider task, or private object needs further reconciliation.
  let estimate:number|null=null;
  try{const quote=quoteCustomerErasureRefund(store.db,id);
      if(quote.ready)estimate=quote.refundableCents;}catch{/* no quote is not a refusal */}
  const started=beginCustomerErasure(store,id);
  const response=reply({pending:true,state:started.job.state,
   refundableCents:estimate,
   message:"Your deletion request was accepted. Customer login sessions are revoked. Purchased Credit refunds and private files will be independently verified before completion. We will email you after the process succeeds."},202);
  response.cookies.set("sm_erasure_status",started.token,{
   httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict",
   path:"/",maxAge:30*24*60*60
  });
  response.cookies.delete("sm_customer");
  response.cookies.delete("sm_session");
  response.cookies.delete("sm_guest_session");
  return response;
 }catch{
  return reply({error:"Deletion could not be verified; the account was not marked as deleted. Please contact support."},503);
 }finally{store.close();}
}
