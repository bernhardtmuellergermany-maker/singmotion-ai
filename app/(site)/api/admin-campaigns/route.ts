import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {getPayload} from "payload";
import config from "@payload-config";
import {hasRole} from "@/cms/policy";
import {cmsOriginFailure} from "@/cms/request-security";
import {limit,dataDir} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";
import {CommerceStore} from "@/lib/commerce/store";
import {CampaignPricing,CampaignError,campaignsEnabled,type Campaign} from "@/lib/commerce/campaign-pricing";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store","Vary":"Cookie","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers});
async function authorized(req:NextRequest){
 if(process.env.CMS_ENABLED!=="true")return null;
 const payload=await getPayload({config});
 const {user}=await payload.auth({headers:req.headers});
 if(!hasRole(user,["super-admin"]))return null;
 const actor=String(user?.id||"");
 return /^[A-Za-z0-9_-]{1,100}$/.test(actor)?{actor,payload}:null;
}
export async function GET(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 try{
  const auth=await authorized(req);
  if(!auth)return json({error:"Super Admin required"},403);
  limit("admin-campaigns-read:"+auth.actor,90,60000);
  if(!campaignsEnabled(process.env))return json({enabled:false,campaigns:[],tariff:null});
  const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
  try{
   const pricing=new CampaignPricing(store.db),campaigns=pricing.list();
   const id=req.nextUrl.searchParams.get("id");
   if(id){
    const found=pricing.byId(id);
    if(!found)return json({error:"Campaign not found"},404);
    return json({enabled:true,campaign:found,versions:pricing.versions(id),stats:pricing.stats(id)});
   }
   return json({enabled:true,campaigns,tariff:pricing.active()});
  }finally{store.close()}
 }catch(e){
  if(e instanceof CampaignError)return json({error:e.message},e.status);
  return json({error:"Kampagnenverwaltung vorübergehend nicht verfügbar."},503);
 }
}
export async function POST(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 try{
  const auth=await authorized(req);
  if(!auth)return json({error:"Super Admin required"},403);
  if(!campaignsEnabled(process.env))return json({error:"Kampagnen sind in dieser Umgebung deaktiviert."},403);
  if(cmsOriginFailure(req.method,req.headers,process.env.CMS_ORIGIN))
   return json({error:"Exact CMS Origin required"},403);
  limit("admin-campaigns-write:"+auth.actor,20,60000);
  if(!req.headers.get("content-type")?.startsWith("application/json"))
   return json({error:"JSON required"},415);
  if(Number(req.headers.get("content-length"))>8192)return json({error:"Request too large"},413);
  const raw=await req.text();
  if(Buffer.byteLength(raw,"utf8")>8192)return json({error:"Request too large"},413);
  let data:{action?:unknown;campaign?:unknown;id?:unknown;expectedRevision?:unknown};
  try{data=JSON.parse(raw)}catch{return json({error:"Invalid JSON"},400)}
  if(!["save","duplicate","archive","pause"].includes(String(data.action)))
   return json({error:"Unsupported action"},400);
  const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
  try{
   const pricing=new CampaignPricing(store.db);
   let item:Campaign;
   if(data.action==="save"){
    if(!data.campaign||typeof data.campaign!=="object"||Array.isArray(data.campaign))
     return json({error:"Campaign object required"},400);
    const input=data.campaign as Campaign;
    item=pricing.save(input,auth.actor,input.id?Number(data.expectedRevision):undefined);
   }else{
    if(typeof data.id!=="string")return json({error:"Campaign ID required"},400);
    const original=pricing.byId(data.id);
    if(!original)return json({error:"Campaign not found"},404);
    if(original.revision!==data.expectedRevision)
     return json({error:"Kampagne wurde inzwischen geändert. Bitte neu laden."},409);
    if(data.action==="duplicate"){
     const {id:ignoredId,revision:ignoredRev,...rest}=original;
     item=pricing.save({...rest,identifier:original.identifier+"-copy-"+Date.now().toString(36),
      status:"draft"},auth.actor);
    }else{
     item=pricing.save({...original,status:data.action==="archive"?"archived":"paused"},
      auth.actor,original.revision);
    }
   }
   // A commerce-audit row was committed with the campaign revision.
   try{await auth.payload.create({collection:"audit-events",overrideAccess:true,data:{
    actor:auth.actor,action:"campaign:"+data.action,resource:"marketing-campaign",record:item.id+":"+item.revision,
   }})}catch{console.error("Secondary CMS campaign audit unavailable; commerce audit retained")}
   return json({campaign:item});
  }finally{store.close()}
 }catch(e){
  if(e instanceof CampaignError)return json({error:e.message},e.status);
  return json({error:"Kampagne nicht gespeichert. Den Änderungsverlauf prüfen."},503);
 }
}
