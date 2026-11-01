import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {PlanLedger} from "@/lib/commerce/plans";
import {dataDir,limit} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";
export const runtime="nodejs";export const dynamic="force-dynamic";
const origin="https://singmotion-ai-staging.up.railway.app";
export async function GET(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 const enabled=process.env.RAILWAY_ENVIRONMENT_ID==="dfaeabed-03df-43ed-aa71-50f343a75041"&&process.env.HOBBY_SUBSCRIPTIONS_ENABLED==="true"&&!!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_");
 return NextResponse.json({enabled},{headers:{"Cache-Control":"no-store"}});
}
export async function POST(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 if(process.env.RAILWAY_ENVIRONMENT_ID!=="dfaeabed-03df-43ed-aa71-50f343a75041"||process.env.HOBBY_SUBSCRIPTIONS_ENABLED!=="true"||!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_"))return NextResponse.json({error:"Billing portal not configured"},{status:503});
 if(req.headers.get("origin")!==origin)return NextResponse.json({error:"Invalid origin"},{status:403});
 try{limit("hobby-portal:"+req.headers.get("x-forwarded-for"),5,60000)}catch{return NextResponse.json({error:"Rate limited"},{status:429})}
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try{
  const accountId=store.session(req.cookies.get("sm_customer")?.value||"");
  if(!accountId)return NextResponse.json({error:"Please sign in"},{status:401});
  new PlanLedger(store.db);
  const row=store.db.prepare("SELECT provider_subscription_id FROM customer_subscriptions WHERE account_id=? AND provider='stripe'").get(accountId) as {provider_subscription_id:string}|undefined;
  if(!row?.provider_subscription_id?.startsWith("sub_"))return NextResponse.json({error:"No Stripe subscription found"},{status:404});
  const response=await fetch("https://api.stripe.com/v1/subscriptions/"+encodeURIComponent(row.provider_subscription_id),{headers:{Authorization:"Bearer "+process.env.STRIPE_SECRET_KEY},cache:"no-store",signal:AbortSignal.timeout(10000)});
  if(!response.ok)return NextResponse.json({error:"Subscription unavailable"},{status:502});
  const sub=await response.json() as {livemode:boolean;metadata?:Record<string,string>;customer?:string};
  if(sub.livemode!==false||sub.metadata?.singmotionAccountId!==accountId||typeof sub.customer!=="string"||!sub.customer.startsWith("cus_"))return NextResponse.json({error:"Subscription ownership mismatch"},{status:403});
  const form=new URLSearchParams({customer:sub.customer,return_url:origin+"/account/settings"});
  const portal=await fetch("https://api.stripe.com/v1/billing_portal/sessions",{method:"POST",headers:{Authorization:"Bearer "+process.env.STRIPE_SECRET_KEY,"Content-Type":"application/x-www-form-urlencoded"},body:form,cache:"no-store",signal:AbortSignal.timeout(10000)});
  if(!portal.ok)return NextResponse.json({error:"Stripe customer portal unavailable"},{status:502});
  const data=await portal.json() as {url?:string;livemode?:boolean};
  if(data.livemode!==false||!data.url?.startsWith("https://billing.stripe.com/"))return NextResponse.json({error:"Invalid portal response"},{status:502});
  return NextResponse.json({url:data.url},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Billing portal temporarily unavailable"},{status:503})}finally{store.close()}
}
