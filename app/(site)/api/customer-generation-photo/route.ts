import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {CommerceStore} from "@/lib/commerce/store";
import {asset,dataDir} from "@/lib/db";
import {reviewedVideoInputDigest} from "@/lib/commerce/reviewed-video";
import type {PreparedMedia} from "@/lib/live/store";
import {stagingDenial} from "@/lib/staging";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
const missing=()=>NextResponse.json({error:"Preview unavailable."},{status:404,headers});

/** Owner-scoped read-only preview of the immutable, paid, reviewed reference.
 * This never reads a browser-supplied path, and never starts paid generation. */
export async function GET(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));
 if(denied)return denied;
 const id=req.nextUrl.searchParams.get("orderId")||"";
 if(!/^[a-f0-9-]{36}$/.test(id))return missing();
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try{
   const account=store.session(req.cookies.get("sm_customer")?.value||"");
   const guest=req.cookies.get("sm_guest_"+id)?.value;
   const order=store.ownedOrder(id,account,guest);
   if(order.status!=="paid")return missing();
   const row=store.db.prepare(`SELECT m.media_json,i.input_digest FROM customer_prepared_media m
     JOIN customer_order_inputs i ON i.order_id=m.order_id
     WHERE m.order_id=?`).get(id) as {media_json:string;input_digest:string}|undefined;
   if(!row)return missing();
   const media=JSON.parse(row.media_json) as PreparedMedia;
   if(typeof media.sourceJobId!=="string"||!media.sourceJobId||
      !/^[a-f0-9]{64}$/.test(media.imageSha256)||
      reviewedVideoInputDigest(media)!==row.input_digest)return missing();
   const record=asset(media.sourceJobId+"-image-"+media.imageSha256,media.owner);
   if(record.owner!==media.owner||record.path!==media.imagePath)return missing();
   const relative=path.relative(dataDir,record.path);
   if(relative.startsWith("..")||path.isAbsolute(relative)||relative==="")return missing();
   if(record.bytes<=0||record.bytes>30*1024*1024)return missing();
   const bytes=await readFile(record.path);
   if(bytes.length!==record.bytes||
      createHash("sha256").update(bytes).digest("hex")!==media.imageSha256)return missing();
   const png=bytes.length>8 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
   const jpeg=bytes.length>3 && bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
   const webp=bytes.length>12 && bytes.toString("ascii",0,4)==="RIFF" && bytes.toString("ascii",8,12)==="WEBP";
   const mime=png?"image/png":jpeg?"image/jpeg":webp?"image/webp":null;
   if(!mime)return missing();
   return new Response(new Uint8Array(bytes),{status:200,headers:{...headers,"Content-Type":mime,"Content-Length":String(bytes.length)}});
 }catch{return missing();}
 finally{store.close();}
}
