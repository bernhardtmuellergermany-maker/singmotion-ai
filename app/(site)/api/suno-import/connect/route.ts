import {NextRequest,NextResponse} from "next/server";
import {stagingDenial} from "@/lib/staging";
import {session,limit} from "@/lib/db";
import {SUNO_APP_ORIGIN,sunoProductionOnly,pkcePair,oauthClientRegistration,
 authorizationUrl,SUNO_OAUTH_REGISTER,sunoReturnDestination,sunoReturnUrl} from "@/lib/suno-mcp-import";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const callback=SUNO_APP_ORIGIN+"/api/suno-import/callback";

export async function GET(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 if(!sunoProductionOnly()||req.headers.get("host")!=="www.singmotion.ai")
  return NextResponse.json({error:"Suno OAuth is not available on this environment."},{status:404});
 const destination=sunoReturnDestination(req.nextUrl.searchParams.get("destination"));
 const mediaToken=req.cookies.get("sm_session")?.value||"";
 const auth=session(mediaToken);
 if(!auth)return NextResponse.redirect(sunoReturnUrl(destination,"session"));
 try{
  limit("suno-connect:"+auth.owner,5,60*60*1000);
  const pkce=pkcePair();
  const response=await fetch(SUNO_OAUTH_REGISTER,{
   method:"POST",redirect:"error",signal:AbortSignal.timeout(12000),
   headers:{"Content-Type":"application/json","Accept":"application/json"},
   body:JSON.stringify(oauthClientRegistration(callback)),cache:"no-store"
  });
  if(!response.ok)return NextResponse.redirect(sunoReturnUrl(destination,"registration"));
  const data=await response.json() as {client_id?:string};
  if(typeof data.client_id!=="string"||data.client_id.length<8||data.client_id.length>300)
   throw Error("Suno OAuth client registration incomplete");
  const url=authorizationUrl(data.client_id,callback,pkce);
  const reply=NextResponse.redirect(url);
  reply.headers.set("Cache-Control","private, no-store");
  reply.cookies.set("sm_suno_oauth",JSON.stringify({owner:auth.owner,mediaToken,
    clientId:data.client_id,state:pkce.state,verifier:pkce.verifier,destination}),
    {httpOnly:true,secure:true,sameSite:"lax",path:"/api/suno-import",maxAge:300});
  return reply;
 }catch{
  return NextResponse.redirect(sunoReturnUrl(destination,"unavailable"));
 }
}
