import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {dataDir,limit} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";
import {CampaignPricing,campaignsEnabled,regularTariff} from "@/lib/commerce/campaign-pricing";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"public, no-store","X-Content-Type-Options":"nosniff"};
export async function GET(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 try{
  limit("public-video-tariff",240,60000);
  if(!campaignsEnabled(process.env))return NextResponse.json(regularTariff(),{headers});
  const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
  try{
   const tariff=new CampaignPricing(store.db).active();
   return NextResponse.json(tariff,{headers});
  }finally{store.close()}
 }catch{
  return NextResponse.json({error:"Der gültige Videotarif kann derzeit nicht verifiziert werden."},
   {status:503,headers:{"Cache-Control":"no-store"}});
 }
}
