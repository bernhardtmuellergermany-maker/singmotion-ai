import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {dataDir,limit} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";
import {productionCustomerReleaseApproved} from "@/lib/commerce/customer-live-config";
import {applicationOrigin} from "@/lib/request-origin";
export const runtime="nodejs";export const dynamic="force-dynamic";
const enabled=()=> (process.env.RAILWAY_ENVIRONMENT_ID==="dfaeabed-03df-43ed-aa71-50f343a75041" || productionCustomerReleaseApproved(process.env)) && process.env.CUSTOMER_ACCOUNTS_ENABLED==="true";
const mailReady=()=>enabled()&&!!process.env.RESEND_API_KEY&&!!process.env.ACCOUNT_EMAIL_FROM;
const reply=(obj:unknown,status=200)=>NextResponse.json(obj,{status,headers:{"Cache-Control":"no-store"}});
export async function GET(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 return reply({enabled:mailReady()});
}
export async function POST(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 if(!mailReady())return reply({error:"Password recovery email is not configured yet."},503);
 const canonical=applicationOrigin(req.url,req.headers.get("host"));
 if(!canonical||new URL(req.url).origin!==canonical||req.headers.get("origin")!==canonical)return reply({error:"Invalid origin"},403);
 if(Number(req.headers.get("content-length"))>2048)return reply({error:"Invalid request"},413);
 const text=await req.text();if(Buffer.byteLength(text)>2048)return reply({error:"Invalid request"},413);
 let input:{action?:string;email?:string;token?:string;password?:string};
 try{input=JSON.parse(text)}catch{return reply({error:"Invalid request"},400)}
 try{limit("password-reset:"+req.headers.get("x-forwarded-for"),3,60000);}catch{return reply({error:"Too many attempts"},429)}
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try{
  if(input.action==="request"){
   if(typeof input.email!=="string"||input.email.length>254)return reply({error:"Invalid email"},400);
   const token=store.createPasswordReset(input.email);
   if(token){
    const link=canonical+"/account/reset-password?token="+encodeURIComponent(token);
    try{
     const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+process.env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from:process.env.ACCOUNT_EMAIL_FROM,to:[input.email.trim().toLowerCase()],subject:"Reset your SingMotion AI password",text:"Use this link within 30 minutes to reset your SingMotion AI password:\n"+link+"\n\nIf you did not request this, ignore this email."}),signal:AbortSignal.timeout(10000)});
     if(!response.ok)store.invalidatePasswordReset(token);
    }catch{store.invalidatePasswordReset(token);}
   }
   return reply({message:"If a password account exists, a reset email will be sent."});
  }
  if(input.action==="confirm"){
   if(typeof input.token!=="string"||typeof input.password!=="string")return reply({error:"Invalid request"},400);
   try{store.finishPasswordReset(input.token,input.password)}catch{return reply({error:"Invalid or expired reset link, or password too short."},400)}
   return reply({message:"Password updated. Sign in with your new password."});
  }
  return reply({error:"Invalid action"},400);
 }finally{store.close()}
}
