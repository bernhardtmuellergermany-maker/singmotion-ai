import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {dataDir,createAccountMediaSession,session,revokeMediaSession} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";
import {customerIdentityOrigin,googleLoginReady,trustedIdentityHost} from "@/lib/customer-identity-origin";
import {parseStudioAccountReturn,parseAccountReturn} from "@/lib/studio-account-handoff";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 const trustedOrigin=customerIdentityOrigin(process.env);
 if(!trustedOrigin||!trustedIdentityHost(req.headers.get("host"),trustedOrigin))return NextResponse.json({error:"Invalid OAuth origin"},{status:403});
 const clear=(response:NextResponse)=>{response.cookies.set("sm_google_oauth","",{httpOnly:true,secure:true,sameSite:"lax",path:"/api/google-auth",maxAge:0});return response;};
 let savedReturn:string|null=null;
 const go=(reason:string)=>{
  // Redirect directly to the login page. The legacy /?card=login route
  // redirects to /login without preserving query parameters, which used to
  // silently discard Google OAuth errors and leave customers with no feedback.
  const target=savedReturn?"/login?returnTo="+encodeURIComponent(savedReturn):"/login";
  const sep=target.includes("?")?"&":"?";
  return clear(NextResponse.redirect(trustedOrigin+target+sep+"google_error="+encodeURIComponent(reason)));
 };
 if(!googleLoginReady(process.env))return go("Google sign-in unavailable");
 let saved:{state:string;verifier:string;nonce:string;returnTo?:string;guestToken?:string};
 try{saved=JSON.parse(req.cookies.get("sm_google_oauth")?.value||"");}catch{return go("Sign-in session expired");}
 savedReturn=parseAccountReturn(saved.returnTo||null);
 const state=req.nextUrl.searchParams.get("state"),code=req.nextUrl.searchParams.get("code");
 if(!saved?.state||!saved.verifier||!saved.nonce||!state||saved.state!==state||!code)return go("Google sign-in cancelled or expired");
 try{
  const redirectUri=trustedOrigin+"/api/google-auth/callback";
  const token=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({code,client_id:process.env.GOOGLE_OAUTH_CLIENT_ID!,client_secret:process.env.GOOGLE_OAUTH_CLIENT_SECRET!,redirect_uri:redirectUri,grant_type:"authorization_code",code_verifier:saved.verifier}),cache:"no-store"});
  if(!token.ok)return go("Google sign-in failed");
  const tokens=await token.json() as {id_token?:string};
  if(!tokens.id_token)return go("Google identity missing");
  const verify=await fetch("https://oauth2.googleapis.com/tokeninfo?id_token="+encodeURIComponent(tokens.id_token),{cache:"no-store"});
  if(!verify.ok)return go("Google identity verification failed");
  const identity=await verify.json() as {aud?:string;iss?:string;sub?:string;nonce?:string;email?:string;email_verified?:string;exp?:string};
  if(identity.aud!==process.env.GOOGLE_OAUTH_CLIENT_ID||!["accounts.google.com","https://accounts.google.com"].includes(identity.iss||"")||identity.nonce!==saved.nonce||identity.email_verified!=="true"||!identity.sub||!identity.email||Number(identity.exp)*1000<Date.now())return go("Google identity verification failed");
  const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
  let account:{id:string;token:string};
  try{account=store.googleLogin(identity.sub,identity.email,req.cookies.get("sm_referral")?.value);}finally{store.close();}
  const media=createAccountMediaSession("customer-"+account.id);
  const old=req.cookies.get("sm_session")?.value;
  const owner=old?session(old)?.owner:null;
  // Strict cookies do not accompany Google's cross-origin callback. The
  // short-lived, state-bound OAuth cookie carries the original verified guest
  // session from the first-party OAuth start; it is never a URL parameter.
  const carried=parseStudioAccountReturn(savedReturn)!==null&&typeof saved.guestToken==="string"&&
    /^[A-Za-z0-9_-]{40,128}$/.test(saved.guestToken)?saved.guestToken:null;
  const carriedOwner=carried?session(carried)?.owner:null;
  const verifiedGuest=carried&&carriedOwner&&
    !carriedOwner.startsWith("customer-")&&!carriedOwner.startsWith("cms-staff-")
    ?carried:null;
  if(old&&owner?.startsWith("customer-"))
    revokeMediaSession(old);
  const destination=new URL(savedReturn||"/?card=login",trustedOrigin);
  destination.searchParams.set("auth_changed","1");
  const response=clear(NextResponse.redirect(destination));
 response.cookies.delete("sm_referral");
  const guest=verifiedGuest||(old&&owner&&!owner.startsWith("customer-")&&!owner.startsWith("cms-staff-")?old:null);
  if(guest)response.cookies.set("sm_guest_session",guest,{httpOnly:true,secure:true,sameSite:"strict",path:"/",maxAge:30*86400});
  response.cookies.set("sm_customer",account.token,{httpOnly:true,secure:true,sameSite:"strict",path:"/",maxAge:86400});
  response.cookies.set("sm_session",media.token,{httpOnly:true,secure:true,sameSite:"strict",path:"/",maxAge:86400});
  return response;
 }catch(error){
  // A verified Google email never silently inherits access to an existing
  // password account. Explain this specific, safe recovery step to the user.
  if(error instanceof Error&&error.message==="An account with this email already exists. Sign in with its password.")
   return go("This email already has a password account. Sign in with your password instead.");
  return go("Google sign-in could not be completed. Please try again.");
 }
}
