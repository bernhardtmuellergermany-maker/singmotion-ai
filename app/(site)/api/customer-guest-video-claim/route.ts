import {NextRequest} from "next/server";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {dataDir,limit} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";
import {applicationOrigin} from "@/lib/request-origin";
export const runtime="nodejs";export const dynamic="force-dynamic";
const reply=(v:unknown,status=200)=>Response.json(v,{status,headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"}});
/** Exact original guest order token PLUS a verified matching account email.
 * No account claiming by order ID, matching email alone, or browser-supplied
 * accountId. Transfer is logical; original immutable MP4/R2 owner is retained.
 */
export async function POST(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 if(process.env.CUSTOMER_ACCOUNTS_ENABLED!=="true")return reply({error:"Unavailable"},503);
 if(req.headers.get("origin")!==applicationOrigin(req.url,req.headers.get("host")))
  return reply({error:"Invalid origin"},403);
 const raw=await req.text();if(Buffer.byteLength(raw)>512)return reply({error:"Request too large"},413);
 let input:{orderId?:string};
 try{input=JSON.parse(raw)}catch{return reply({error:"Invalid request"},400)}
 const orderId=input.orderId||"";
 if(!/^[a-f0-9-]{36}$/.test(orderId))return reply({error:"Invalid order reference"},400);
 try{limit("guest-video-claim:"+orderId,8,60000);}catch{return reply({error:"Too many attempts"},429)}
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try{
  const accountId=store.session(req.cookies.get("sm_customer")?.value||"");
  const guestToken=req.cookies.get("sm_guest_"+orderId)?.value;
  if(!accountId||!guestToken)return reply({error:"Sign in and open your private guest order link first."},401);
  const claimed=store.claimGuestOrder(orderId,accountId,guestToken);
  return reply({claimed,orderId});
 }catch{return reply({error:"A confirmed matching email and the private guest order link are required."},403)}
 finally{store.close()}
}
