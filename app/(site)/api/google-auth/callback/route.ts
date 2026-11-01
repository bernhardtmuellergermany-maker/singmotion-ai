import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {dataDir,createAccountMediaSession,session} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 const trustedOrigin="https://singmotion-ai-staging.up.railway.app";
 const clear=(response:NextResponse)=>{response.cookies.set("sm_google_oauth","",{httpOnly:true,secure:true,sameSite:"lax",path:"/api/google-auth",maxAge:0});return response;};
 const go=(reason:string)=>clear(NextResponse.redirect(trustedOrigin+"/?card=login&google_error="+encodeURIComponent(reason)));
 if(new URL(req.url).origin!==trustedOrigin)return NextResponse.json({error:"Invalid OAuth origin"},{status:403});
 if(process.env.RAILWAY_ENVIRONMENT_ID!=="dfaeabed-03df-43ed-aa71-50f343a75041"||process.env.CUSTOMER_ACCOUNTS_ENABLED!=="true"||!process.env.GOOGLE_OAUTH_CLIENT_ID||!process.env.GOOGLE_OAUTH_CLIENT_SECRET)return go("Google sign-in unavailable");
 let saved:{state:string;verifier:string;nonce:string};
 try{saved=JSON.parse(req.cookies.get("sm_google_oauth")?.value||"");}catch{return go("Sign-in session expired");}
 const state=req.nextUrl.searchParams.get("state"),code=req.nextUrl.searchParams.get("code");
 if(!saved?.state||!saved.verifier||!saved.nonce||!state||saved.state!==state||!code)return go("Google sign-in cancelled or expired");
 try{
  const redirectUri=trustedOrigin+"/api/google-auth/callback";
  const token=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({code,client_id:process.env.GOOGLE_OAUTH_CLIENT_ID,client_secret:process.env.GOOGLE_OAUTH_CLIENT_SECRET,redirect_uri:redirectUri,grant_type:"authorization_code",code_verifier:saved.verifier}),cache:"no-store"});
  if(!token.ok)return go("Google sign-in failed");
  const tokens=await token.json() as {id_token?:string};
  if(!tokens.id_token)return go("Google identity missing");
  const verify=await fetch("https://oauth2.googleapis.com/tokeninfo?id_token="+encodeURIComponent(tokens.id_token),{cache:"no-store"});
  if(!verify.ok)return go("Google identity verification failed");
  const identity=await verify.json() as {aud?:string;iss?:string;sub?:string;nonce?:string;email?:string;email_verified?:string;exp?:string};
  if(identity.aud!==process.env.GOOGLE_OAUTH_CLIENT_ID||!["accounts.google.com","https://accounts.google.com"].includes(identity.iss||"")||identity.nonce!==saved.nonce||identity.email_verified!=="true"||!identity.sub||!identity.email||Number(identity.exp)*1000<Date.now())return go("Google identity verification failed");
  const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
  let account:{id:string;token:string};
  try{account=store.googleLogin(identity.sub,identity.email);}finally{store.close();}
  const media=createAccountMediaSession("customer-"+account.id);
  const old=req.cookies.get("sm_session")?.value;
  const owner=old?session(old)?.owner:null;
  const response=clear(NextResponse.redirect(trustedOrigin+"/?card=login"));
  if(old&&owner&&!owner.startsWith("customer-")&&!owner.startsWith("cms-staff-"))response.cookies.set("sm_guest_session",old,{httpOnly:true,secure:true,sameSite:"strict",path:"/",maxAge:30*86400});
  response.cookies.set("sm_customer",account.token,{httpOnly:true,secure:true,sameSite:"strict",path:"/",maxAge:86400});
  response.cookies.set("sm_session",media.token,{httpOnly:true,secure:true,sameSite:"strict",path:"/",maxAge:86400});
  return response;
 }catch{return go("Google sign-in failed. Existing email accounts must use their password.");}
}
