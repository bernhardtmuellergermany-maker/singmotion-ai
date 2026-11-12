import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {CommerceStore} from "@/lib/commerce/store";
import {CreditWallet,stripeCreditTopupsTestEnabled,stripeCreditTopupsLiveEnabled} from "@/lib/commerce/credit-wallet";
import {resolveCreditWalletIdentity} from "@/lib/commerce/credit-wallet-auth";
import {parseCreditTopup} from "@/lib/commerce/credit-topup-quote";
import {dataDir,limit} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";
import {applicationOrigin} from "@/lib/request-origin";
import {customerLaunchReadiness} from "@/lib/commerce/readiness";
import {auditSingMotionLaunch} from "@/lib/launch-audit";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"}});

/** A separately gated Stripe TEST Checkout, never a live or per-video payment. */
export async function POST(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 const testMode=stripeCreditTopupsTestEnabled(process.env);
 const liveMode=stripeCreditTopupsLiveEnabled(process.env)&&
  customerLaunchReadiness().readyForPaidOrders&&
  auditSingMotionLaunch(process.env,"production").ready;
 if(!testMode&&!liveMode)
  return json({error:"Credit Checkout is not enabled on this environment."},503);
 const origin=applicationOrigin(req.url,req.headers.get("host"));
 if(!origin||req.headers.get("origin")!==origin)return json({error:"Invalid request origin."},403);
 try{
  limit("credit-test-checkout",12,60000);
  if(Number(req.headers.get("content-length"))>1024)return json({error:"Request too large."},413);
  const raw=await req.text();if(Buffer.byteLength(raw)>1024)return json({error:"Request too large."},413);
  const body=JSON.parse(raw) as {credits?:unknown;requestKey?:unknown};
  if(typeof body.credits!=="string"||typeof body.requestKey!=="string")
   return json({error:"Enter a valid credit amount."},400);
  const credits=parseCreditTopup(body.credits);
  if(credits===null||!/^[0-9a-f-]{36}$/i.test(body.requestKey))
   return json({error:"Enter 500–100,000 whole credits."},400);
  const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
  try{
   const identity=await resolveCreditWalletIdentity(req,store);
   if(!identity)return json({error:"Customer login required."},401);
   if(identity.customerId && !store.emailVerified(identity.customerId))
    return json({error:"Verify your customer email before purchasing."},403);
   const wallet=new CreditWallet(store.db);
   const purchase=wallet.pending(identity,credits,body.requestKey);
   if(purchase.status==="paid"||purchase.status==="reversed")
    return json({error:"This top-up request was already settled. Start a new purchase."},409);
   if(purchase.sessionId&&purchase.checkoutUrl)
    return json({url:purchase.checkoutUrl,purchaseId:purchase.id,testMode});
   // Create exactly one Stripe Checkout for this persisted purchase ID. A retry
   // after a timeout returns the same Stripe object via Idempotency-Key.
   const form=new URLSearchParams({
    mode:"payment",
    "invoice_creation[enabled]":"true",
    // Sandbox ONLY: this account defaults to Stripe Managed Payments. Without
    // a legally reviewed product tax_code, its merchant-of-record flow returns
    // HTTP 400. Disable that optional flow explicitly for staging TEST
    // purchases; production is hard-blocked by stripeCreditTopupsTestEnabled.
    // Do not reuse this setting for future live credit sales without tax review.
    ...(testMode?{"managed_payments[enabled]":"false"}:{}),
    // Stripe API 2026-09-30+ rejects payment_method_types with HTTP 400.
    // Use Dashboard-configured dynamic payment methods (cards enabled in sandbox).
    "line_items[0][price_data][currency]":"eur",
    "line_items[0][price_data][unit_amount]":String(purchase.cents),
    "line_items[0][price_data][product_data][name]":testMode?"SingMotion AI Test-Credits":"SingMotion AI Prepaid Credits",
    "line_items[0][quantity]":"1",
    customer_email:identity.email,
    "metadata[creditTopupId]":purchase.id,
    "metadata[flow]":"singmotion_credit_topup",
    success_url:`${origin}/credits?checkout=success`,
    cancel_url:`${origin}/credits?checkout=cancelled`,
   });
   if(liveMode){
    // Live billing must collect a valid address, use Stripe Tax, and attach
    // the merchant-reviewed tax code before permitting a real charge.
    form.set("billing_address_collection","required");
    form.set("automatic_tax[enabled]","true");
    form.set("line_items[0][price_data][product_data][tax_code]",process.env.STRIPE_CREDIT_TAX_CODE!);
   }
   const response=await fetch("https://api.stripe.com/v1/checkout/sessions",{
    method:"POST",
    headers:{Authorization:"Bearer "+process.env.STRIPE_SECRET_KEY,
     "Content-Type":"application/x-www-form-urlencoded",
     "Idempotency-Key":"singmotion-credit-"+purchase.id},
    body:form,signal:AbortSignal.timeout(8000),cache:"no-store",
   });
   if(!response.ok){
    // Never log the raw Stripe response, customer data or any API credential.
    // Parse only selected diagnostic fields from the rejected TEST response.
    const failure=await response.json().catch(()=>null) as
      {error?:{type?:unknown;code?:unknown;param?:unknown}}|null;
    const detail=failure?.error as {type?:unknown;code?:unknown;param?:unknown;message?:unknown}|undefined;
    const safe=(value:unknown)=>typeof value==="string"&&/^[a-zA-Z0-9_.-]{1,90}$/.test(value)?value:null;
    // Stripe's generic invalid_request_error may contain no code or param.
    // Preserve a redacted message and Stripe request ID in PRIVATE staging
    // runtime logs so operations can diagnose the actual rejection. Never
    // expose raw error bodies, emails, session IDs, secrets or card data.
    const message=typeof detail?.message==="string"?detail.message.slice(0,400)
      .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g,"[email]")
      .replace(/https?:\/\/[^\s]+/gi,"[url]")
      .replace(/(?:sk|pk|rk)_(?:test|live)_[A-Za-z0-9_]+|whsec_[A-Za-z0-9_]+/g,"[secret]")
      .replace(/\b(?:acct|cus|cs|pi|pm|ch|req|evt|seti)_[A-Za-z0-9_]+\b/g,"[identifier]")
      .replace(/\b[0-9]{8,}\b/g,"[number]"):null;
    const requestId=safe(response.headers.get("request-id")||response.headers.get("stripe-request-id"));
    console.error("STRIPE_CREDIT_TEST_CHECKOUT_REJECTED",{
     status:response.status,type:safe(detail?.type),code:safe(detail?.code),
     param:safe(detail?.param),message,requestId,
    });
    return json({error:"Stripe Test Checkout could not be created. No payment was taken.",
      ...(requestId?{supportReference:requestId}:{})},502);
   }
   const session=await response.json() as {id?:string;url?:string;livemode?:boolean;amount_total?:number;currency?:string;mode?:string};
   if(session.livemode!==liveMode||session.mode!=="payment"||session.amount_total!==purchase.cents||
      session.currency!=="eur"||!session.id||!session.url)
    return json({error:"Stripe Checkout verification failed."},502);
   const saved=wallet.bind(purchase.id,session.id,session.url);
   return json({url:saved.checkoutUrl,purchaseId:saved.id,testMode});
  }finally{store.close();}
 }catch(e){
  console.error("Credit test checkout failed",{category:e instanceof Error?e.name:"unknown"});
  return json({error:"Credit Test Checkout is temporarily unavailable."},503);
 }
}
