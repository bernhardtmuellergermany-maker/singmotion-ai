import {NextRequest, NextResponse} from "next/server";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {PlanLedger, quotePlanSeconds} from "@/lib/commerce/plans";
import {PromotionLedger} from "@/lib/commerce/promotions";
import {dataDir,limit} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";
import {productionCustomerReleaseApproved,productionPrivateCustomerPreviewEnabled} from "@/lib/commerce/customer-live-config";
import {assessProductionSandboxPilot} from "@/lib/commerce/customer-sandbox-pilot-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (body:unknown,status=200) => NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});

/**
 * Account-owned, read-only price estimate for an intended video duration.
 * No Checkout, allowance reservation, Stripe, or BytePlus submission.
 * This cannot be used as an immutable charged quote: provider output duration
 * and reservation state have to be confirmed in the paid fulfillment workflow.
 */
export async function GET(req:NextRequest) {
 const denied=stagingDenial(req.headers.get("authorization"));
 if(denied)return denied;
 if((process.env.RAILWAY_ENVIRONMENT_ID!=="dfaeabed-03df-43ed-aa71-50f343a75041" && !(productionCustomerReleaseApproved(process.env)||productionPrivateCustomerPreviewEnabled(process.env)||assessProductionSandboxPilot(process.env).ready)) ||
    process.env.CUSTOMER_ACCOUNTS_ENABLED!=="true")
   return reply({error:"Unavailable"},403);
 const raw=new URL(req.url).searchParams.get("seconds");
 if(!raw || !/^(?:[5-9]|[1-9][0-9]|[12][0-9]{2}|300)(?:\.\d{1,3})?$/.test(raw))
   return reply({error:"Expected video duration between 5 and 300 seconds (up to three decimals)."},400);
 const seconds=Number(raw);
 if(seconds<5 || seconds>300)return reply({error:"Invalid duration"},400);
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try {
   const accountId=store.session(req.cookies.get("sm_customer")?.value||"");
   if(!accountId)return reply({error:"Customer sign-in required"},401);
   const state=new PlanLedger(store.db).snapshot(accountId);
   const quote=quotePlanSeconds(state.code,state.secondsRemaining,seconds);
   const promoCode=req.nextUrl.searchParams.get("promo");
   let promotion=null;
   if(promoCode){
     try{limit(`promo-preview:${accountId}`,20,60000);}catch{return reply({error:"Too many promotion checks. Please try again later."},429);}
     if(promoCode.length>40)return reply({error:"Invalid promotion code"},400);
     try {
       if(quote.extraCents<=0)return reply({error:"No extra price to discount."},409);
       promotion=new PromotionLedger(store.db).preview(promoCode,accountId,quote.extraCents,seconds);
     } catch {return reply({error:"Promotion is invalid, unavailable or exhausted."},409);}
   }
   return reply({
     promotion,
     plan:state.code,
     billingPeriod:state.period,
     monthlyFeeCents:state.monthlyPriceCents,
     includedBalanceSeconds:state.secondsRemaining,
     requestedInputSeconds:seconds,
     estimatedBillableSeconds:quote.seconds,
     includedSeconds:quote.includedSeconds,
     extraSeconds:quote.extraSeconds,
     estimatedExtraPriceCents:quote.extraCents,
     currency:"EUR",
     vatIncluded:true,
     checkoutReady:false,
     estimateOnly:true,
     notice:"Estimate only; not a payment request or price guarantee. Generated output duration and actual provider billing may differ. A binding total and allowance reservation must be confirmed before payment or generation."
   });
 } finally {store.close();}
}
