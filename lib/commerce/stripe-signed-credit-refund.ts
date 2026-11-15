import type {CreditWallet} from "./credit-wallet.ts";
import type {StripePaymentMode} from "./stripe-payment-mode.ts";
import {stripeSessionIdMatchesMode} from "./stripe-payment-mode.ts";
import {validStripeRefundId,validStripeChargeId} from "./stripe-reversal-identifiers.ts";

const asObject=(value:unknown):Record<string,unknown>|null=>
 value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null;

/** Recovery for *signed* Stripe snapshot refund.updated events where the
 * merchant's restricted key cannot retrieve the Refund resource.
 * Only a full, succeeded Credit top-up refund is eligible. We still fetch
 * exactly one Checkout Session from Stripe and verify its identity,
 * payment intent, paid status, amount, currency, mode and local wallet binding.
 *
 * This must NEVER be called with unverified or synthesized event JSON.
 */
export function reconcileSignedFullCreditRefund(
 wallet:CreditWallet,signedEvent:unknown,stripeSession:unknown,mode:StripePaymentMode
):boolean {
 const event=asObject(signedEvent);
 const refund=asObject(asObject(event?.data)?.object);
 const session=asObject(stripeSession);
 const metadata=asObject(session?.metadata);
 if(!event||event.type!=="refund.updated"||event.livemode!==(mode==="live")||
    typeof event.id!=="string"||!/^evt_[A-Za-z0-9_]+$/.test(event.id)||
    !refund||refund.object!=="refund"||!validStripeRefundId(refund.id)||
    refund.status!=="succeeded"||!validStripeChargeId(refund.charge)||
    typeof refund.payment_intent!=="string"||
    !/^pi_[A-Za-z0-9_]+$/.test(refund.payment_intent)||
    typeof refund.amount!=="number"||!Number.isSafeInteger(refund.amount)||
    refund.amount<=0||refund.currency!=="eur")
  throw Error("Signed credit refund integrity mismatch");
 if(!session||typeof session.id!=="string"||
    !stripeSessionIdMatchesMode(session.id,mode)||
    session.livemode!==(mode==="live")||session.mode!=="payment"||
    session.payment_status!=="paid"||session.payment_intent!==refund.payment_intent||
    session.currency!=="eur"||session.amount_total!==refund.amount||
    metadata?.flow!=="singmotion_credit_topup"||
    typeof metadata.creditTopupId!=="string"||
    !/^[0-9a-f-]{36}$/i.test(metadata.creditTopupId))
  throw Error("Signed credit refund Checkout mismatch");
 const purchase=wallet.findBySession(session.id);
 if(!purchase)return false; // Never fall back for a different commerce flow.
 if(purchase.id!==metadata.creditTopupId||purchase.cents!==refund.amount)
  throw Error("Signed credit refund wallet binding mismatch");
 wallet.reverse({sessionId:session.id,amount:refund.amount,currency:"eur",
  livemode:mode==="live",kind:"refund"});
 return true; // Including idempotent retries: an already reversed wallet stays reversed.
}
