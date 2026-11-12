import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {CommerceStore} from "@/lib/commerce/store";
import {CreditWallet,stripeCreditTopupsTestEnabled} from "@/lib/commerce/credit-wallet";
import {resolveCreditWalletIdentity} from "@/lib/commerce/credit-wallet-auth";
import {parseCreditTopup} from "@/lib/commerce/credit-topup-quote";
import {dataDir,limit} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";
import {applicationOrigin} from "@/lib/request-origin";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"}});

/** A separately gated Stripe TEST Checkout, never a live or per-video payment. */
export async function POST(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 if(!stripeCreditTopupsTestEnabled(process.env))
  return json({error:"Credit Test Checkout is not enabled on this environment."},503);
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
    return json({url:purchase.checkoutUrl,purchaseId:purchase.id,testMode:true});
   // Create exactly one Stripe Checkout for this persisted purchase ID. A retry
   // after a timeout returns the same Stripe object via Idempotency-Key.
   const form=new URLSearchParams({
    mode:"payment",
    "line_items[0][price_data][currency]":"eur",
    "line_items[0][price_data][unit_amount]":String(purchase.cents),
    "line_items[0][price_data][product_data][name]":"SingMotion AI Test-Credits",
    "line_items[0][quantity]":"1",
    customer_email:identity.email,
    "metadata[creditTopupId]":purchase.id,
    "metadata[flow]":"singmotion_credit_topup",
    success_url:`${origin}/credits?checkout=success`,
    cancel_url:`${origin}/credits?checkout=cancelled`,
   });
   const response=await fetch("https://api.stripe.com/v1/checkout/sessions",{
    method:"POST",
    headers:{Authorization:"Bearer "+process.env.STRIPE_SECRET_KEY,
     "Content-Type":"application/x-www-form-urlencoded",
     "Idempotency-Key":"singmotion-credit-"+purchase.id},
    body:form,signal:AbortSignal.timeout(8000),cache:"no-store",
   });
   if(!response.ok){
    // Never log the raw Stripe response, customer data or any API credential.
    // Error type/code/parameter are enough to diagnose a rejected TEST request.
    const failure=await response.json().catch(()=>null) as
      {error?:{type?:unknown;code?:unknown;param?:unknown}}|null;
    const detail=failure?.error;
    const safe=(value:unknown)=>typeof value==="string"&&/^[a-zA-Z0-9_.-]{1,90}$/.test(value)?value:null;
    console.error("STRIPE_CREDIT_TEST_CHECKOUT_REJECTED",{
     status:response.status,type:safe(detail?.type),code:safe(detail?.code),
     param:safe(detail?.param),
    });
    return json({error:"Stripe Test Checkout could not be created. No payment was taken."},502);
   }
   const session=await response.json() as {id?:string;url?:string;livemode?:boolean;amount_total?:number;currency?:string;mode?:string};
   if(session.livemode!==false||session.mode!=="payment"||session.amount_total!==purchase.cents||
      session.currency!=="eur"||!session.id||!session.url)
    return json({error:"Stripe Test Checkout verification failed."},502);
   const saved=wallet.bind(purchase.id,session.id,session.url);
   return json({url:saved.checkoutUrl,purchaseId:saved.id,testMode:true});
  }finally{store.close();}
 }catch(e){
  console.error("Credit test checkout failed",{category:e instanceof Error?e.name:"unknown"});
  return json({error:"Credit Test Checkout is temporarily unavailable."},503);
 }
}
