import {worldwideTaxPolicyAvailable} from "./worldwide-credit-tax.ts";

/**
 * A second, seller-of-record Stripe Checkout can use the normal account's
 * dynamic payment-method configuration (PayPal / Klarna where eligible).
 * It must NOT bypass Managed Payments' separate tax responsibilities.
 *
 * Merely enabling PayPal/Klarna in Stripe is not sufficient evidence of
 * reviewed prepaid-credit voucher treatment or seller-side tax compliance.
 */
export function alternativeCreditCheckoutApproved(env:Record<string,string|undefined>):boolean{
 return env.RAILWAY_ENVIRONMENT_ID==="36adc41d-7e54-4396-ad1a-fd432ba0441d" &&
  env.CREDIT_ALTERNATIVE_STRIPE_CHECKOUT_APPROVED==="true" &&
  env.CREDIT_TAX_WORLDWIDE_REVIEW_APPROVED==="true" &&
  worldwideTaxPolicyAvailable(env) &&
  env.STRIPE_CREDIT_TOPUPS_LIVE_ENABLED==="true" &&
  env.STRIPE_LIVE_CHECKOUT_ENABLED==="true";
}

/** Never turn this on in the TEST sandbox or by a client-supplied flag. */
export function selectAlternativeCreditCheckout(
 env:Record<string,string|undefined>,requested:unknown,liveMode:boolean
):{allowed:boolean;alternative:boolean}{
 if(requested===undefined||requested==="managed")
  return {allowed:true,alternative:false};
 if(requested!=="alternative"||!liveMode||!alternativeCreditCheckoutApproved(env))
  return {allowed:false,alternative:false};
 return {allowed:true,alternative:true};
}
