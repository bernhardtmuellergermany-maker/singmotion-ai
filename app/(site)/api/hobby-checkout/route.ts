import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {PlanLedger} from "@/lib/commerce/plans";
import {dataDir,limit} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";
import {configuredStripePaymentMode,stripeSessionIdMatchesMode} from "@/lib/commerce/stripe-payment-mode";
import {customerLaunchReadiness} from "@/lib/commerce/readiness";
import {applicationOrigin} from "@/lib/request-origin";
import {verifiedHobbyCheckoutSession,verifiedReusableHobbyCheckoutSession,verifiedHobbyLiveProduct} from "@/lib/commerce/stripe-hobby-checkout";
import {legacyCustomerPurchaseRetired,LEGACY_PURCHASE_RETIRED_RESPONSE} from "@/lib/commerce/credits-only-commerce";
export const runtime="nodejs";export const dynamic="force-dynamic";
const ready=()=>configuredStripePaymentMode(process.env)!==null&&
 customerLaunchReadiness().readyForPaidOrders&&
 process.env.CUSTOMER_GENERATION_ENABLED==="true"&&
 process.env.CUSTOMER_FULFILLMENT_ENABLED==="true"&&
 process.env.CUSTOMER_DELIVERY_ENABLED==="true"&&
 process.env.HOBBY_SUBSCRIPTIONS_ENABLED==="true"&&
 process.env.HOBBY_NEW_PURCHASES_ENABLED==="true"&&
 /^price_[A-Za-z0-9_]+$/.test(process.env.STRIPE_HOBBY_PRICE_ID||"")&&
 /^whsec_[A-Za-z0-9_]+$/.test(process.env.STRIPE_HOBBY_WEBHOOK_SECRET||"");
export async function GET(){return NextResponse.json({enabled:!legacyCustomerPurchaseRetired()&&ready()},{headers:{"Cache-Control":"no-store"}})}
export async function POST(req:NextRequest){
 if(legacyCustomerPurchaseRetired())return NextResponse.json(LEGACY_PURCHASE_RETIRED_RESPONSE,{status:410,headers:{"Cache-Control":"no-store"}});
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 if(!ready())return NextResponse.json({error:"Hobby Checkout is not configured."},{status:503});
 const origin=applicationOrigin(req.url,req.headers.get("host"));
 if(!origin||req.headers.get("origin")!==origin)return NextResponse.json({error:"Invalid origin"},{status:403});
 const mode=configuredStripePaymentMode(process.env)!;
 const expectedLive=mode==="live";
 try{limit("hobby-checkout:"+req.headers.get("x-forwarded-for"),5,60000)}catch{return NextResponse.json({error:"Too many requests"},{status:429})}
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try{
  const accountId=store.session(req.cookies.get("sm_customer")?.value||"");
  if(!accountId)return NextResponse.json({error:"Sign in to subscribe"},{status:401});
  if(!store.emailVerified(accountId))return NextResponse.json({error:"Verify your email before subscribing.",code:"EMAIL_NOT_VERIFIED"},{status:403});
  const account=store.db.prepare("SELECT email FROM customer_accounts WHERE id=?").get(accountId) as {email:string}|undefined;
  if(!account)return NextResponse.json({error:"Account missing"},{status:404});
  // Verify the authoritative Stripe Price before any Checkout session is created.
  // A misconfigured test Price must never silently charge a different amount.
  const priceResponse=await fetch("https://api.stripe.com/v1/prices/"+encodeURIComponent(process.env.STRIPE_HOBBY_PRICE_ID!),{
   headers:{Authorization:"Bearer "+process.env.STRIPE_SECRET_KEY},cache:"no-store",signal:AbortSignal.timeout(10000)
  });
  if(!priceResponse.ok)return NextResponse.json({error:"Hobby pricing verification unavailable"},{status:503});
  const price=await priceResponse.json() as {id?:string;livemode?:boolean;active?:boolean;currency?:string;unit_amount?:number;tax_behavior?:string;recurring?:{interval?:string;interval_count?:number;usage_type?:string};product?:string;nickname?:string;lookup_key?:string};
  if(price.livemode!==expectedLive||price.id!==process.env.STRIPE_HOBBY_PRICE_ID||price.active!==true||
     price.currency!=="eur"||price.unit_amount!==499||price.tax_behavior!=="inclusive"||
     price.recurring?.interval!=="month"||price.recurring?.interval_count!==1||
     price.recurring?.usage_type!=="licensed")
   return NextResponse.json({error:"Configured Hobby Stripe price does not match the advertised plan"},{status:503});
  // A LIVE API price may still belong to a staging/sandbox product. Verify
  // against Stripe before returning any pending session or creating a new one.
  if(expectedLive){
   if(typeof price.product!=="string"||!/^prod_[A-Za-z0-9_]+$/.test(price.product))
    return NextResponse.json({error:"Production Hobby product is not approved"},{status:503});
   const productResponse=await fetch("https://api.stripe.com/v1/products/"+encodeURIComponent(price.product),{
    headers:{Authorization:"Bearer "+process.env.STRIPE_SECRET_KEY},cache:"no-store",signal:AbortSignal.timeout(10000)
   });
   if(!productResponse.ok)return NextResponse.json({error:"Hobby product verification unavailable"},{status:503});
   if(!verifiedHobbyLiveProduct(price,await productResponse.json()))
    return NextResponse.json({error:"Production Hobby product is not approved"},{status:503});
  }
  // Prevent duplicate active subscriptions, but permit a new checkout after a
  // fully canceled one. Re-check Stripe instead of trusting a stale local row.
  new PlanLedger(store.db);
  const existing=store.db.prepare("SELECT provider_subscription_id FROM customer_subscriptions WHERE account_id=? AND provider='stripe'").get(accountId) as {provider_subscription_id:string}|undefined;
  if(existing?.provider_subscription_id){
   const check=await fetch("https://api.stripe.com/v1/subscriptions/"+encodeURIComponent(existing.provider_subscription_id),{headers:{Authorization:"Bearer "+process.env.STRIPE_SECRET_KEY},cache:"no-store",signal:AbortSignal.timeout(10000)});
   if(!check.ok)return NextResponse.json({error:"Could not verify existing subscription"},{status:503});
   const sub=await check.json() as {livemode?:boolean;status?:string;metadata?:Record<string,string>};
   if(sub.livemode!==expectedLive||sub.metadata?.singmotionAccountId!==accountId)return NextResponse.json({error:"Existing subscription verification failed"},{status:403});
   if(sub.status!=="canceled"&&sub.status!=="incomplete_expired")return NextResponse.json({error:"Existing Stripe subscription: manage billing before subscribing again."},{status:409});
  }
  // Reuse pending Checkout sessions rather than opening a new subscription
  // in each browser tab before Stripe's first webhook arrives.
  store.db.exec("CREATE TABLE IF NOT EXISTS hobby_pending_checkouts(account_id TEXT PRIMARY KEY,session_id TEXT NOT NULL,url TEXT NOT NULL,expires_at INTEGER NOT NULL)");
  const existingCheckout=store.db.prepare("SELECT url,expires_at FROM hobby_pending_checkouts WHERE account_id=?").get(accountId) as {url:string;expires_at:number}|undefined;
  if(existingCheckout && existingCheckout.url.startsWith("https://checkout.stripe.com/")){
    const pending=store.db.prepare("SELECT session_id FROM hobby_pending_checkouts WHERE account_id=?").get(accountId) as {session_id:string}|undefined;
    if(pending?.session_id&&stripeSessionIdMatchesMode(pending.session_id,mode)){
      const verify=await fetch("https://api.stripe.com/v1/checkout/sessions/"+encodeURIComponent(pending.session_id),{headers:{Authorization:"Bearer "+process.env.STRIPE_SECRET_KEY},cache:"no-store",signal:AbortSignal.timeout(10000)});
      if(!verify.ok)return NextResponse.json({error:"Pending Checkout verification unavailable"},{status:503});
      const session=await verify.json() as {id?:string;mode?:string;status?:string;livemode?:boolean;url?:string;expires_at?:number;client_reference_id?:string};
      if(session.status==="complete")return NextResponse.json({error:"Checkout completed; waiting for subscription confirmation."},{status:409});
      try {
        const valid=verifiedReusableHobbyCheckoutSession(session,mode,accountId,{sessionId:pending.session_id,url:existingCheckout.url});
        return NextResponse.json({url:valid.url},{headers:{"Cache-Control":"no-store"}});
      }catch{return NextResponse.json({error:"Pending Checkout could not be verified."},{status:503})}
    }
  }
  const form=new URLSearchParams({"mode":"subscription","line_items[0][price]":process.env.STRIPE_HOBBY_PRICE_ID!,"line_items[0][quantity]":"1","client_reference_id":accountId,"customer_email":account.email,"subscription_data[metadata][singmotionAccountId]":accountId,"subscription_data[metadata][singmotionPlan]":"hobby","metadata[singmotionAccountId]":accountId,"success_url":origin+"/account/settings?checkout=success","cancel_url":origin+"/account/settings?checkout=cancelled"});
  const res=await fetch("https://api.stripe.com/v1/checkout/sessions",{method:"POST",headers:{Authorization:"Bearer "+process.env.STRIPE_SECRET_KEY,"Content-Type":"application/x-www-form-urlencoded","Idempotency-Key":"sm-hobby-"+accountId+"-"+new Date().toISOString().slice(0,13)},body:form,cache:"no-store",signal:AbortSignal.timeout(12000)});
  if(!res.ok)return NextResponse.json({error:"Stripe Checkout unavailable"},{status:502});
  let checkout:{id:string;url:string;expiresAt:number};
  try {checkout=verifiedHobbyCheckoutSession(await res.json(),mode,accountId);}
  catch{return NextResponse.json({error:"Unexpected Stripe Checkout session"},{status:502})}
  store.db.prepare("INSERT INTO hobby_pending_checkouts(account_id,session_id,url,expires_at) VALUES(?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET session_id=excluded.session_id,url=excluded.url,expires_at=excluded.expires_at").run(accountId,checkout.id,checkout.url,checkout.expiresAt);
  return NextResponse.json({url:checkout.url},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"Checkout temporarily unavailable"},{status:503})}finally{store.close()}
}
