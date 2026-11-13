/** Privileged full Stripe refund, never called on page load or by an automatic
 * provider retry. Requires a trusted CMS Super Admin, explicit typed
 * confirmation, an auditable reason, terminal failure/no delivery, and the
 * exact bound Checkout session. Stable Stripe idempotency survives timeouts. */
import type {CommerceStore} from "./store.ts";
import {SupportCases} from "./support-cases.ts";
import {configuredStripeReversalMode,customerStripeCredential,type StripePaymentMode} from "./stripe-payment-mode.ts";

type StripeSession={
 id?:string;livemode?:boolean;mode?:string;payment_status?:string;
 amount_total?:number;currency?:string;payment_intent?:string;
 metadata?:{orderId?:string};
};
type StripeRefund={
 id?:string;object?:string;livemode?:boolean;payment_intent?:string;
 amount?:number;currency?:string;status?:string;
};
type Env=Record<string,string|undefined>;
const idOk=(v:string)=>/^[a-f0-9-]{36}$/i.test(v);
async function stripeRequest<T>(path:string,key:string,method:"GET"|"POST",params?:URLSearchParams,sender:typeof fetch=fetch):Promise<T>{
 const response=await sender("https://api.stripe.com/v1/"+path,{
  method,headers:{Authorization:"Bearer "+key,
    ...(method==="POST"?{"Content-Type":"application/x-www-form-urlencoded"}:{}) ,
    ...(method==="POST"&&path==="refunds"?{"Idempotency-Key":"singmotion-support-full-refund-"+params?.get("metadata[support_order_id]")}:{})},
  ...(method==="POST"?{body:params}:{}),
  signal:AbortSignal.timeout(12000),cache:"no-store",
 });
 if(!response.ok)throw Error("Stripe refused the refund request; check the existing refund intent before retrying.");
 return response.json() as Promise<T>;
}
export async function requestSupportStripeRefund(
 store:CommerceStore,orderId:string,actor:string,reason:string,confirmation:string,
 env:Env=process.env,sender:typeof fetch=fetch,
):Promise<{status:"succeeded"|"pending";refundId:string}>{
 if(!idOk(orderId)||confirmation!=="REFUND "+orderId.toUpperCase())
  throw Error("Type REFUND followed by the full order ID to authorize a Stripe refund.");
 const cases=new SupportCases(store.db);
 const intent=cases.beginStripeRefund(orderId,actor,reason,"");
 if(intent.status==="succeeded"){
  if(!intent.refund_id)throw Error("Recorded refund is missing its identity");
  return {status:"succeeded",refundId:intent.refund_id};
 }
 if(intent.status==="failed")throw Error("Existing failed Stripe refund needs financial reconciliation before another attempt.");
 const mode:StripePaymentMode=intent.checkout_session.startsWith("cs_live_")?"live":"test";
 if(!intent.checkout_session.startsWith("cs_"+mode+"_"))
  throw Error("Invalid bound Checkout session");
 if(configuredStripeReversalMode(env)!==mode)
  throw Error("Stripe refund account is not configured for this Checkout mode.");
 const key=customerStripeCredential(env,mode);
 if(!key)throw Error("Matching Stripe refund key unavailable.");
 const session=await stripeRequest<StripeSession>(
  "checkout/sessions/"+encodeURIComponent(intent.checkout_session),key,"GET",undefined,sender);
 if(session.id!==intent.checkout_session||session.livemode!==(mode==="live")||
   session.mode!=="payment"||session.payment_status!=="paid"||
   session.currency!=="eur"||session.amount_total!==intent.amount_cents||
   !session.metadata||session.metadata.orderId!==orderId||
   typeof session.payment_intent!=="string"||!/^pi_[A-Za-z0-9_]+$/.test(session.payment_intent))
  throw Error("Stripe Checkout payment integrity mismatch; refund not issued.");
 // Once Stripe has returned a refund ID in a prior attempt, only inspect that
 // same refund. Never create a replacement refund implicitly.
 const refund=intent.refund_id
  ?await stripeRequest<StripeRefund>("refunds/"+encodeURIComponent(intent.refund_id),key,"GET",undefined,sender)
  :await stripeRequest<StripeRefund>("refunds",key,"POST",new URLSearchParams({
     payment_intent:session.payment_intent,amount:String(intent.amount_cents),
     "metadata[support_order_id]":orderId,
   }),sender);
 if(!refund||typeof refund.id!=="string"||!/^re_[A-Za-z0-9_]+$/.test(refund.id)||
    refund.object!=="refund"||refund.livemode!==(mode==="live")||
    refund.payment_intent!==session.payment_intent||
    refund.amount!==intent.amount_cents||refund.currency!=="eur")
  throw Error("Stripe refund response did not match the original paid order.");
 if(refund.status==="succeeded"){
  // Uses the same verified ledger path as signed Stripe refund webhooks.
  store.reconcileVerifiedStripeRefund({
   orderId,stripeCheckoutId:intent.checkout_session,
   refundId:refund.id,refundedCents:intent.amount_cents,
   evidence:"verified-operator-stripe-refund-"+refund.id+"-"+orderId,
  });
  const info=cases.lookup(orderId,"");
  cases.enqueue(orderId,"stripe-refunded",info?.customerEmail??null,actor,reason);
  return {status:"succeeded",refundId:refund.id};
 }
 if(refund.status==="pending"||refund.status==="requires_action"){
  cases.updateRefundIntent(orderId,refund.id,"pending");
  return {status:"pending",refundId:refund.id};
 }
 cases.updateRefundIntent(orderId,refund.id,"failed");
 throw Error("Stripe refund did not succeed; the original payment must be checked manually.");
}
