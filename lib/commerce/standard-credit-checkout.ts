import type {CreditTaxDecision} from "./worldwide-credit-tax.ts";
import type {DatabaseSync} from "node:sqlite";

export const STANDARD_CREDIT_TAX_FLOW="seller-stripe-tax-v1";
/** An explicit business decision, NOT evidence of tax registration or legal review.
 * Existing launch, payment, identity and webhook gates remain independent. */
export function standardCreditCheckoutEnabled(env:Record<string,string|undefined>):boolean{
 return env.CREDIT_STANDARD_STRIPE_CHECKOUT_ENABLED==="true"&&
  env.CREDIT_STANDARD_STRIPE_SELLER_TAX_RESPONSIBILITY_ACCEPTED==="true"&&
  env.STRIPE_CREDIT_TAX_CODE==="txcd_10105003"&&
  env.RAILWAY_ENVIRONMENT_ID==="36adc41d-7e54-4396-ad1a-fd432ba0441d";
}
export function configureStandardCreditCheckout(form:URLSearchParams):void{
 form.set("managed_payments[enabled]","false");
 form.set("automatic_tax[enabled]","true");
 form.set("invoice_creation[enabled]","true");
 form.set("billing_address_collection","required");
 form.set("tax_id_collection[enabled]","true");
 form.set("line_items[0][price_data][tax_behavior]","inclusive");
 // Keep the bound wallet amount in EUR. Stripe chooses dynamic payment methods.
 form.set("adaptive_pricing[enabled]","false");
 form.set("metadata[creditTaxFlow]",STANDARD_CREDIT_TAX_FLOW);
}
/** Only a signed event for the exact already-bound purchase can use the
 * settlement-only exception after an operator pauses new purchases. */
export function existingBoundStandardCreditReceipt(db:DatabaseSync,metadata:Record<string,unknown>|undefined,sessionId:unknown):boolean{
 const purchaseId=metadata?.creditTopupId;
 if(metadata?.flow!=="singmotion_credit_topup"||metadata.creditTaxFlow!==STANDARD_CREDIT_TAX_FLOW||
    typeof purchaseId!=="string"||!/^[0-9a-f-]{36}$/i.test(purchaseId)||
    typeof sessionId!=="string"||!/^cs_live_[A-Za-z0-9_]+$/.test(sessionId))return false;
 return !!db.prepare("SELECT 1 FROM credit_topup_purchases WHERE id=? AND stripe_session_id=? AND status IN ('pending','paid')").get(purchaseId,sessionId);
}
/** Run only on a separately fetched, signed, exact paid Stripe session.
 * Record the actual country and tax-ID classification, never a browser hint.
 * This mode does not certify an exemption or voucher classification. A missing
 * tax registration is an operator accounting issue, not grounds to retain a
 * customer's verified payment without issuing their purchased Credits. */
export function standardCreditTaxDecisionFromVerifiedStripe(session:Record<string,unknown>):CreditTaxDecision|null{
 const metadata=session.metadata as Record<string,unknown>|undefined;
 const details=session.customer_details as {address?:{country?:unknown};tax_ids?:unknown[]}|undefined;
 const country=details?.address?.country;
 const tax=session.automatic_tax as {enabled?:boolean;liability?:{type?:string}}|undefined;
 if(metadata?.creditTaxFlow!==STANDARD_CREDIT_TAX_FLOW||
    session.payment_status!=="paid"||
    (session.managed_payments as {enabled?:boolean}|undefined)?.enabled!==false||
    tax?.enabled!==true||(tax.liability?.type&&tax.liability.type!=="self")||
    typeof country!=="string"||!/^[A-Z]{2}$/.test(country))return null;
 return {country,buyerType:Array.isArray(details?.tax_ids)&&details.tax_ids.length>0?"business":"consumer",
  voucherKind:"seller-review-pending",mode:"seller-stripe-tax",revision:STANDARD_CREDIT_TAX_FLOW,taxAtIssue:false,taxCode:"txcd_10105003"};
}
