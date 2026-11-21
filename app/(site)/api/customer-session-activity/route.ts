import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {CommerceStore,CUSTOMER_IDLE_MINUTES} from "@/lib/commerce/store";
import {dataDir,session,revokeMediaSession} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";
import {customerAccountSettingsAccessible} from "@/lib/commerce/customer-live-config";
import {applicationOrigin} from "@/lib/request-origin";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{"Cache-Control":"private, no-store"}});
const shape=(policy:{idleMinutes:number;lastActivity:number})=>({
 authenticated:true,idleMinutes:policy.idleMinutes,lastActivity:policy.lastActivity,
 // The existing login cookie retains its independent 24-hour absolute expiry.
 absoluteSessionLifetimeHours:24,
});
async function handler(req:NextRequest){
 const denial=stagingDenial(req.headers.get("authorization"));
 if(denial)return denial;
 if(!customerAccountSettingsAccessible(process.env))return json({error:"Unavailable"},403);
 if(req.method!=="GET"){
  const origin=applicationOrigin(req.url,req.headers.get("host"));
  if(!origin||req.headers.get("origin")!==origin)return json({error:"Invalid origin"},403);
 }
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try{
  const token=req.cookies.get("sm_customer")?.value||"";
  const accountId=store.session(token);
  if(!accountId){
   const response=json({authenticated:false,error:"Customer login required",
    // A fresh tab can arrive after the server has already revoked the token.
    // A staff-only or anonymous browser must not be signed out by this route.
    expiredSession:Boolean(token)},401);
   if(token){
    // Do not disturb an unrelated CMS staff login or staff-owned workspace.
    const mediaToken=req.cookies.get("sm_session")?.value;
    if(mediaToken&&session(mediaToken)?.owner.startsWith("customer-")){
     revokeMediaSession(mediaToken);
     response.cookies.delete("sm_session");
    }
    response.cookies.delete("sm_customer");
   }
   return response;
  }
  if(req.method==="GET")return json(shape(store.sessionPolicy(accountId)));
  if(req.method==="POST"){
   const policy=store.touchSession(token);
   if(policy)return json(shape(policy));
   const response=json({authenticated:false,error:"Session expired",expiredSession:true},401);
   response.cookies.delete("sm_customer");
   const mediaToken=req.cookies.get("sm_session")?.value;
   if(mediaToken&&session(mediaToken)?.owner.startsWith("customer-")){
    revokeMediaSession(mediaToken);
    response.cookies.delete("sm_session");
   }
   return response;
  }
  if(req.method==="PATCH"){
   if(Number(req.headers.get("content-length"))>512)return json({error:"Request too large"},413);
   // Read with a real byte limit even if Transfer-Encoding omits Content-Length.
   const reader=req.body?.getReader();
   if(!reader)return json({error:"Missing request"},400);
   const chunks:Uint8Array[]=[];
   let size=0;
   while(true){
    const part=await reader.read();
    if(part.done)break;
    size+=part.value.length;
    if(size>512){await reader.cancel();return json({error:"Request too large"},413);}
    chunks.push(part.value);
   }
   let input:unknown;
   try{input=JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{return json({error:"Invalid JSON"},400);}
   const minutes=typeof input==="object"&&input!==null&&!Array.isArray(input)
    ?(input as Record<string,unknown>).idleMinutes:undefined;
   if(typeof minutes!=="number"||!CUSTOMER_IDLE_MINUTES.includes(minutes as typeof CUSTOMER_IDLE_MINUTES[number]))
    return json({error:"Unsupported inactivity interval"},400);
   // Revalidate the cookie after parsing, in case a different device timed out.
   if(store.session(token)!==accountId)return json({error:"Session expired"},401);
   return json(shape(store.setSessionIdleMinutes(accountId,minutes)));
  }
  return json({error:"Method not allowed"},405);
 }finally{store.close();}
}
export {handler as GET,handler as POST,handler as PATCH};
