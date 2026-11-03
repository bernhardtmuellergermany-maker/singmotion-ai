import { NextRequest } from "next/server";
import { CommerceStore } from "@/lib/commerce/store";
import { asset, dataDir } from "@/lib/db";
import { stagingDenial } from "@/lib/staging";
import { customerVideoByteRange } from "@/lib/commerce/customer-video-links";
import { type FileHandle } from "node:fs/promises";
import { openVerifiedPaidVideoFile } from "@/lib/commerce/private-video-file";
import { Readable } from "node:stream";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
const deniedVideo = (status=404) => Response.json({error:"Video unavailable."},{status,headers});

/** Stream a verified delivered video only to the account that owns its paid order.
 * No provider URL or filesystem path is disclosed. Never invokes BytePlus. */
export async function GET(req: NextRequest) {
  const denied=stagingDenial(req.headers.get("authorization"));
  if(denied)return denied;
  if(process.env.CUSTOMER_ACCOUNTS_ENABLED!=="true")return deniedVideo(503);
  const orderId=req.nextUrl.searchParams.get("orderId");
  if(!orderId||!/^[a-f0-9-]{36}$/.test(orderId))return deniedVideo();
  const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
  let fileHandle:FileHandle|undefined;
  let streaming=false;
  try{
    const accountId=store.session(req.cookies.get("sm_customer")?.value||"");
    if(!accountId)return deniedVideo(401);
    const assetId=store.ownedDeliveredVideoAsset(orderId,accountId);
    if(!assetId)return deniedVideo();
    const video=asset(assetId,`customer-${accountId}`);
    if(video.kind!=="video"||video.mime!=="video/mp4")return deniedVideo();
    const verified=await openVerifiedPaidVideoFile(
      path.join(dataDir,"media"),video.path,orderId,video.bytes
    );
    fileHandle=verified.handle;
    const range=customerVideoByteRange(req.headers.get("range"),verified.size);
    if(!range)return new Response(null,{status:416,
      headers:{...headers,"Content-Range":`bytes */${verified.size}`}});
    const {start,end,status}=range;
    const stream=fileHandle.createReadStream({start,end,autoClose:true});
    const body=Readable.toWeb(stream) as ReadableStream;
    streaming=true;
    return new Response(body,{status,headers:{...headers,
      "Content-Type":"video/mp4","Accept-Ranges":"bytes",
      "Content-Length":String(end-start+1),
      ...(status===206?{"Content-Range":`bytes ${start}-${end}/${verified.size}`}:{}),
      "Content-Disposition":`${req.nextUrl.searchParams.has("download")?"attachment":"inline"}; filename="singmotion.mp4"`
    }});
  }catch{
    return deniedVideo();
  }finally{
    store.close();
    if(!streaming)await fileHandle?.close();
  }
}
