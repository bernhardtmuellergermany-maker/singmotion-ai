import {NextRequest,NextResponse} from "next/server";
import {stagingDenial} from "@/lib/staging";
export const runtime="nodejs";export const dynamic="force-dynamic";
/** Public, non-secret STAGING readiness flags. Never return credential values. */
export async function GET(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 if(process.env.RAILWAY_ENVIRONMENT_ID!=="dfaeabed-03df-43ed-aa71-50f343a75041")
  return NextResponse.json({error:"Unavailable"},{status:403});
 const checks={
  customerAccounts:process.env.CUSTOMER_ACCOUNTS_ENABLED==="true",
  stripeTestKey:process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")===true,
  stripeHobbyPrice:process.env.STRIPE_HOBBY_PRICE_ID==="price_1UWtqVBmv7vOK9juUWe853V3",
  stripeHobbyWebhook:process.env.STRIPE_HOBBY_WEBHOOK_SECRET?.startsWith("whsec_")===true,
  subscriptionSwitch:process.env.HOBBY_SUBSCRIPTIONS_ENABLED==="true",
  customerOrderPreparation:process.env.CUSTOMER_ORDER_PREPARATION_ENABLED==="true",
  customerGeneration:process.env.CUSTOMER_GENERATION_ENABLED==="true",
  customerFulfillment:process.env.CUSTOMER_FULFILLMENT_ENABLED==="true",
  customerDelivery:process.env.CUSTOMER_DELIVERY_ENABLED==="true",
 };
 return NextResponse.json({environment:"staging",checks,checkoutConfigured:checks.customerAccounts&&checks.stripeTestKey&&checks.stripeHobbyPrice&&checks.stripeHobbyWebhook&&checks.subscriptionSwitch&&checks.customerGeneration&&checks.customerFulfillment&&checks.customerDelivery,productionAffected:false},{headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}
