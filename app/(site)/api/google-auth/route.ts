import {NextRequest,NextResponse} from "next/server";
import {randomBytes,createHash} from "node:crypto";
import {stagingDenial} from "@/lib/staging";
export const runtime="nodejs";export const dynamic="force-dynamic";
const staging="dfaeabed-03df-43ed-aa71-50f343a75041";
const ready=()=>process.env.RAILWAY_ENVIRONMENT_ID===staging&&process.env.CUSTOMER_ACCOUNTS_ENABLED==="true"&&!!process.env.GOOGLE_OAUTH_CLIENT_ID&&!!process.env.GOOGLE_OAUTH_CLIENT_SECRET;
export async function GET(req:NextRequest){
 const denial=stagingDenial(req.headers.get("authorization"));if(denial)return denial;
 if(!ready())return NextResponse.json({enabled:false},{headers:{"Cache-Control":"no-store"}});
 if(req.nextUrl.searchParams.get("start")!=="1")return NextResponse.json({enabled:true},{headers:{"Cache-Control":"no-store"}});
 const state=randomBytes(32).toString("base64url"),verifier=randomBytes(32).toString("base64url"),nonce=randomBytes(24).toString("base64url");
 const challenge=createHash("sha256").update(verifier).digest("base64url");
 const redirectUri=new URL("/api/google-auth/callback",req.url).toString();
 const url=new URL("https://accounts.google.com/o/oauth2/v2/auth");
 for(const [key,value] of Object.entries({client_id:process.env.GOOGLE_OAUTH_CLIENT_ID!,redirect_uri:redirectUri,response_type:"code",scope:"openid email profile",state,nonce,code_challenge:challenge,code_challenge_method:"S256",prompt:"select_account"}))url.searchParams.set(key,value);
 const response=NextResponse.redirect(url);
 response.cookies.set("sm_google_oauth",JSON.stringify({state,verifier,nonce}),{httpOnly:true,secure:true,sameSite:"lax",path:"/api/google-auth",maxAge:300});
 return response;
}
