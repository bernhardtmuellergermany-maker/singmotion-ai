import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {dataDir,limit} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";
import {applicationOrigin} from "@/lib/request-origin";
import {customerAccountSettingsAccessible} from "@/lib/commerce/customer-live-config";
import {
 customerVideoReadyEmailPreference,updateCustomerVideoReadyEmailPreference
} from "@/lib/commerce/customer-email-preferences";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{"Cache-Control":"private, no-store","Vary":"Cookie"}});
function access(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));
 if(denied)return denied;
 if(!customerAccountSettingsAccessible(process.env))return reply({error:"Account settings unavailable."},403);
 return null;
}
export async function GET(req:NextRequest){
 const denied=access(req);if(denied)return denied;
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try{
  const accountId=store.session(req.cookies.get("sm_customer")?.value||"");
  if(!accountId)return reply({error:"Customer login required."},401);
  const pref=customerVideoReadyEmailPreference(store.db,accountId);
  return reply({videoReadyEmailEnabled:pref.enabled});
 }finally{store.close()}
}
export async function PUT(req:NextRequest){
 const denied=access(req);if(denied)return denied;
 const origin=applicationOrigin(req.url,req.headers.get("host"));
 if(!origin||req.headers.get("origin")!==origin)return reply({error:"Invalid origin."},403);
 if(Number(req.headers.get("content-length")||0)>300)return reply({error:"Request too large."},413);
 const raw=await req.text();if(Buffer.byteLength(raw)>300)return reply({error:"Request too large."},413);
 let body:unknown;
 try{body=JSON.parse(raw)}catch{return reply({error:"Invalid request."},400)}
 if(!body||typeof body!=="object"||Array.isArray(body)||
  typeof (body as {videoReadyEmailEnabled?:unknown}).videoReadyEmailEnabled!=="boolean")
  return reply({error:"Select a valid email preference."},400);
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try{
  const accountId=store.session(req.cookies.get("sm_customer")?.value||"");
  if(!accountId)return reply({error:"Customer login required."},401);
  limit(accountId+":email-pref-update",10,60000);
  const enabled=(body as {videoReadyEmailEnabled:boolean}).videoReadyEmailEnabled;
  updateCustomerVideoReadyEmailPreference(store.db,accountId,enabled);
  return reply({videoReadyEmailEnabled:enabled});
 }finally{store.close()}
}
