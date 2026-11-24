import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {CreditWallet,stripeCreditTopupsTestEnabled,stripeCreditTopupsLiveEnabled} from "@/lib/commerce/credit-wallet";
import {resolveCreditWalletIdentity} from "@/lib/commerce/credit-wallet-auth";
import {dataDir} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";
import {managedCreditMoRApproved} from "@/lib/commerce/managed-credit-payments";
import {publicCreditReleaseApproved} from "@/lib/commerce/public-credit-release";
import {privateInternationalCreditBetaEnabled} from "@/lib/commerce/private-international-credit-beta";
import {worldwideTaxPolicyAvailable,approvedAlternativeBillingCountries} from "@/lib/commerce/worldwide-credit-tax";
import {alternativeCreditCheckoutApproved} from "@/lib/commerce/alternative-credit-checkout";
import {CampaignPricing,campaignsEnabled,regularTariff} from "@/lib/commerce/campaign-pricing";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store","Vary":"Cookie","X-Content-Type-Options":"nosniff"};
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers});

/** All accounts, including a CMS super-admin, see only their real own ledger.
 * Historical video EUR payments are displayed separately as equivalents,
 * never counted as newly purchased or consumed wallet credits.
 */
export async function GET(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try{
  const identity=await resolveCreditWalletIdentity(req,store);
  if(!identity)return json({error:"Account login required."},401);
  const wallet=new CreditWallet(store.db);
  const purchased=wallet.total(identity.subject);
  // Pending/uncertain video submissions block spendable credits but do not
  // consume the ledger until the deliverable MP4 is validated.
  const videoReserved=wallet.reserved(identity.subject);
  const videoReservations=wallet.videoReservations(identity.subject)
    .filter(row=>row.state==="reserved"||row.state==="review")
    .map(row=>({projectId:row.projectId,credits:row.credits,state:row.state,created:row.created}));
  // Historical cent-based entitlements must never fund the new prepaid wallet.
  // Only verified wallet ledger credits, less active wallet reservations, are spendable.
  const reserved=videoReserved;
  let oldOrders:Array<{id:string;projectId:string;credits:number;euros:number;created:number;status:string}>=[];
  if(identity.customerId){
   const accountId=identity.customerId;
   // Only actual completed customer purchases; not estimates or unpaid orders.
   oldOrders=(store.db.prepare(`
    SELECT id,project_id,price_cents,created,status FROM customer_orders
    WHERE account_id=? AND price_cents>0 AND status IN ('paid','delivered')
    ORDER BY created DESC LIMIT 100
   `).all(accountId) as Array<{id:string;project_id:string;price_cents:number;created:number;status:string}>)
    .map(row=>({id:row.id,projectId:row.project_id,credits:row.price_cents,euros:row.price_cents,
     created:row.created,status:row.status}));
  }
  // Keep historical EUR transactions visible only under legacy order history.
  // They are NOT Credit Wallet purchases or spendable deposits.
  const entries=wallet.entries(identity.subject);
  const rawBalance=purchased-reserved;
  // Display-only: the video-seconds estimate must follow the same active,
  // server-verified campaign tariff as Studio, not a hardcoded price.
  // An unavailable or conflicting tariff must not hide a valid wallet balance.
  let creditsPerSecond:number|null=null,tariffExpiresUtc:number|null=null;
  try{
   const tariff=campaignsEnabled(process.env)
    ?new CampaignPricing(store.db).active():regularTariff();
   creditsPerSecond=tariff.creditsPerSecond;
   tariffExpiresUtc=tariff.expiresUtc;
  }catch{
   console.warn("Credit balance video seconds estimate unavailable.");
  }
  const testCheckout=stripeCreditTopupsTestEnabled(process.env);
  const liveCheckout=stripeCreditTopupsLiveEnabled(process.env)&&
    (privateInternationalCreditBetaEnabled(process.env)||publicCreditReleaseApproved(process.env));
  return json({
   availableCredits:Math.max(0,rawBalance),
   reservedCredits:Math.max(0,reserved),
   outstandingCredits:Math.max(0,-rawBalance),
   creditsPerSecond,
   tariffExpiresUtc,
   currency:"EUR",
   // The purchase button must mirror the server's existing verification
   // requirement, not offer a checkout that will inevitably return 403.
   emailVerification:identity.customerId?store.verificationState(identity.customerId):null,
   purchaseEnabled:(testCheckout||liveCheckout)&&
    (!identity.customerId||store.emailVerified(identity.customerId)),
   testMode:testCheckout,
   // Managed Payments collects the billing address inside Stripe Checkout.
   // Own-merchant flows still need a reviewed upfront country/tax decision.
   globalCountrySelection:liveCheckout&&!managedCreditMoRApproved(process.env)&&
     worldwideTaxPolicyAvailable(process.env),
   approvedBillingCountries:null,
   alternativeCheckoutEnabled:liveCheckout&&alternativeCreditCheckoutApproved(process.env),
   alternativeBillingCountries:liveCheckout&&alternativeCreditCheckoutApproved(process.env)?approvedAlternativeBillingCountries(process.env):null,
   entries,
   legacyOrders:oldOrders,
   purchases:wallet.purchases(identity.subject),
   videoReservations,
  });
 }catch(e){
  console.error("Account credit overview failed",{category:e instanceof Error?e.name:"unknown"});
  return json({error:"Credit balance temporarily unavailable."},503);
 }finally{store.close()}
}
