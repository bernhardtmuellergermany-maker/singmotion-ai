import { NextRequest } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";
import path from "node:path";
import { CommerceStore } from "@/lib/commerce/store";
import { PromotionLedger, type PromotionInput } from "@/lib/commerce/promotions";
import { stagingDenial } from "@/lib/staging";
import { adminTestOwner } from "@/cms/first-test";
import { dataDir, limit } from "@/lib/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: {"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"},
});
async function handler(req: NextRequest) {
  const denied=stagingDenial(req.headers.get("authorization"));
  if (denied) return denied;
  if (process.env.CMS_ENABLED!=="true") return json({error:"Administration unavailable"},503);
  const payload=await getPayload({config});
  const identity=await payload.auth({headers:req.headers});
  let actor:string;
  try {
    actor=adminTestOwner(identity.user,req.method,req.headers,process.env);
  } catch {
    return json({error:"Super Admin authorization required"},403);
  }
  let store:CommerceStore|undefined;
  try {
    limit(`promo-admin:${actor}`,30,60000);
    store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
    const ledger=new PromotionLedger(store.db);
    if(req.method==="GET") {
      const requested=req.nextUrl.searchParams.get("code");
      if(requested !== null) {
        if(requested.length>40)return json({error:"Invalid promotion code"},400);
        try { return json({report:ledger.report(requested)}); }
        catch { return json({error:"Promotion not found"},404); }
      }
      return json({codes:ledger.list(),checkoutEnabled:false});
    }
    if(req.method!=="POST") return json({error:"Method not allowed"},405);
    const reader=req.body?.getReader();
    if(!reader) return json({error:"Request body required"},400);
    const chunks:Uint8Array[]=[];
    let size=0;
    while(true){
      const part=await reader.read();
      if(part.done)break;
      size+=part.value.byteLength;
      if(size>4096){await reader.cancel();return json({error:"Request too large"},413);}
      chunks.push(part.value);
    }
    const input=JSON.parse(Buffer.concat(chunks).toString()) as
      ({action:"create"} & PromotionInput) | {action:"toggle";code:string;enabled:boolean};
    let result;
    if(input.action==="create"){
      result=ledger.create(input);
    } else if(input.action==="toggle" && typeof input.enabled==="boolean"){
      result=ledger.setEnabled(input.code,input.enabled);
    } else return json({error:"Invalid action"},400);
    await payload.create({
      collection:"audit-events",overrideAccess:true,
      data:{actor:String(identity.user!.id),action:`promo:${input.action}`,resource:"promotion",record:result.code},
    });
    return json({promotion:result},input.action==="create"?201:200);
  } catch(e) {
    if(e instanceof SyntaxError) return json({error:"Invalid JSON"},400);
    if(e instanceof Error && /^(Invalid|Unknown|Code |Start |Dates |Per-customer|This release|Promotion not found)/.test(e.message))
      return json({error:e.message},400);
    console.warn("Promotion administration rejected", {code:"PROMOTION_ADMIN_ERROR"});
    return json({error:"Promotion operation unavailable"},503);
  } finally {store?.close();}
}
export {handler as GET,handler as POST};
