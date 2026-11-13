import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { CommerceStore } from "@/lib/commerce/store";
import {SupportCases} from "@/lib/commerce/support-cases";
import { CreditWallet, stripeCreditWebhookTestEnabled, stripeCreditTopupsLiveEnabled } from "@/lib/commerce/credit-wallet";
import { stripeCheckoutAdapter, verifyStripePaymentEvent, readBoundedStripeWebhookBody, StripeWebhookPayloadTooLarge, type StripeTestEvent } from "@/lib/commerce/stripe-webhook";
import { dataDir } from "@/lib/db";
import {ensurePaidContractConfirmation} from "@/lib/commerce/contract-confirmation";
import {configuredStripePaymentMode,configuredStripeReversalMode,stripeWebhookEventAdmitted,stripeSessionIdMatchesMode,stripeKeyMatchesMode,customerStripeCredential,customerStripeWebhookSecret,privateProductionSandboxSettlementAllowed,type StripePaymentMode} from "@/lib/commerce/stripe-payment-mode";
import {auditSingMotionLaunch} from "@/lib/launch-audit";
import {protectedProductionLivePilotApproved} from "@/lib/commerce/protected-production-live-pilot";
import {privateCreditPilotApproved} from "@/lib/commerce/private-credit-pilot";
import {customerLaunchReadiness} from "@/lib/commerce/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type StripeLookup = Record<string, unknown> & {
  id?: string;livemode?: boolean;status?: string;charge?: string;
  payment_intent?: string;currency?:string;mode?:string;payment_status?:string;
  amount?:number;amount_total?:number;data?:StripeLookup[];
};


async function stripeGet(resource:string,key:string,mode:StripePaymentMode){
 if(!stripeKeyMatchesMode(key,mode))throw Error("Matching Stripe environment key required");
 const response=await fetch("https://api.stripe.com/v1/"+resource,{
   headers:{Authorization:"Bearer "+key},cache:"no-store",signal:AbortSignal.timeout(8000),
 });
 if(!response.ok)throw Error("Stripe verification request failed");
 return await response.json() as StripeLookup;
}
/** Verify the signed credit event against Stripe's own paid Checkout record. */
async function reconcileCreditPurchase(store:CommerceStore,event:StripeTestEvent,mode:StripePaymentMode){
 if(mode==="test"&&!stripeCreditWebhookTestEnabled(process.env)||
    mode==="live"&&!stripeCreditTopupsLiveEnabled(process.env))
  throw Error("Credit webhook settlement unavailable");
 const obj=event.data?.object;
 const metadata=obj?.metadata as Record<string,unknown>|undefined;
 const id=typeof metadata?.creditTopupId==="string"?metadata.creditTopupId:"";
 if(metadata?.flow!=="singmotion_credit_topup"||!/^[0-9a-f-]{36}$/i.test(id)||
    typeof obj?.id!=="string"||!stripeSessionIdMatchesMode(obj.id,mode))
  throw Error("Invalid credit top-up metadata");
 const key=customerStripeCredential(process.env,mode);
 if(!key)throw Error("Stripe key unavailable");
 const session=await stripeGet("checkout/sessions/"+encodeURIComponent(obj.id),key,mode);
 const verifiedMetadata=session.metadata as Record<string,unknown>|undefined;
 if(session.id!==obj.id||session.mode!=="payment"||session.livemode!==(mode==="live")||
    verifiedMetadata?.flow!=="singmotion_credit_topup"||verifiedMetadata.creditTopupId!==id)
  throw Error("Credit Checkout session integrity mismatch");
 if(session.payment_status!=="paid"){
  // An asynchronous payment may still be unpaid. It does not grant credits.
  return;
 }
 if(mode==="live"){
  const prior=new CreditWallet(store.db).taxContext(id);
  if(prior?.mode==="stripe-managed-payments"&&
     (session.managed_payments as {enabled?:boolean}|undefined)?.enabled!==true)
   throw Error("STRIPE_MANAGED_PAYMENTS_MERCHANT_OF_RECORD_NOT_VERIFIED");
  const details=session.customer_details as {
   address?:{country?:string};tax_ids?:Array<{type?:string;value?:string}>
  }|undefined;
  if(!prior||prior.country!==verifiedMetadata.creditTaxCountry||
     prior.buyerType!==verifiedMetadata.creditTaxBuyerType||
     prior.voucherKind!==verifiedMetadata.creditVoucherKind||
     prior.mode!==verifiedMetadata.creditTaxMode||
     prior.revision!==verifiedMetadata.creditTaxRevision||
     details?.address?.country!==prior.country||
     (prior.buyerType==="business"&&(!Array.isArray(details.tax_ids)||details.tax_ids.length===0)))
   throw Error("CREDIT_TAX_LOCATION_OR_BUSINESS_PROOF_MISMATCH");
  // Country or business proof disagreement never grants spendable credits.
  // Preserve the verified paid event for a manually reviewed refund.
 }
 const wallet=new CreditWallet(store.db);
 wallet.settle({id,sessionId:obj.id,amount:Number(session.amount_total),
  currency:String(session.currency||""),paymentStatus:String(session.payment_status),livemode:mode==="live"});
}

async function reconcileReversal(store:CommerceStore,event:StripeTestEvent,mode:StripePaymentMode){
 const key=customerStripeCredential(process.env,mode)||"";
 const object=event.data?.object;
 if(!object||typeof object.id!=="string")throw Error("Missing reversal object");
 const refund=event.type==="refund.created"||event.type==="refund.updated";
 const dispute=event.type==="charge.dispute.created";
 if(!refund&&!dispute)throw Error("Unsupported reversal");
 if(!new RegExp(refund?"^re_[A-Za-z0-9_]+$":"^dp_[A-Za-z0-9_]+$").test(object.id))
   throw Error("Invalid reversal ID");
 const verified=await stripeGet((refund?"refunds/":"disputes/")+encodeURIComponent(object.id),key,mode);
 if(verified.livemode!==(mode==="live")||typeof verified.id!=="string"||verified.id!==object.id)throw Error("Reversal mismatch");
 if(refund&&verified.status!=="succeeded")return; // No release on pending/failed refunds.
 if(dispute&&!["needs_response","under_review","warning_needs_response","lost"].includes(verified.status||""))
   return;
 if(typeof verified.charge!=="string"||!/^ch_[A-Za-z0-9_]+$/.test(verified.charge))
   throw Error("Charge reference missing");
 const charge=await stripeGet("charges/"+encodeURIComponent(verified.charge),key,mode);
 if(charge.livemode!==(mode==="live")||charge.id!==verified.charge||
    typeof charge.payment_intent!=="string")throw Error("Charge verification failed");
 const sessions=await stripeGet("checkout/sessions?payment_intent="+encodeURIComponent(charge.payment_intent)+"&limit=2",key,mode);
 if(!Array.isArray(sessions.data)||sessions.data.length!==1)throw Error("Checkout reconciliation ambiguous");
 const session=sessions.data[0];
 if(session.livemode!==(mode==="live")||session.mode!=="payment"||
   typeof session.id!=="string"||
   !stripeSessionIdMatchesMode(session.id,mode)||
   session.payment_status!=="paid"||
   session.payment_intent!==charge.payment_intent||
   session.currency!=="eur"||
   !Number.isSafeInteger(session.amount_total)||
   session.amount_total!==charge.amount||
   charge.currency!=="eur")
   throw Error("Checkout payment and charge mismatch");
 const bound=store.db.prepare("SELECT order_id FROM stripe_checkout_sessions WHERE session_id=?").get(session.id) as {order_id:string}|undefined;
 if(!bound && ((mode==="test" &&
    process.env.RAILWAY_ENVIRONMENT_ID==="dfaeabed-03df-43ed-aa71-50f343a75041")||
    (mode==="live"&&process.env.RAILWAY_ENVIRONMENT_ID==="36adc41d-7e54-4396-ad1a-fd432ba0441d"))){
  const wallet=new CreditWallet(store.db);
  if(wallet.findBySession(session.id)){
   if(refund && (verified.amount!==charge.amount||verified.currency!=="eur"))
    throw Error("Full credit top-up refund required");
   wallet.reverse({sessionId:session.id,amount:Number(session.amount_total),
    currency:String(session.currency||""),livemode:mode==="live",kind:refund?"refund":"dispute"});
   return;
  }
 }
 if(!bound)throw Error("Checkout is not bound to an order");
 const evidence="verified-stripe-"+event.id+"-"+verified.id;
 if(refund){
   if(typeof verified.amount!=="number"||!Number.isSafeInteger(verified.amount)||verified.amount!==charge.amount||
     verified.currency!=="eur")throw Error("Full-refund verification required");
   store.reconcileVerifiedStripeRefund({orderId:bound.order_id,stripeCheckoutId:session.id,
     refundId:verified.id,refundedCents:verified.amount,evidence});
   // A previously approved Super Admin full refund can complete via webhook
   // after an API timeout, without relying on the admin staying online.
   const support=new SupportCases(store.db);
   const intent=support.refundIntent(bound.order_id);
   if(intent&&intent.refund_id===verified.id&&intent.status==="succeeded"){
     const order=support.lookup(bound.order_id,"");
     support.enqueue(bound.order_id,"stripe-refunded",order?.customerEmail??null,
       intent.actor,intent.reason);
   }
 }else{
   store.reconcileVerifiedStripeDispute({orderId:bound.order_id,stripeCheckoutId:session.id,
     disputeId:verified.id,evidence});
 }
}

export async function POST(req: NextRequest) {
  // Never receive live orders unless the separate Production release audit
  // has verified paid fulfillment, private output and all human approvals.
  const checkoutMode=configuredStripePaymentMode(process.env);
  // Independently authenticated reversal processing survives a checkout stop.
  // It cannot enable a new payment or provider submission.
  const mode=checkoutMode||configuredStripeReversalMode(process.env);
  // The private Production TEST pilot must pass the exact same readiness gate
  // as Checkout before any new signed paid receipt can be settled. Staging
  // retains its existing test behavior, and signed reversals remain accepted
  // independently after the pilot kill switch is turned off.
  const customerReady=checkoutMode==="test"&&
   process.env.RAILWAY_ENVIRONMENT_ID==="36adc41d-7e54-4396-ad1a-fd432ba0441d"
    ? customerLaunchReadiness().readyForPaidOrders : false;
  const settlementEnabled=!!checkoutMode &&
   privateProductionSandboxSettlementAllowed(process.env,checkoutMode,customerReady) &&
   (checkoutMode!=="live"||(customerLaunchReadiness().readyForPaidOrders&&
     (auditSingMotionLaunch(process.env,"production").ready||
      protectedProductionLivePilotApproved(process.env))));
  const secret=mode?customerStripeWebhookSecret(process.env,mode):null;
  if (!secret || !mode)
    return NextResponse.json({ error: "Stripe webhook verification is unavailable." }, { status: 503 });
  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  let store: CommerceStore | undefined;
  try {
    const raw = await readBoundedStripeWebhookBody(req);
    store = new CommerceStore(path.join(dataDir, "commerce.sqlite"));
    const event=verifyStripePaymentEvent(raw,signature,secret,mode);
    // The independently gated STAGING wallet may settle authenticated TEST
    // purchases even while video fulfillment and public checkout stay blocked.
    if((mode==="test"&&stripeCreditWebhookTestEnabled(process.env)||
        mode==="live"&&(settlementEnabled||privateCreditPilotApproved(process.env))&&stripeCreditTopupsLiveEnabled(process.env))&&
       ["checkout.session.completed","checkout.session.async_payment_succeeded"].includes(event.type||"") &&
       (event.data?.object?.metadata as Record<string,unknown>|undefined)?.flow==="singmotion_credit_topup"){
      await reconcileCreditPurchase(store,event,mode);
      return NextResponse.json({received:true},{headers:{"Cache-Control":"no-store"}});
    }
    if(!stripeWebhookEventAdmitted(event.type,settlementEnabled))
      return NextResponse.json({error:"Stripe payment settlement is paused."},{status:503});
    if(event.type==="checkout.session.completed"||
       event.type==="checkout.session.async_payment_succeeded"){
      // A signed completed Checkout may still be unpaid for delayed methods.
      // Acknowledge without marking paid; Stripe later sends async success.
      if(event.type==="checkout.session.completed"&&
         event.data?.object?.object==="checkout.session"&&
         event.data.object.payment_status==="unpaid")
        return NextResponse.json({received:true},{headers:{"Cache-Control":"no-store"}});
      await store.webhook(raw,signature,stripeCheckoutAdapter(secret,mode));
      // Stripe may replay a signed receipt after an email outage: the contract
      // confirmation is idempotent and the provider remains blocked until sent.
      const paidOrderId=event.data?.object?.metadata?.orderId;
      if(typeof paidOrderId==="string" && /^[a-f0-9-]{36}$/.test(paidOrderId) &&
         store.hasEarlyPerformanceConsent(paidOrderId) &&
         !(await ensurePaidContractConfirmation(store,paidOrderId)))
        return NextResponse.json({error:"Contract confirmation delivery pending."},{status:503});
    }
    else if(["refund.created","refund.updated","charge.dispute.created"].includes(event.type||""))
      await reconcileReversal(store,event,mode);
    // Other signed Stripe events are unrelated to single-video settlement.
    return NextResponse.json({ received: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof StripeWebhookPayloadTooLarge)
      return NextResponse.json({ error: "Webhook payload too large." }, { status: 413 });
    // Never leak private payment or account details into the HTTP response.
    console.error("Stripe webhook reconciliation failed:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Stripe webhook verification or reconciliation failed." }, { status: 400 });
  } finally {
    store?.close();
  }
}
