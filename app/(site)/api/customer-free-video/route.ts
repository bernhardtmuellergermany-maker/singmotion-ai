import {NextRequest} from "next/server";
import {CommerceStore} from "@/lib/commerce/store";
import {freePromoPrivateDeliveryEnabled} from "@/lib/commerce/free-promo-settlement";
import {openVerifiedFreeVideoFile} from "@/lib/commerce/free-promo-private-file";
import {customerVideoByteRange} from "@/lib/commerce/customer-video-links";
import {streamVerifiedPaidVideoRange} from "@/lib/commerce/private-video-file";
import {stagingDenial} from "@/lib/staging";
import {dataDir} from "@/lib/db";
import type {FileHandle} from "node:fs/promises";
import path from "node:path";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
const denied=(status=404)=>Response.json({error:"Video unavailable."},{status,headers});

/** A distinct ZERO-EUR delivery route: never calls Stripe or the paid
 * provider and never uses the paid video manifest. Auth required each GET.
 */
export async function GET(req:NextRequest){
 const staging=stagingDenial(req.headers.get("authorization"));
 if(staging)return staging;
 if(!freePromoPrivateDeliveryEnabled()||process.env.CUSTOMER_ACCOUNTS_ENABLED!=="true")
  return denied(503);
 const orderId=req.nextUrl.searchParams.get("orderId");
 if(!orderId||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(orderId))
  return denied();
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 let file:FileHandle|undefined,streaming=false;
 try{
  const accountId=store.session(req.cookies.get("sm_customer")?.value||"");
  if(!accountId)return denied(401);
  const record=store.db.prepare(`SELECT d.bytes,d.sha256 FROM free_promo_video_deliveries d
   JOIN customer_orders o ON o.id=d.order_id AND o.account_id=d.account_id
   JOIN promo_redemptions p ON p.order_id=d.order_id AND p.account_id=d.account_id
   JOIN free_promo_budget_authorizations a ON a.order_id=d.order_id AND a.account_id=d.account_id
   WHERE d.order_id=? AND d.account_id=? AND o.status='free_delivered'
    AND o.price_cents=0 AND p.state='redeemed' AND a.state='delivered'`)
   .get(orderId,accountId) as {bytes:number;sha256:string}|undefined;
  if(!record)return denied();
  file=await openVerifiedFreeVideoFile(path.join(dataDir,"media"),orderId,record.bytes,record.sha256);
  const range=customerVideoByteRange(req.headers.get("range"),record.bytes);
  if(!range)return new Response(null,{status:416,headers:{...headers,
   "Content-Range":`bytes */${record.bytes}`}});
  const {start,end,status}=range;
  const body=streamVerifiedPaidVideoRange(file,start,end,req.signal);
  streaming=true;
  return new Response(body,{status,headers:{...headers,"Content-Type":"video/mp4",
   "Accept-Ranges":"bytes","Content-Length":String(end-start+1),
   ...(status===206?{"Content-Range":`bytes ${start}-${end}/${record.bytes}`}:{}),
   "Content-Disposition":`${req.nextUrl.searchParams.has("download")?"attachment":"inline"}; filename="singmotion.mp4"`}});
 }catch{return denied()}
 finally{store.close();if(!streaming)await file?.close()}
}
