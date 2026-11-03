import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { CommerceStore } from "@/lib/commerce/store";
import { stripeCheckoutAdapter, verifyStripeSandboxEvent, readBoundedStripeWebhookBody, StripeWebhookPayloadTooLarge, type StripeTestEvent } from "@/lib/commerce/stripe-webhook";
import { dataDir } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type StripeLookup = Record<string, unknown> & {
  id?: string;livemode?: boolean;status?: string;charge?: string;
  payment_intent?: string;currency?:string;mode?:string;payment_status?:string;
  amount?:number;amount_total?:number;data?:StripeLookup[];
};


async function stripeGet(resource:string,key:string){
 if(!/^sk_test_[A-Za-z0-9_]+$/.test(key))throw Error("Stripe sandbox key required");
 const response=await fetch("https://api.stripe.com/v1/"+resource,{
   headers:{Authorization:"Bearer "+key},cache:"no-store",signal:AbortSignal.timeout(8000),
 });
 if(!response.ok)throw Error("Stripe verification request failed");
 return await response.json() as StripeLookup;
}
async function reconcileReversal(store:CommerceStore,event:StripeTestEvent){
 const key=process.env.STRIPE_SECRET_KEY||"";
 const object=event.data?.object;
 if(!object||typeof object.id!=="string")throw Error("Missing reversal object");
 const refund=event.type==="refund.created"||event.type==="refund.updated";
 const dispute=event.type==="charge.dispute.created";
 if(!refund&&!dispute)throw Error("Unsupported reversal");
 if(!new RegExp(refund?"^re_[A-Za-z0-9_]+$":"^dp_[A-Za-z0-9_]+$").test(object.id))
   throw Error("Invalid reversal ID");
 const verified=await stripeGet((refund?"refunds/":"disputes/")+encodeURIComponent(object.id),key);
 if(verified.livemode!==false||verified.id!==object.id)throw Error("Reversal mismatch");
 if(refund&&verified.status!=="succeeded")return; // No release on pending/failed refunds.
 if(dispute&&!["needs_response","under_review","warning_needs_response","lost"].includes(verified.status))
   return;
 if(typeof verified.charge!=="string"||!/^ch_[A-Za-z0-9_]+$/.test(verified.charge))
   throw Error("Charge reference missing");
 const charge=await stripeGet("charges/"+encodeURIComponent(verified.charge),key);
 if(charge.livemode!==false||charge.id!==verified.charge||
    typeof charge.payment_intent!=="string")throw Error("Charge verification failed");
 const sessions=await stripeGet("checkout/sessions?payment_intent="+encodeURIComponent(charge.payment_intent)+"&limit=2",key);
 if(!Array.isArray(sessions.data)||sessions.data.length!==1)throw Error("Checkout reconciliation ambiguous");
 const session=sessions.data[0];
 if(session.livemode!==false||session.mode!=="payment"||
   !/^cs_test_[A-Za-z0-9_]+$/.test(session.id)||
   session.payment_status!=="paid"||
   session.payment_intent!==charge.payment_intent||
   session.currency!=="eur"||
   !Number.isSafeInteger(session.amount_total)||
   session.amount_total!==charge.amount||
   charge.currency!=="eur")
   throw Error("Checkout payment and charge mismatch");
 const bound=store.db.prepare("SELECT order_id FROM stripe_checkout_sessions WHERE session_id=?").get(session.id) as {order_id:string}|undefined;
 if(!bound)throw Error("Checkout is not bound to an order");
 const evidence="verified-stripe-"+event.id+"-"+verified.id;
 if(refund){
   if(!Number.isSafeInteger(verified.amount)||verified.amount!==charge.amount||
     verified.currency!=="eur")throw Error("Full-refund verification required");
   store.reconcileVerifiedStripeRefund({orderId:bound.order_id,stripeCheckoutId:session.id,
     refundId:verified.id,refundedCents:verified.amount,evidence});
 }else{
   store.reconcileVerifiedStripeDispute({orderId:bound.order_id,stripeCheckoutId:session.id,
     disputeId:verified.id,evidence});
 }
}

export async function POST(req: NextRequest) {
  // Fail closed until a test-mode Stripe webhook signing secret is installed.
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || process.env.STRIPE_CHECKOUT_ENABLED !== "true")
    return NextResponse.json({ error: "Stripe Checkout is disabled." }, { status: 503 });
  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  let store: CommerceStore | undefined;
  try {
    const raw = await readBoundedStripeWebhookBody(req);
    store = new CommerceStore(path.join(dataDir, "commerce.sqlite"));
    const event=verifyStripeSandboxEvent(raw,signature,secret);
    if(event.type==="checkout.session.completed")
      await store.webhook(raw,signature,stripeCheckoutAdapter(secret));
    else if(["refund.created","refund.updated","charge.dispute.created"].includes(event.type))
      await reconcileReversal(store,event);
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
