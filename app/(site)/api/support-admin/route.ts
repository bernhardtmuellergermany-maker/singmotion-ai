import {NextRequest} from "next/server";
import {getPayload} from "payload";
import config from "@payload-config";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {SupportCases,supportReference} from "@/lib/commerce/support-cases";
import {requestSupportStripeRefund} from "@/lib/commerce/support-stripe-refund";
import {retrySupportCaseEmails} from "@/lib/commerce/support-notifications";
import {adminTestOwner} from "@/cms/first-test";
import {stagingDenial} from "@/lib/staging";
import {dataDir,limit} from "@/lib/db";

export const runtime="nodejs";export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","Vary":"Cookie"};
const json=(v:unknown,s=200)=>Response.json(v,{status:s,headers});
async function authorized(req:NextRequest){
 if(process.env.CMS_ENABLED!=="true")return null;
 const payload=await getPayload({config});
 const {user}=await payload.auth({headers:req.headers});
 try{return adminTestOwner(user,req.method,req.headers,process.env);}
 catch{return null}
}
export async function GET(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 const actor=await authorized(req);
 if(!actor)return json({error:"Super Admin authorization required."},403);
 const id=req.nextUrl.searchParams.get("id");
 if(!id)return json({available:true,search:"exact order or project ID"});
 let reference:string;
 try{reference=supportReference(id)}catch{return json({error:"Enter a valid complete order/project UUID."},400)}
 const file=path.join(dataDir,"commerce.sqlite");
 const store=new CommerceStore(file);
 try{
  limit("support-search:"+actor,60,60000);
  const cases=new SupportCases(store.db);
  const result=cases.lookup(reference,path.join(dataDir,"live-test.sqlite"));
  if(!result)return json({error:"No order or project found for that ID."},404);
  // Return only the approved, redacted case projection; never raw provider
  // task IDs, media paths, bearer sessions or Stripe credentials.
  return json({case:result});
 }catch{return json({error:"Support status temporarily unavailable."},503)}
 finally{store.close()}
}
export async function POST(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 const actor=await authorized(req);
 if(!actor)return json({error:"Super Admin authorization and exact CMS origin required."},403);
 if(!req.headers.get("content-type")?.startsWith("application/json"))return json({error:"JSON request required"},415);
 if(Number(req.headers.get("content-length"))>4096)return json({error:"Request too large"},413);
 const reader=req.body?.getReader();
 if(!reader)return json({error:"Request body required"},400);
 const chunks:Uint8Array[]=[];let size=0;
 try{
  while(true){
   const part=await reader.read();
   if(part.done)break;
   size+=part.value.byteLength;
   if(size>4096){await reader.cancel();return json({error:"Request too large"},413)}
   chunks.push(part.value);
  }
 }finally{reader.releaseLock()}
 const bodyText=Buffer.concat(chunks,size).toString("utf8");
 let input:{action?:string;id?:string;reason?:string;confirmation?:string};
 try{input=JSON.parse(bodyText)}catch{return json({error:"Invalid request"},400)}
 if(typeof input.id!=="string"||typeof input.reason!=="string"||
    typeof input.confirmation!=="string")return json({error:"Missing confirmation or reason"},400);
 let reference:string;
 try{reference=supportReference(input.id)}catch{return json({error:"Invalid order or project ID"},400)}
 if(input.reason.trim().length<20||input.reason.length>1200)
  return json({error:"A specific reason of 20–1200 characters is required."},400);
 if(!["refund-credits","refund-stripe","resolve"].includes(input.action||""))
  return json({error:"Unsupported support action."},400);
 const expected=(input.action==="refund-credits"?"RETURN":input.action==="refund-stripe"?"REFUND":"RESOLVE")+" "+reference.toUpperCase();
 if(input.confirmation!==expected)return json({error:"Type the exact confirmation phrase: "+expected},409);
 const file=path.join(dataDir,"commerce.sqlite");
 let response:unknown;
 const store=new CommerceStore(file);
 try{
  limit("support-write:"+actor,8,60000);
  const cases=new SupportCases(store.db);
  if(input.action==="refund-credits"){
    response={case:cases.refundCredit(reference,actor,input.reason,path.join(dataDir,"live-test.sqlite")),
      message:"Verified failed video reservation refunded. Customer email queued if an account email is available."};
  }else if(input.action==="refund-stripe"){
    const result=await requestSupportStripeRefund(store,reference,actor,input.reason,input.confirmation);
    response={refund:result,case:cases.lookup(reference,path.join(dataDir,"live-test.sqlite")),
      message:result.status==="succeeded"?"Full Stripe refund confirmed; customer email queued.":
        "Stripe refund pending. Do not issue a second payment or refund. Automatic signed webhook will reconcile completion."};
  }else {
    response={case:cases.markResolved(reference,actor,input.reason,path.join(dataDir,"live-test.sqlite")),
      message:"Case marked resolved. Customer email queued when an account email exists."};
  }
 }catch(e){
  // Do not include Stripe/BytePlus raw response, media paths or customer data.
  const m=e instanceof Error?e.message:"Support operation unavailable.";
  const safe=/^(Refund|Invalid|Protected|Terminal|No matching|No order|Super Admin|Stripe|Paid|A specific|Existing|Order or project|Video reservation|Original|Matching|Account|Type REFUND|Refund is blocked)/.test(m);
  return json({error:safe?m:"Support operation needs reconciliation. Check the existing case before retrying."},
   safe?409:503);
 }finally{store.close()}
 // Outbox is persisted BEFORE send; mail failure never reverses a refund or
 // falsely claims delivery. The worker retries it idempotently.
 try{await retrySupportCaseEmails(file);}catch{}
 return json(response);
}
