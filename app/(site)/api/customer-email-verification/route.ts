import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {dataDir,limit} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";
import {customerIdentityOrigin,passwordResetReady,trustedIdentityHost} from "@/lib/customer-identity-origin";
import {sendCustomerVerificationEmail} from "@/lib/commerce/verification-email";
export const runtime="nodejs";export const dynamic="force-dynamic";
const reply=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{
 "Cache-Control":"private, no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff",
}});
export async function POST(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 const origin=customerIdentityOrigin(process.env);
 if(!origin||!trustedIdentityHost(req.headers.get("host"),origin)||
    req.headers.get("origin")!==origin)return reply({error:"Invalid origin"},403);
 if(Number(req.headers.get("content-length"))>1024)return reply({error:"Request too large"},413);
 const raw=await req.text();
 if(Buffer.byteLength(raw)>1024)return reply({error:"Request too large"},413);
 let input:{action?:string;token?:string};
 try{input=JSON.parse(raw)}catch{return reply({error:"Invalid request"},400)}
 if(input.action!=="confirm"&&input.action!=="resend")return reply({error:"Invalid action"},400);
 try{limit("verify-email:"+req.headers.get("x-forwarded-for"),6,60000);}
 catch{return reply({error:"Too many requests"},429);}
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try{
  if(input.action==="confirm"){
   if(typeof input.token!=="string"||!store.verifyEmailToken(input.token))
    return reply({error:"Verification link is invalid, expired or already used"},400);
   return reply({verified:true,message:"Email confirmed. You can return to SingMotion AI."});
  }
  const accountId=store.session(req.cookies.get("sm_customer")?.value||"");
  if(!accountId)return reply({error:"Customer sign-in required"},401);
  if(store.emailVerified(accountId))return reply({verified:true,message:"Email is already verified."});
  if(!passwordResetReady(process.env))return reply({error:"Email verification is unavailable"},503);
  const pending=store.issueEmailVerification(accountId);
  if(!pending)return reply({message:"Please allow a minute between verification emails."});
  const sent=await sendCustomerVerificationEmail(pending.email,pending.token);
  if(!sent){
   store.invalidateEmailVerification(pending.token);
   // No tokens, addresses, provider details or account existence in logs.
   console.error("CUSTOMER_VERIFICATION_EMAIL_SEND_FAILED");
   return reply({error:"Verification email could not be sent. Try again later."},503);
  }
  return reply({message:"Verification email sent. Check your inbox and spam folder."});
 }finally{store.close()}
}
