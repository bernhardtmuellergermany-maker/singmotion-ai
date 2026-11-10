import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {requestGuestOrderRecovery,redeemGuestOrderRecovery} from "@/lib/commerce/guest-video-recovery";
import {dataDir,limit} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";
import {applicationOrigin} from "@/lib/request-origin";
export const runtime="nodejs";export const dynamic="force-dynamic";
const reply=(v:unknown,status=200)=>NextResponse.json(v,{status,headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"}});
export async function POST(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 if(process.env.CUSTOMER_ACCOUNTS_ENABLED!=="true")return reply({error:"Unavailable"},503);
 if(req.headers.get("origin")!==applicationOrigin(req.url,req.headers.get("host")))
  return reply({error:"Invalid origin"},403);
 const raw=await req.text();
 if(Buffer.byteLength(raw)>1024)return reply({error:"Request too large"},413);
 let body:{action?:string;orderId?:string;email?:string;token?:string};
 try{body=JSON.parse(raw)}catch{return reply({error:"Invalid request"},400)}
 const id=body.orderId||"";
 if(!/^[a-f0-9-]{36}$/.test(id))return reply({error:"Invalid order reference"},400);
 try{limit("guest-video-recovery:global",15,60000);limit("guest-video-recovery:"+id,3,15*60000)}
 catch{return reply({error:"Too many requests"},429)}
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try{
  if(body.action==="request"){
   if(typeof body.email!=="string"||body.email.length>254)
    return reply({error:"Valid email required"},400);
   // Never disclose account/order existence.
   await requestGuestOrderRecovery(store,id,body.email);
   return reply({message:"Falls diese Gastbestellung zu der Adresse gehört, wurde ein einmaliger Zugang versendet."});
  }
  if(body.action==="redeem"){
   if(typeof body.token!=="string")return reply({error:"Invalid recovery link"},400);
   const token=redeemGuestOrderRecovery(store,id,body.token);
   if(!token)return reply({error:"Dieser Link ist ungültig, abgelaufen oder bereits benutzt."},403);
   const response=reply({recovered:true});
   response.cookies.set("sm_guest_"+id,token,{
    httpOnly:true,secure:true,sameSite:"lax",path:"/",maxAge:90*86400,
   });
   return response;
  }
  return reply({error:"Invalid action"},400);
 }finally{store.close()}
}
