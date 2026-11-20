import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {getPayload} from "payload";
import config from "@payload-config";
import {hasRole} from "@/cms/policy";
import {cmsOriginFailure} from "@/cms/request-security";
import {stagingDenial} from "@/lib/staging";
import {limit,dataDir} from "@/lib/db";
import {CommerceStore} from "@/lib/commerce/store";
import {ManualCreditGifts,GiftError,manualGiftEnabled,type GiftReason} from "@/lib/commerce/manual-credit-gifts";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store","Vary":"Cookie",
 "X-Content-Type-Options":"nosniff","X-Robots-Tag":"noindex, nofollow","Referrer-Policy":"no-referrer"};
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers});
async function authorize(req:NextRequest){
 if(process.env.CMS_ENABLED!=="true")return null;
 const payload=await getPayload({config});
 const {user}=await payload.auth({headers:req.headers});
 if(!hasRole(user,["super-admin"]))return null;
 const actor=String(user?.id??"");
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(actor))return null;
 return {payload,actor};
}
export async function GET(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 try{
  const auth=await authorize(req);
  if(!auth)return reply({error:"Super Admin required"},403);
  limit("manual-credit-gifts-read:"+auth.actor,60,60000);
  const enabled=manualGiftEnabled(process.env);
  if(!enabled)return reply({enabled:false,gifts:[],summary:{count:0,credits:0,referenceValueCents:0}});
  const id=req.nextUrl.searchParams.get("customerId")||undefined;
  const csv=req.nextUrl.searchParams.get("format")==="csv";
  const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
  try{
   const gifts=new ManualCreditGifts(store.db,process.env);
   const rows=gifts.list(id,csv?5000:100);
   if(csv){
    // No email address, note or payment information in this export.
    const text=["booking_id,customer_id,credits,reason,campaign_id,actor_id,created_utc,reversed_at_utc",
     ...rows.map(g=>[g.id,g.customerId,g.credits,g.reason,g.campaignId||"",g.actor,
      new Date(g.created).toISOString(),g.reversedAt?new Date(g.reversedAt).toISOString():""].join(","))].join("\n");
    return new Response(text,{status:200,headers:{...headers,"Content-Type":"text/csv; charset=utf-8",
     "Content-Disposition":'attachment; filename="singmotion-manual-gifts.csv"'}});
   }
   return reply({enabled:true,gifts:rows,summary:gifts.summary(),limits:gifts.limits()});
  }finally{store.close()}
 }catch(e){
  if(e instanceof GiftError)return reply({error:e.message},e.status);
  return reply({error:"Credit gift history unavailable"},503);
 }
}
export async function POST(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 try{
  const auth=await authorize(req);
  if(!auth)return reply({error:"Super Admin required"},403);
  if(!manualGiftEnabled(process.env))return reply({error:"Administrative gifts are disabled in this environment."},403);
  if(cmsOriginFailure("POST",req.headers,process.env.CMS_ORIGIN))
   return reply({error:"Exact CMS Origin required"},403);
  if(!req.headers.get("content-type")?.startsWith("application/json"))
   return reply({error:"JSON required"},415);
  limit("manual-credit-gifts-write:"+auth.actor,10,60000);
  if(Number(req.headers.get("content-length"))>4096)return reply({error:"Request too large"},413);
  const raw=await req.text();
  if(Buffer.byteLength(raw,"utf8")>4096)return reply({error:"Request too large"},413);
  let input:{action?:unknown;customerId?:unknown;credits?:unknown;reason?:unknown;
   note?:unknown;campaignId?:unknown;requestKey?:unknown;confirmation?:unknown;giftId?:unknown};
  try{input=JSON.parse(raw)}catch{return reply({error:"Invalid JSON"},400)}
  const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
  try{
   const gifts=new ManualCreditGifts(store.db,process.env);
   if(input.action==="grant"){
    if(typeof input.customerId!=="string"||typeof input.credits!=="number"||
     typeof input.reason!=="string"||typeof input.requestKey!=="string"||
     input.confirmation!=="GIFT "+input.credits+" "+input.customerId)
     return reply({error:"Exact credit gift confirmation required"},409);
    const result=gifts.grant({customerId:input.customerId,credits:input.credits,
     reason:input.reason as GiftReason,requestKey:input.requestKey,actor:auth.actor,
     note:typeof input.note==="string"?input.note:input.note==null?null:"invalid",
     campaignId:typeof input.campaignId==="string"?input.campaignId:input.campaignId==null?null:"invalid"});
    // The SQLite commerce audit is transactionally committed together with the grant.
    // Best-effort secondary Payload audit never changes the idempotent result.
    if(!result.replayed)try{
     await auth.payload.create({collection:"audit-events",overrideAccess:true,data:{
      actor:auth.actor,action:"manual-credit-gift",resource:"customer-credit-wallet",record:result.gift.id,
     }});
    }catch{console.error("Secondary CMS gift audit unavailable; immutable commerce audit retained")}
    return reply({gift:result.gift,availableCredits:result.availableCredits,replayed:result.replayed});
   }
   if(input.action==="correct"){
    if(typeof input.giftId!=="string"||typeof input.reason!=="string"||
       typeof input.requestKey!=="string"||input.confirmation!=="CORRECT "+input.giftId)
     return reply({error:"Explicit correction confirmation required"},409);
    const result=gifts.correct({giftId:input.giftId,reason:input.reason,
     requestKey:input.requestKey,actor:auth.actor});
    return reply(result);
   }
   return reply({error:"Unsupported action"},400);
  }finally{store.close()}
 }catch(e){
  if(e instanceof GiftError)return reply({error:e.message},e.status);
  // A server/network failure may happen after a committed response;
  // the client MUST retry with its original requestKey, never a new one.
  return reply({error:"Buchung nicht bestätigt. Dieselbe Buchungsreferenz zur Prüfung erneut senden."},503);
 }
}
