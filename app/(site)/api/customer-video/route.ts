import { NextRequest } from "next/server";
import { CommerceStore } from "@/lib/commerce/store";
import { asset, dataDir } from "@/lib/db";
import { stagingDenial } from "@/lib/staging";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
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
  let videoPath:string;
  try{
    const accountId=store.session(req.cookies.get("sm_customer")?.value||"");
    if(!accountId)return deniedVideo(401);
    const assetId=store.ownedDeliveredVideoAsset(orderId,accountId);
    if(!assetId)return deniedVideo();
    const video=asset(assetId,`customer-${accountId}`);
    if(video.kind!=="video"||video.mime!=="video/mp4")return deniedVideo();
    const root=await realpath(path.join(dataDir,"media"));
    const file=await realpath(video.path);
    if(!file.startsWith(root+path.sep))return deniedVideo();
    const info=await stat(file);
    if(!info.isFile()||info.size<1||info.size!==video.bytes)return deniedVideo();
    videoPath=file;
  }catch{return deniedVideo();}
  finally{store.close();}
  const info=await stat(videoPath);
  const range=req.headers.get("range");
  let start=0,end=info.size-1,status=200;
  if(range){
    const match=/^bytes=(\\d+)-(\\d*)$/.exec(range);
    if(!match)return new Response(null,{status:416,headers:{...headers,"Content-Range":`bytes */${info.size}`}});
    start=Number(match[1]);end=match[2]?Number(match[2]):info.size-1;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||end>=info.size)
      return new Response(null,{status:416,headers:{...headers,"Content-Range":`bytes */${info.size}`}});
    status=206;
  }
  return new Response(Readable.toWeb(createReadStream(videoPath,{start,end})) as ReadableStream,{
    status,headers:{...headers,"Content-Type":"video/mp4","Accept-Ranges":"bytes",
      "Content-Length":String(end-start+1),
      ...(status===206?{"Content-Range":`bytes ${start}-${end}/${info.size}`}:{}),
      "Content-Disposition":`${req.nextUrl.searchParams.has("download")?"attachment":"inline"}; filename="singmotion.mp4"`},
  });
}
