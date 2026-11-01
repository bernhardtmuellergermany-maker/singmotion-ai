import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {PlanLedger} from "@/lib/commerce/plans";
import {dataDir,limit} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";
export const runtime="nodejs";export const dynamic="force-dynamic";
const origin="https://singmotion-ai-staging.up.railway.app";
const ready=()=>process.env.RAILWAY_ENVIRONMENT_ID==="dfaeabed-03df-43ed-aa71-50f343a75041"&&process.env.CUSTOMER_ACCOUNTS_ENABLED==="true"&&process.env.CUSTOMER_GENERATION_ENABLED==="true"&&process.env.CUSTOMER_FULFILLMENT_ENABLED==="true"&&process.env.CUSTOMER_DELIVERY_ENABLED==="true"&&process.env.HOBBY_SUBSCRIPTIONS_ENABLED==="true"&&!!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")&&!!process.env.STRIPE_HOBBY_PRICE_ID?.startsWith("price_")&&!!process.env.STRIPE_HOBBY_WEBHOOK_SECRET?.startsWith("whsec_");
export async function GET(){return NextResponse.json({enabled:ready()},{headers:{"Cache-Control":"no-store"}})}
export async function POST(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 if(!ready())return NextResponse.json({error:"Hobby test Checkout is not configured."},{status:503});
 if(req.headers.get("origin")!==origin)return NextResponse.json({error:"Invalid origin"},{status:403});
 try{limit("hobby-checkout:"+req.headers.get("x-forwarded-for"),5,60000)}catch{return NextResponse.json({error:"Too many requests"},{status:429})}
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try{
  const accountId=store.session(req.cookies.get("sm_customer")?.value||"");
  if(!accountId)return NextResponse.json({error:"Sign in to subscribe"},{status:401});
  const account=store.db.prepare("SELECT email FROM customer_accounts WHERE id=?").get(accountId) as {email:string}|undefined;
  if(!account)return NextResponse.json({error:"Account missing"},{status:404});
  // Prevent duplicate active subscriptions, but permit a new checkout after a
  // fully canceled one. Re-check Stripe instead of trusting a stale local row.
  new PlanLedger(store.db);
  const existing=store.db.prepare("SELECT provider_subscription_id FROM customer_subscriptions WHERE account_id=? AND provider='stripe'").get(accountId) as {provider_subscription_id:string}|undefined;
  if(existing?.provider_subscription_id){
   const check=await fetch("https://api.stripe.com/v1/subscriptions/"+encodeURIComponent(existing.provider_subscription_id),{headers:{Authorization:"Bearer "+process.env.STRIPE_SECRET_KEY},cache:"no-store",signal:AbortSignal.timeout(10000)});
   if(!check.ok)return NextResponse.json({error:"Could not verify existing subscription"},{status:503});
   const sub=await check.json() as {livemode?:boolean;status?:string;metadata?:Record<string,string>};
   if(sub.livemode!==false||sub.metadata?.singmotionAccountId!==accountId)return NextResponse.json({error:"Existing subscription verification failed"},{status:403});
   if(sub.status!=="canceled"&&sub.status!=="incomplete_expired")return NextResponse.json({error:"Existing Stripe subscription: manage billing before subscribing again."},{status:409});
  }
  // Verify the authoritative Stripe Price before any Checkout session is created.
  // A misconfigured test Price must never silently charge a different amount.
  const priceResponse=await fetch("https://api.stripe.com/v1/prices/"+encodeURIComponent(process.env.STRIPE_HOBBY_PRICE_ID!),{
   headers:{Authorization:"Bearer "+process.env.STRIPE_SECRET_KEY},cache:"no-store",signal:AbortSignal.timeout(10000)
  });
  if(!priceResponse.ok)return NextResponse.json({error:"Hobby pricing verification unavailable"},{status:503});
  const price=await priceResponse.json() as {id?:string;livemode?:boolean;active?:boolean;currency?:string;unit_amount?:number;tax_behavior?:string;recurring?:{interval?:string;interval_count?:number;usage_type?:string}};
  if(price.livemode!==false||price.id!==process.env.STRIPE_HOBBY_PRICE_ID||price.active!==true||
     price.currency!=="eur"||price.unit_amount!==499||price.tax_behavior!=="inclusive"||
     price.recurring?.interval!=="month"||price.recurring?.interval_count!==1||
     price.recurring?.usage_type!=="licensed")
   return NextResponse.json({error:"Configured Hobby Stripe price does not match the advertised plan"},{status:503});
  const form=new URLSearchParams({"mode":"subscription","line_items[0][price]":process.env.STRIPE_HOBBY_PRICE_ID!,"line_items[0][quantity]":"1","client_reference_id":accountId,"customer_email":account.email,"subscription_data[metadata][singmotionAccountId]":accountId,"subscription_data[metadata][singmotionPlan]":"hobby","metadata[singmotionAccountId]":accountId,"success_url":origin+"/account/settings?checkout=success","cancel_url":origin+"/account/settings?checkout=cancelled"});
  const res=await fetch("https://api.stripe.com/v1/checkout/sessions",{method:"POST",headers:{Authorization:"Bearer "+process.env.STRIPE_SECRET_KEY,"Content-Type":"application/x-www-form-urlencoded","Idempotency-Key":"sm-hobby-"+accountId+"-"+new Date().toISOString().slice(0,13)},body:form,cache:"no-store",signal:AbortSignal.timeout(12000)});
  if(!res.ok)return NextResponse.json({error:"Stripe Checkout unavailable"},{status:502});
  const checkout=await res.json() as {url?:string;id?:string;livemode?:boolean};
  if(!checkout.id?.startsWith("cs_test_")||!checkout.url?.startsWith("https://checkout.stripe.com/")||checkout.livemode!==false)return NextResponse.json({error:"Unexpected Stripe Checkout session"},{status:502});
  return NextResponse.json({url:checkout.url},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Checkout temporarily unavailable"},{status:503})}finally{store.close()}
}
