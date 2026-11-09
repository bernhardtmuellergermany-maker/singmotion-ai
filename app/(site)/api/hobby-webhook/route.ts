import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {PlanLedger} from "@/lib/commerce/plans";
import {dataDir} from "@/lib/db";
import {configuredStripePaymentMode,configuredStripeReversalMode} from "@/lib/commerce/stripe-payment-mode";
import {pausedHobbyWebhookAction} from "@/lib/commerce/stripe-hobby-pause-policy";
import {hobbyInvoicePaidThrough} from "@/lib/commerce/stripe-hobby-invoice";
import {readBoundedStripeWebhookBody,StripeWebhookPayloadTooLarge,verifyStripePaymentEvent} from "@/lib/commerce/stripe-webhook";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(req:NextRequest){
 const secret=process.env.STRIPE_HOBBY_WEBHOOK_SECRET;
 // A checkout shutdown must not block cancellation/expiry reconciliation
 // for already-bound subscriptions. This mode is read-only for Stripe and
 // cannot authorize a new subscription or entitlement.
 const checkoutMode=configuredStripePaymentMode(process.env);
 const mode=checkoutMode||configuredStripeReversalMode(process.env);
 const settlementEnabled=!!checkoutMode&&process.env.HOBBY_SUBSCRIPTIONS_ENABLED==="true";
 if(!mode||!secret||!/^whsec_[A-Za-z0-9_]+$/.test(secret))
  return NextResponse.json({error:"Unavailable"},{status:503});
 const expectedLive=mode==="live";
 let event:{id?:string;livemode?:boolean;type?:string;data?:{object?:Record<string,unknown>}};
 try {
  const raw=await readBoundedStripeWebhookBody(req);
  event=verifyStripePaymentEvent(raw,req.headers.get("stripe-signature")||"",secret,mode) as typeof event;
 }catch(error){
  if(error instanceof StripeWebhookPayloadTooLarge)return NextResponse.json({error:"Payload too large"},{status:413});
  return NextResponse.json({error:"Invalid signed webhook"},{status:400});
 }
 if(!["customer.subscription.created","customer.subscription.updated","customer.subscription.deleted","invoice.paid","invoice.payment_failed"].includes(event.type||""))return NextResponse.json({received:true});
 const obj=event.data?.object;
 const invoiceSubscription=event.type?.startsWith("invoice.")?(typeof obj?.subscription==="string"?obj.subscription:(obj?.parent as {subscription_details?:{subscription?:string}}|undefined)?.subscription_details?.subscription):undefined;
 const subId=event.type?.startsWith("invoice.")?invoiceSubscription:obj?.id;
 if(typeof subId!=="string"||!subId.startsWith("sub_"))return NextResponse.json({received:true});
 // Read fresh state from Stripe, not a potentially outdated out-of-order webhook payload.
 const response=await fetch("https://api.stripe.com/v1/subscriptions/"+encodeURIComponent(subId)+"?expand%5B%5D=latest_invoice",{headers:{Authorization:"Bearer "+process.env.STRIPE_SECRET_KEY},cache:"no-store",signal:AbortSignal.timeout(10000)});
 if(!response.ok)return NextResponse.json({error:"Subscription verification unavailable"},{status:503});
 const current=await response.json() as {id:string;livemode:boolean;status:string;metadata?:Record<string,string>;items?:{data?:{price?:{id?:string};current_period_start?:number;current_period_end?:number}[]};current_period_start?:number;current_period_end?:number;latest_invoice?:{paid?:boolean;status?:string;lines?:{data?:{price?:string|{id?:string};pricing?:{type?:string;price_details?:{price?:string|{id?:string}}};period?:{start?:number;end?:number}}[]}}|string;cancel_at_period_end?:boolean};
 if(current.livemode!==expectedLive||current.id!==subId)return NextResponse.json({error:"Invalid Stripe subscription"},{status:400});
 const accountId=current.metadata?.singmotionAccountId;
 if(typeof accountId!=="string"||!accountId||current.metadata?.singmotionPlan!=="hobby"||!current.items?.data?.some(x=>x.price?.id===process.env.STRIPE_HOBBY_PRICE_ID))return NextResponse.json({received:true});
 const item=current.items?.data?.[0] as {current_period_start?:number;current_period_end?:number}|undefined;
 const periodEnd=Number(item?.current_period_end||current.current_period_end||0)*1000;
 const periodStart=Number(item?.current_period_start||current.current_period_start||0)*1000;
 const invoice=typeof current.latest_invoice==="object"?current.latest_invoice:null;
 const paidPeriod=hobbyInvoicePaidThrough(invoice,process.env.STRIPE_HOBBY_PRICE_ID||"",periodEnd);
 const paidThrough=paidPeriod?periodEnd:0;
 const status=current.status==="active"&&periodStart>0&&periodStart<=Date.now()&&periodEnd>Date.now()&&paidThrough>=periodEnd?"active":"inactive";
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try{
  new PlanLedger(store.db);
  const exists=store.db.prepare("SELECT 1 FROM customer_accounts WHERE id=?").get(accountId);
  if(!exists)return NextResponse.json({received:true});
  // A delayed webhook for a previous subscription must not overwrite a newer
  // Stripe subscription or reinstate an expired billing period.
  const previous=store.db.prepare("SELECT provider_subscription_id,current_period_start,current_period_end,status FROM customer_subscriptions WHERE account_id=?").get(accountId) as {provider_subscription_id:string|null;current_period_start:number;current_period_end:number;status:string}|undefined;
  const action=pausedHobbyWebhookAction(settlementEnabled,status,previous?.provider_subscription_id,current.id);
  // A signed later payment must be retried, not silently acknowledged.
  // A paused system may revoke only the exact subscription it previously
  // bound; no new entitlement or unrelated account mapping can be inserted.
  if(action==="retry")return NextResponse.json({error:"Hobby settlement paused"},{status:503});
  if(action==="ignore")return NextResponse.json({received:true});
  if(previous){
   if(previous.provider_subscription_id!==current.id && previous.status==="active" && previous.current_period_end>Date.now())
     return NextResponse.json({received:true});
   if(previous.provider_subscription_id===current.id && previous.current_period_start>periodStart)
     return NextResponse.json({received:true});
  }
  store.db.prepare("INSERT INTO customer_subscriptions(account_id,plan,provider,provider_subscription_id,status,current_period_end,updated_at,current_period_start,paid_through) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET plan=excluded.plan,provider=excluded.provider,provider_subscription_id=excluded.provider_subscription_id,status=excluded.status,current_period_end=excluded.current_period_end,current_period_start=excluded.current_period_start,paid_through=excluded.paid_through,updated_at=excluded.updated_at").run(accountId,"hobby","stripe",current.id,status,periodEnd,Date.now(),periodStart,paidThrough);
  return NextResponse.json({received:true});
 }finally{store.close()}
}
