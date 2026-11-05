import {NextRequest,NextResponse} from "next/server";
import {createHmac,timingSafeEqual} from "node:crypto";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {PlanLedger} from "@/lib/commerce/plans";
import {dataDir} from "@/lib/db";
import {configuredStripePaymentMode} from "@/lib/commerce/stripe-payment-mode";
export const runtime="nodejs";export const dynamic="force-dynamic";
function valid(raw:Buffer,signature:string,secret:string){
 const parts=signature.split(",").map(p=>p.trim().split("="));
 const ts=parts.find(p=>p[0]==="t")?.[1]||"",values=parts.filter(p=>p[0]==="v1").map(p=>p[1]);
 if(!/^\d+$/.test(ts)||Math.abs(Date.now()/1000-Number(ts))>300)return false;
 const expected=createHmac("sha256",secret).update(ts+".").update(raw).digest();
 return values.some(v=>/^[a-f0-9]{64}$/i.test(v)&&timingSafeEqual(Buffer.from(v,"hex"),expected));
}
export async function POST(req:NextRequest){
 const secret=process.env.STRIPE_HOBBY_WEBHOOK_SECRET;
 const mode=configuredStripePaymentMode(process.env);
 if(!mode||process.env.HOBBY_SUBSCRIPTIONS_ENABLED!=="true"||
    !secret||!/^whsec_[A-Za-z0-9_]+$/.test(secret))
  return NextResponse.json({error:"Unavailable"},{status:503});
 const expectedLive=mode==="live";
 const raw=Buffer.from(await req.arrayBuffer());if(raw.length>128*1024)return NextResponse.json({error:"Payload too large"},{status:413});
 if(!valid(raw,req.headers.get("stripe-signature")||"",secret))return NextResponse.json({error:"Invalid signature"},{status:400});
 const event=JSON.parse(raw.toString("utf8")) as {id?:string;livemode?:boolean;type?:string;data?:{object?:Record<string,unknown>}};
 if(event.livemode!==expectedLive||!event.id?.startsWith("evt_"))return NextResponse.json({error:"Invalid event"},{status:400});
 if(!["customer.subscription.created","customer.subscription.updated","customer.subscription.deleted","invoice.paid","invoice.payment_failed"].includes(event.type||""))return NextResponse.json({received:true});
 const obj=event.data?.object;
 const invoiceSubscription=event.type?.startsWith("invoice.")?(typeof obj?.subscription==="string"?obj.subscription:(obj?.parent as {subscription_details?:{subscription?:string}}|undefined)?.subscription_details?.subscription):undefined;
 const subId=event.type?.startsWith("invoice.")?invoiceSubscription:obj?.id;
 if(typeof subId!=="string"||!subId.startsWith("sub_"))return NextResponse.json({received:true});
 // Read fresh state from Stripe, not a potentially outdated out-of-order webhook payload.
 const response=await fetch("https://api.stripe.com/v1/subscriptions/"+encodeURIComponent(subId)+"?expand%5B%5D=latest_invoice",{headers:{Authorization:"Bearer "+process.env.STRIPE_SECRET_KEY},cache:"no-store",signal:AbortSignal.timeout(10000)});
 if(!response.ok)return NextResponse.json({error:"Subscription verification unavailable"},{status:503});
 const current=await response.json() as {id:string;livemode:boolean;status:string;metadata?:Record<string,string>;items?:{data?:{price?:{id?:string}}[]};current_period_start?:number;current_period_end?:number;latest_invoice?:{paid?:boolean;status?:string;lines?:{data?:{price?:{id?:string};period?:{start?:number;end?:number}}[]}}|string;cancel_at_period_end?:boolean};
 if(current.livemode!==expectedLive||current.id!==subId)return NextResponse.json({error:"Invalid Stripe subscription"},{status:400});
 const accountId=current.metadata?.singmotionAccountId;
 if(typeof accountId!=="string"||!accountId||current.metadata?.singmotionPlan!=="hobby"||!current.items?.data?.some(x=>x.price?.id===process.env.STRIPE_HOBBY_PRICE_ID))return NextResponse.json({received:true});
 const item=current.items?.data?.[0] as {current_period_start?:number;current_period_end?:number}|undefined;
 const periodEnd=Number(item?.current_period_end||current.current_period_end||0)*1000;
 const periodStart=Number(item?.current_period_start||current.current_period_start||0)*1000;
 const invoice=typeof current.latest_invoice==="object"?current.latest_invoice:null;
 const paidPeriod=invoice?.paid===true&&invoice.status==="paid"&&invoice.lines?.data?.some(line=>line.price?.id===process.env.STRIPE_HOBBY_PRICE_ID&&Number(line.period?.end)*1000>=periodEnd);
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
