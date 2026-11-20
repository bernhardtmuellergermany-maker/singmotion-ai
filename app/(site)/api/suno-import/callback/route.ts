import {NextRequest,NextResponse} from "next/server";
import {stagingDenial} from "@/lib/staging";
import {session} from "@/lib/db";
import {SUNO_APP_ORIGIN,SUNO_OAUTH_TOKEN,SUNO_MCP_RESOURCE,sunoProductionOnly,
 readSunoOAuthCookie,signSunoAccessToken} from "@/lib/suno-mcp-import";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const callback=SUNO_APP_ORIGIN+"/api/suno-import/callback";

export async function GET(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 if(!sunoProductionOnly()||req.headers.get("host")!=="www.singmotion.ai")
  return NextResponse.json({error:"Not found"},{status:404});
 const finish=(error?:string,token?:{cookie:string;ttl:number})=>{
  const url=SUNO_APP_ORIGIN+"/studio?"+(error?"suno_error="+encodeURIComponent(error):"suno_connected=1");
  const response=NextResponse.redirect(url);
  response.headers.set("Cache-Control","private, no-store");
  response.cookies.set("sm_suno_oauth","",{httpOnly:true,secure:true,sameSite:"lax",path:"/api/suno-import",maxAge:0});
  if(token)response.cookies.set("sm_suno_access",token.cookie,{httpOnly:true,secure:true,
    sameSite:"strict",path:"/api/suno-import",maxAge:token.ttl});
  return response;
 };
 const saved=readSunoOAuthCookie(req.cookies.get("sm_suno_oauth")?.value);
 if(!saved||!session(saved.mediaToken)||session(saved.mediaToken)?.owner!==saved.owner)
  return finish("session");
 const state=req.nextUrl.searchParams.get("state"),code=req.nextUrl.searchParams.get("code");
 if(req.nextUrl.searchParams.has("error"))return finish("cancelled");
 if(!state||state!==saved.state||!code||code.length>2048)return finish("state");
 try{
  const body=new URLSearchParams({grant_type:"authorization_code",client_id:saved.clientId,
   code,redirect_uri:callback,code_verifier:saved.verifier,resource:SUNO_MCP_RESOURCE});
  const r=await fetch(SUNO_OAUTH_TOKEN,{method:"POST",redirect:"error",
   signal:AbortSignal.timeout(15000),
   headers:{"Content-Type":"application/x-www-form-urlencoded","Accept":"application/json"},
   body,cache:"no-store"});
  if(!r.ok)return finish("authorization");
  const data=await r.json() as {access_token?:string;expires_in?:number};
  const signed=signSunoAccessToken(saved.mediaToken,saved.owner,
    typeof data.access_token==="string"?data.access_token:"",
    typeof data.expires_in==="number"?data.expires_in:900);
  return finish(undefined,signed);
 }catch{return finish("authorization");}
}
