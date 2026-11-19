/** Distinct signed event handler for PARTIAL account-deletion refunds.
 * Original prepaid Credit reversals remain full-only; this flow never invokes
 * wallet.reverse() for partial refunds and never edits the customer's spend.
 * The caller MUST authenticate Stripe's webhook signature and independently
 * fetch and verify Refund, Charge and Checkout from the matching Stripe mode.
 */
import type {DatabaseSync} from "node:sqlite";
import {validStripeRefundId} from "./stripe-reversal-identifiers.ts";
import type {StripePaymentMode} from "./stripe-payment-mode.ts";
type Refund={
 id?:string;object?:string;status?:string;amount?:number;currency?:string;
 payment_intent?:string;livemode?:boolean;
 metadata?:{erasure_intent?:string;erasure_purchase?:string}
};
type Session={
 id?:string;payment_intent?:string;mode?:string;payment_status?:string;currency?:string;
 livemode?:boolean;metadata?:{flow?:string;creditTopupId?:string}
};
type Intent={purchase_id:string;account_id:string;session_id:string;state:string;cents:number;refund_id:string|null};
export function reconcileVerifiedErasureRefund(
 db:DatabaseSync,refund:Refund,session:Session,mode:StripePaymentMode
):boolean{
 const has=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='customer_erasure_refund_intents'").get();
 if(!has)return false;
 const marked=refund.metadata?.erasure_intent;
 const purchaseId=refund.metadata?.erasure_purchase;
 if(typeof purchaseId!=="string"||typeof marked!=="string"||
    marked!=="sm-erasure-v1-"+purchaseId)return false;
 const intent=db.prepare("SELECT purchase_id,account_id,session_id,state,cents,refund_id FROM customer_erasure_refund_intents WHERE purchase_id=?")
  .get(purchaseId) as Intent|undefined;
 if(!intent)throw Error("Refund references unknown account-deletion intent");
 const purchase=db.prepare("SELECT subject,credits,cents,status,stripe_session_id FROM credit_topup_purchases WHERE id=?")
  .get(purchaseId) as {subject:string;credits:number;cents:number;status:string;stripe_session_id:string}|undefined;
 if(!purchase||purchase.subject!=="customer:"+intent.account_id||
    purchase.status!=="paid"||purchase.stripe_session_id!==intent.session_id||
    purchase.cents<intent.cents||session.id!==intent.session_id||
    session.payment_intent!==refund.payment_intent||
    session.mode!=="payment"||session.payment_status!=="paid"||session.currency!=="eur"||
    session.livemode!==(mode==="live")||
    session.metadata?.flow!=="singmotion_credit_topup"||
    session.metadata.creditTopupId!==purchaseId||
    !validStripeRefundId(refund.id)||refund.object!=="refund"||
    refund.status!=="succeeded"||refund.currency!=="eur"||
    refund.amount!==intent.cents||
    (refund.livemode!==undefined&&refund.livemode!==(mode==="live"))||
    (intent.refund_id!==null&&intent.refund_id!==refund.id))
  throw Error("Verified erasure refund differs from immutable purchase");
 const update=db.prepare(`UPDATE customer_erasure_refund_intents SET
   state='succeeded',refund_id=?,updated=?
   WHERE purchase_id=? AND state IN ('ready','pending','succeeded')
   AND (refund_id IS NULL OR refund_id=?)`)
  .run(refund.id,Date.now(),purchaseId,refund.id);
 if(update.changes!==1)throw Error("Erasure refund transition was not recorded");
 return true;
}
