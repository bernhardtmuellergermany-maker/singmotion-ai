import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {assessCustomerErasure,eraseEmptyCustomerAccount} from "@/lib/commerce/customer-account-erasure";
import {quoteCustomerErasureRefund} from "@/lib/commerce/customer-erasure-refund-quote";
import {beginCustomerErasure} from "@/lib/commerce/customer-erasure-job";
import {assessCustomerMediaErasure,CustomerMediaErasureBlocked} from "@/lib/commerce/customer-erasure-media";
import {dataDir,limit} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";
import {applicationOrigin} from "@/lib/request-origin";
import {customerAccountSettingsAccessible} from "@/lib/commerce/customer-live-config";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const automationEnabled=()=>process.env.CUSTOMER_AUTOMATED_ERASURE_ENABLED==="true";
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
  if(automationEnabled()){
   const quote=quoteCustomerErasureRefund(store.db,id);
   const cents=quote.refundableCents;
   return reply({eligible:quote.ready,code:quote.reason,
    refundableCents:cents,refundableCredits:quote.refundableCredits,
    message:quote.ready?
     "Delete your account yourself after entering your password. Your unused purchased Credits are estimated at €"+(cents/100).toFixed(2)+
     " and will be refunded automatically to the original payment method. All your projects and private media will then be removed. You can track progress after confirmation.":
     "Some payment or video-credit transactions are still being reconciled. Their completion must be verified before account deletion can start; no Credits will be forfeited."});
  }
  const assessment=assessCustomerErasure(store,dataDir,id);
  return reply(assessment);
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
  if(automationEnabled()){
   const quote=quoteCustomerErasureRefund(store.db,id);
   if(!quote.ready)
    return reply({eligible:false,code:quote.reason,
     message:"Your payments or Credit balance are not yet reconciled. No deletion or refund was started."},409);
   try{assessCustomerMediaErasure(dataDir,id);}
   catch(e){
    const code=e instanceof CustomerMediaErasureBlocked?e.code:"MEDIA_ERASURE_NOT_VERIFIED";
    // A provider currently processing can be allowed to finish; the async
    // erasure runner will wait without issuing a refund or removing inputs.
    if(!["ACTIVE_MEDIA_JOB","ACTIVE_PAID_PROVIDER_JOB","ACTIVE_OR_UNKNOWN_PROVIDER_JOB",
          "PROVIDER_INPUT_LEASE_ACTIVE","LIVE_PROVIDER_INPUT_LEASE_ACTIVE"].includes(code))
     return reply({eligible:false,code,
      message:"Private media cannot yet be safely removed. No account deletion or Stripe refund was started."},409);
   }
   const started=beginCustomerErasure(store,id);
   const response=reply({pending:true,state:started.job.state,
    refundableCents:quote.refundableCents,
    message:"Account deletion has been requested. Login sessions were revoked. Refund and media removal will be verified automatically before completion."},202);
   response.cookies.set("sm_erasure_status",started.token,{
    httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict",
    path:"/",maxAge:30*24*60*60
   });
   response.cookies.delete("sm_customer");
   response.cookies.delete("sm_session");
   response.cookies.delete("sm_guest_session");
   return response;
  }
  const result=eraseEmptyCustomerAccount(store,dataDir,id);
  if(!result.eligible)return reply(result,result.code==="ACCOUNT_MISSING"?404:409);
  const response=reply({deleted:true,
   message:"Your empty customer account and sessions have been removed. No purchase or media records were present. Backups follow their documented retention cycles."});
  response.cookies.delete("sm_customer");
  response.cookies.delete("sm_session");
  response.cookies.delete("sm_guest_session");
  return response;
 }catch{
  return reply({error:"Deletion could not be verified; the account was not marked as deleted. Please contact support."},503);
 }finally{store.close();}
}
