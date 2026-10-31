import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {dataDir,limit,createAccountMediaSession,revokeMediaSession} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";
import {applicationOrigin} from "@/lib/request-origin";
export const runtime="nodejs";export const dynamic="force-dynamic";
const env="dfaeabed-03df-43ed-aa71-50f343a75041";
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{"Cache-Control":"private, no-store"}});
export async function GET(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 if(process.env.RAILWAY_ENVIRONMENT_ID!==env)return json({error:"STAGING only"},403);
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try{
  const id=store.session(req.cookies.get("sm_customer")?.value||"");
  if(!id)return json({authenticated:false});
  const row=store.db.prepare("SELECT email FROM customer_accounts WHERE id=?").get(id) as {email:string}|undefined;
  return json({authenticated:!!row,email:row?.email||null});
 }finally{store.close()}
}
export async function POST(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 if(process.env.RAILWAY_ENVIRONMENT_ID!==env||process.env.CUSTOMER_ACCOUNTS_ENABLED!=="true")return json({error:"Accounts not enabled on STAGING"},503);
 const origin=applicationOrigin(req.url,req.headers.get("host"));
 if(!origin||req.headers.get("origin")!==origin)return json({error:"Invalid origin"},403);
 if(Number(req.headers.get("content-length"))>2048)return json({error:"Request too large"},413);
 const raw=await req.text();if(Buffer.byteLength(raw)>2048)return json({error:"Request too large"},413);
 let input:{action?:string;email?:string;password?:string};
 try{input=JSON.parse(raw)}catch{return json({error:"Invalid request"},400)}
 limit("customer-auth:"+req.headers.get("x-forwarded-for"),8,60000);
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try{
  if(input.action==="logout"){
   const token=req.cookies.get("sm_customer")?.value||"";
   if(token)store.logout(token);
   const response=json({authenticated:false});
   response.cookies.delete("sm_customer");
   const media=req.cookies.get("sm_session")?.value;
   if(media)revokeMediaSession(media);
   response.cookies.delete("sm_session");
   return response;
  }
  if(!["login","register"].includes(input.action||"")||typeof input.email!=="string"||typeof input.password!=="string")return json({error:"Invalid request"},400);
  if(input.action==="register")store.register(input.email,input.password);
  const token=store.login(input.email,input.password);
  const id=store.session(token);
  if(!id)throw Error("Account session unavailable");
  const media=createAccountMediaSession("customer-"+id);
  const response=json({authenticated:true,email:input.email.trim().toLowerCase(),owner:media.owner});
  for(const [name,value] of [["sm_customer",token],["sm_session",media.token]]){
   response.cookies.set(name,value,{httpOnly:true,secure:true,sameSite:"strict",path:"/",maxAge:86400});
  }
  return response;
 }catch{return json({error:input.action==="register"?"Registration failed. Check email, password length (20–256), or existing account.":"Invalid credentials"},400)}
 finally{store.close()}
}