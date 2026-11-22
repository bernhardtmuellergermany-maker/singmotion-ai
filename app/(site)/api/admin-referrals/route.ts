import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {getPayload} from "payload";
import config from "@payload-config";
import {hasRole} from "@/cms/policy";
import {cmsOriginFailure} from "@/cms/request-security";
import {stagingDenial} from "@/lib/staging";
import {dataDir,limit} from "@/lib/db";
import {CommerceStore} from "@/lib/commerce/store";
import {ReferralProgram,ReferralError,type ReferralSettings} from "@/lib/commerce/referral-program";

export const runtime="nodejs";export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store","X-Robots-Tag":"noindex, nofollow","Vary":"Cookie"};
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers});
async function admin(req:NextRequest){
 if(process.env.CMS_ENABLED!=="true")return null;
 const cms=await getPayload({config});
 const {user}=await cms.auth({headers:req.headers});
 if(!hasRole(user,["super-admin"]))return null;
 const actor=String(user?.id??"");
 return /^[A-Za-z0-9_-]{1,100}$/.test(actor)?actor:null;
}
export async function GET(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 try{
  const actor=await admin(req);if(!actor)return json({error:"Super Admin required"},403);
  limit("referral-admin-read:"+actor,60,60000);
  const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
  try{
   const referrals=new ReferralProgram(store.db);
   return json({settings:referrals.settings(),stats:referrals.adminStats()});
  }finally{store.close();}
 }catch{return json({error:"Referral administration unavailable"},503);}
}
export async function POST(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 try{
  const actor=await admin(req);if(!actor)return json({error:"Super Admin required"},403);
  if(cmsOriginFailure("POST",req.headers,process.env.CMS_ORIGIN))return json({error:"Invalid CMS origin"},403);
  if(!req.headers.get("content-type")?.startsWith("application/json"))return json({error:"JSON required"},415);
  limit("referral-admin-write:"+actor,10,60000);
  if(Number(req.headers.get("content-length"))>4096)return json({error:"Request too large"},413);
  const raw=await req.text();if(Buffer.byteLength(raw)>4096)return json({error:"Request too large"},413);
  let input:{settings?:ReferralSettings};
  try{input=JSON.parse(raw);}catch{return json({error:"Invalid JSON"},400);}
  if(!input.settings||typeof input.settings!=="object"||Array.isArray(input.settings))
   return json({error:"Settings required"},400);
  const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
  try{
   const referrals=new ReferralProgram(store.db);
   return json({settings:referrals.saveSettings(input.settings,actor),stats:referrals.adminStats()});
  }finally{store.close();}
 }catch(e){
  if(e instanceof ReferralError)return json({error:e.message},e.status);
  return json({error:"Referral configuration not saved"},503);
 }
}
