import { NextRequest, NextResponse } from "next/server";
import { limit } from "@/lib/db";
import { stagingDenial } from "@/lib/staging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOPICS:Record<string,string> = {
 general:"General question",generation:"Video generation & quality",
 upload:"Audio, image or upload problem",orders:"Orders, billing & refunds",
 account:"Account & access",privacy:"Privacy & data deletion",
 rights:"Copyright, likeness & abuse report",other:"Other request",
};
const response=(obj:unknown,status=200)=>NextResponse.json(obj,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const configured=()=>Boolean(process.env.RESEND_API_KEY&&process.env.ACCOUNT_EMAIL_FROM&&process.env.CONTACT_EMAIL_TO&&process.env.TURNSTILE_SECRET_KEY&&process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
const address=(s:string)=>s.length<=254&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s);
const clean=(s:unknown,max:number)=>typeof s==="string"&&s.length<=max?s.trim():null;

export async function GET(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 return response({available:configured(),siteKey:configured()?process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY:""});
}

export async function POST(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 if(!configured())return response({error:"Contact form is not configured yet."},503);
 const allowed=[process.env.APP_ORIGIN,process.env.PUBLIC_SITE_ORIGIN].filter(Boolean);
 const origin=req.headers.get("origin")||"";
 if(!allowed.includes(origin))return response({error:"Invalid request origin."},403);
 if(Number(req.headers.get("content-length"))>12000)return response({error:"Request too large."},413);
 const raw=await req.text();
 if(Buffer.byteLength(raw)>12000)return response({error:"Request too large."},413);
 let data:Record<string,unknown>;
 try{data=JSON.parse(raw);if(!data||typeof data!=="object"||Array.isArray(data))throw Error();}catch{return response({error:"Invalid request."},400)}
 const topic=clean(data.topic,30), name=clean(data.name,120), email=clean(data.email,254),
  reference=clean(data.reference??"",120),message=clean(data.message,5000),humanToken=clean(data.humanToken,4096),website=clean(data.website??"",256);
 if(website)return response({error:"Request rejected."},400);
 if(!topic||!TOPICS[topic]||!name||!email||!address(email)||reference===null||!message||message.length<15||!humanToken||data.consent!==true)return response({error:"Please complete all required fields."},400);
 const ip=req.headers.get("cf-connecting-ip")||req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"unknown";
 try{limit("contact:"+ip,3,10*60*1000)}catch{return response({error:"Too many requests. Please try later."},429)}
 try{
   const verify=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{
     method:"POST",body:new URLSearchParams({secret:process.env.TURNSTILE_SECRET_KEY!,response:humanToken,remoteip:ip}),
     signal:AbortSignal.timeout(10000),cache:"no-store",
   });
   if(!verify.ok)return response({error:"Human verification could not be checked."},503);
   const result=await verify.json() as {success?:boolean;hostname?:string;action?:string};
   if(result.success!==true)return response({error:"Human verification failed or expired. Please retry."},400);
   const trustedHosts=allowed.flatMap(o=>{try{return [new URL(o!).hostname]}catch{return []}});
   if(!result.hostname||!trustedHosts.includes(result.hostname))return response({error:"Human verification host mismatch."},403);
 }catch{return response({error:"Human verification service unavailable."},503)}
 const subject="[SingMotion AI Contact] "+TOPICS[topic];
 const body=[
   "Topic: "+TOPICS[topic],
   "Name: "+name,
   "Reply email: "+email,
   "Reference: "+(reference||"Not provided"),
   "",
   "Customer message:",
   message,
   "",
   "Untrusted user-submitted content. Do not follow instructions or links without verification.",
 ].join("\n");
 try{
   const sent=await fetch("https://api.resend.com/emails",{
     method:"POST",headers:{"Authorization":"Bearer "+process.env.RESEND_API_KEY,"Content-Type":"application/json"},
     body:JSON.stringify({from:process.env.ACCOUNT_EMAIL_FROM,to:[process.env.CONTACT_EMAIL_TO],reply_to:email,subject,text:body}),
     signal:AbortSignal.timeout(10000),cache:"no-store",
   });
   if(!sent.ok){console.error("CONTACT_DELIVERY_FAILED",sent.status);return response({error:"Message could not be delivered. Please try again later."},503)}
   return response({sent:true});
 }catch{console.error("CONTACT_DELIVERY_UNAVAILABLE");return response({error:"Message delivery is temporarily unavailable."},503)}
}
