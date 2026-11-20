import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {CreditWallet} from "@/lib/commerce/credit-wallet";
import {resolveCreditWalletIdentity} from "@/lib/commerce/credit-wallet-auth";
import {CampaignPricing,campaignsEnabled,regularTariff} from "@/lib/commerce/campaign-pricing";
import {dataDir} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store","Vary":"Cookie","X-Content-Type-Options":"nosniff"};
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers});

/** Fast, authenticated account-menu snapshot: no order history or ledger list.
 * Only display values; checkout and generation still verify their own live tariff.
 */
export async function GET(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try{
  const identity=await resolveCreditWalletIdentity(req,store);
  if(!identity)return json({error:"Account login required."},401);
  const wallet=new CreditWallet(store.db);
  // Reservations cannot be spent, just as in the full /api/credit-balance response.
  const availableCredits=Math.max(0,wallet.total(identity.subject)-wallet.reserved(identity.subject));
  // Use exactly the campaign feature flag and active tariff of /api/credit-tariff.
  const tariff=campaignsEnabled(process.env)?new CampaignPricing(store.db).active():regularTariff();
  return json({availableCredits,creditsPerSecond:tariff.creditsPerSecond,expiresUtc:tariff.expiresUtc});
 }catch(e){
  console.error("Account credit summary failed",{category:e instanceof Error?e.name:"unknown"});
  return json({error:"Account credit summary temporarily unavailable."},503);
 }finally{store.close()}
}
