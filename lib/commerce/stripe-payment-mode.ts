/** Strict isolation between private Stripe Test mode and future Live orders.
 *
 * This is a configuration classifier, NOT a launch-approval switch.
 * A classified Live environment remains unable to charge until the
 * verified customer order, provider and delivery runtime is connected.
 */
import {assessProductionSandboxPilot} from "./customer-sandbox-pilot-policy.ts";
export type StripePaymentMode="test"|"live";
const STAGING="dfaeabed-03df-43ed-aa71-50f343a75041";
const PRODUCTION="36adc41d-7e54-4396-ad1a-fd432ba0441d";
export function configuredStripePaymentMode(env:Record<string,string|undefined>):StripePaymentMode|null{
 const key=env.STRIPE_SECRET_KEY||"";
 const webhookSecret=env.STRIPE_WEBHOOK_SECRET||"";
 if(!/^whsec_[A-Za-z0-9_]+$/.test(webhookSecret))return null;
 if(env.RAILWAY_ENVIRONMENT_ID===STAGING&&
    env.STRIPE_CHECKOUT_ENABLED==="true"&&/^sk_test_[A-Za-z0-9_]+$/.test(key))
   return "test";
 if(env.RAILWAY_ENVIRONMENT_ID===PRODUCTION&&assessProductionSandboxPilot(env).ready)
   return "test";
 if(env.RAILWAY_ENVIRONMENT_ID===PRODUCTION&&
    env.STRIPE_LIVE_CHECKOUT_ENABLED==="true"&&
    env.PUBLIC_CUSTOMER_LAUNCH_APPROVED==="true"&&
    env.STRIPE_ACCOUNT_LIVE_REVIEW_APPROVED==="true"&&
    /^(?:sk|rk)_live_[A-Za-z0-9_]+$/.test(key))
   return "live";
 return null;
}
/**
 * A checkout kill switch must NOT disable authenticated refund/dispute
 * reconciliation for orders already paid. This classifier authenticates
 * ONLY signed reversal webhooks in the exact Stripe account environment;
 * it never authorizes checkout, settlement or provider dispatch.
 */
export function configuredStripeReversalMode(env:Record<string,string|undefined>):StripePaymentMode|null{
 const key=env.STRIPE_SECRET_KEY||"";
 const secret=env.STRIPE_WEBHOOK_SECRET||"";
 if(!/^whsec_[A-Za-z0-9_]+$/.test(secret))return null;
 if(env.RAILWAY_ENVIRONMENT_ID===STAGING&&/^sk_test_[A-Za-z0-9_]+$/.test(key))
  return "test";
 if(env.RAILWAY_ENVIRONMENT_ID===PRODUCTION&&
    /^(?:sk|rk)_live_[A-Za-z0-9_]+$/.test(key))
  return "live";
 return null;
}

/** Do not acknowledge a delayed paid event when new settlement is paused:
 * Stripe must retry it after checkout/fulfillment is restored. Reversals
 * remain enforceable even while a checkout kill switch is active.
 */
export function stripeWebhookEventAdmitted(type:string|undefined,settlementEnabled:boolean):boolean{
 if(["refund.created","refund.updated","charge.dispute.created"].includes(type||""))return true;
 if(["checkout.session.completed","checkout.session.async_payment_succeeded"].includes(type||""))
  return settlementEnabled;
 return settlementEnabled;
}
export function stripeSessionIdMatchesMode(value:string,mode:StripePaymentMode):boolean{
 return mode==="live"?/^cs_live_[A-Za-z0-9_]+$/.test(value):
  /^cs_test_[A-Za-z0-9_]+$/.test(value);
}
export function stripeKeyMatchesMode(key:string,mode:StripePaymentMode):boolean{
 return mode==="live"?/^(?:sk|rk)_live_[A-Za-z0-9_]+$/.test(key):
  /^sk_test_[A-Za-z0-9_]+$/.test(key);
}

/** Never reuse a Production live Stripe credential for its private test pilot. */
export function customerStripeCredential(env:Record<string,string|undefined>,mode:StripePaymentMode):string|null{
 const privateSandbox=mode==="test"&&env.RAILWAY_ENVIRONMENT_ID===PRODUCTION;
 const key=privateSandbox?env.PRODUCTION_SANDBOX_STRIPE_SECRET_KEY:env.STRIPE_SECRET_KEY;
 return key&&stripeKeyMatchesMode(key,mode)?key:null;
}
export function customerStripeWebhookSecret(env:Record<string,string|undefined>,mode:StripePaymentMode):string|null{
 const privateSandbox=mode==="test"&&env.RAILWAY_ENVIRONMENT_ID===PRODUCTION;
 const secret=privateSandbox?env.PRODUCTION_SANDBOX_STRIPE_WEBHOOK_SECRET:env.STRIPE_WEBHOOK_SECRET;
 return secret&&/^whsec_[A-Za-z0-9_]+$/.test(secret)?secret:null;
}
