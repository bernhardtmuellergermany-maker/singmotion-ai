/** Strict isolation between private Stripe Test mode and future Live orders.
 *
 * This is a configuration classifier, NOT a launch-approval switch.
 * A classified Live environment remains unable to charge until the
 * verified customer order, provider and delivery runtime is connected.
 */
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
 if(env.RAILWAY_ENVIRONMENT_ID===PRODUCTION&&
    env.STRIPE_LIVE_CHECKOUT_ENABLED==="true"&&
    env.PUBLIC_CUSTOMER_LAUNCH_APPROVED==="true"&&
    env.STRIPE_ACCOUNT_LIVE_REVIEW_APPROVED==="true"&&
    /^sk_live_[A-Za-z0-9_]+$/.test(key))
   return "live";
 return null;
}
export function stripeSessionIdMatchesMode(value:string,mode:StripePaymentMode):boolean{
 return mode==="live"?/^cs_live_[A-Za-z0-9_]+$/.test(value):
  /^cs_test_[A-Za-z0-9_]+$/.test(value);
}
export function stripeKeyMatchesMode(key:string,mode:StripePaymentMode):boolean{
 return mode==="live"?/^sk_live_[A-Za-z0-9_]+$/.test(key):
  /^sk_test_[A-Za-z0-9_]+$/.test(key);
}
