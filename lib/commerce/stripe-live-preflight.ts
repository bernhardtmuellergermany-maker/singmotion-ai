/**
 * Read-only Stripe Live account preflight. Never creates Checkout, customer,
 * refund or invoice objects and never upgrades a launch gate.
 */
import {customerLaunchReadiness} from "./readiness.ts";
const PRODUCTION="36adc41d-7e54-4396-ad1a-fd432ba0441d";
const events=["checkout.session.completed","checkout.session.async_payment_succeeded",
 "refund.created","refund.updated","charge.dispute.created"] as const;
type Fetcher=(input:string,init:RequestInit)=>Promise<Response>;
export type StripePreflightResult={
 environment:"production"; account:string; checks:{name:string;ok:boolean}[];
 stripeConfigurationVerified:boolean; paidOrdersEnabled:boolean;
};
function safeOrigin(value:string|undefined):string|null{
 try{
  const url=new URL(value||"");
  if(url.protocol!=="https:"||url.username||url.password||url.port||
     !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(url.hostname)||
     url.hostname.endsWith(".localhost")||
     url.pathname!=="/"||url.search||url.hash)return null;
  return url.origin;
 }catch{return null}
}
export async function readOnlyStripeLivePreflight(
 env:Record<string,string|undefined>,fetcher:Fetcher=fetch,
):Promise<StripePreflightResult>{
 const checks:{name:string;ok:boolean}[]=[];
 const check=(name:string,ok:boolean)=>{checks.push({name,ok});return ok};
 const environment=check("real-production-environment",env.RAILWAY_ENVIRONMENT_ID===PRODUCTION);
 const key=env.STRIPE_SECRET_KEY||"";
 const credential=check("live-secret-key-format",/^sk_live_[A-Za-z0-9_]+$/.test(key));
 check("live-webhook-signing-secret",/^whsec_[A-Za-z0-9_]+$/.test(env.STRIPE_WEBHOOK_SECRET||""));
 const origin=safeOrigin(env.PUBLIC_SITE_ORIGIN);
 check("public-https-origin",origin!==null);
 const priceId=env.STRIPE_HOBBY_LIVE_PRICE_ID||"";
 const hasPrice=check("separate-hobby-live-price",/^price_[A-Za-z0-9]+$/.test(priceId));
 // The connection cannot access live Stripe outside real Production. This
 // protects private Staging from accidentally using an operator's live key.
 if(environment&&credential&&origin&&hasPrice){
  const request=async(url:string):Promise<Record<string,unknown>|null>=>{
   try{
    const response=await fetcher(url,{
     method:"GET",headers:{Authorization:"Bearer "+key},
     cache:"no-store",signal:AbortSignal.timeout(8000),
    });
    if(!response.ok)return null;
    const result=await response.json();
    return result&&typeof result==="object"&&!Array.isArray(result)?
     result as Record<string,unknown>:null;
   }catch{return null}
  };
  const [account,price,webhooks]=await Promise.all([
   request("https://api.stripe.com/v1/account"),
   request("https://api.stripe.com/v1/prices/"+encodeURIComponent(priceId)),
   request("https://api.stripe.com/v1/webhook_endpoints?limit=100"),
  ]);
  check("stripe-account-accepts-charges",
   account?.object==="account"&&account.charges_enabled===true&&
   account.details_submitted===true);
  const p=price?.recurring;
  const recurring=p&&typeof p==="object"?p as Record<string,unknown>:null;
  check("hobby-price-is-active-inclusive-eur-monthly",
   price?.id===priceId&&price.livemode===true&&price.active===true&&
   price.currency==="eur"&&price.unit_amount===499&&
   price.tax_behavior==="inclusive"&&recurring?.interval==="month"&&
   recurring?.interval_count===1&&recurring?.usage_type==="licensed");
  const items=Array.isArray(webhooks?.data)?webhooks.data:[];
  check("verified-live-checkout-webhook",
   items.some(value=>{
    if(!value||typeof value!=="object")return false;
    const hook=value as Record<string,unknown>;
    const enabled=hook.enabled_events;
    return hook.livemode===true&&hook.status==="enabled"&&
     hook.url===origin+"/api/stripe-webhook"&&
     Array.isArray(enabled)&&events.every(t=>enabled.includes(t)||enabled.includes("*"));
   }));
 }else{
  check("stripe-account-accepts-charges",false);
  check("hobby-price-is-active-inclusive-eur-monthly",false);
  check("verified-live-checkout-webhook",false);
 }
 const stripeConfigurationVerified=checks.every(c=>c.ok);
 // Even a fully configured Stripe account does NOT prove that customers can
 // receive their product. An unready paid worker keeps checkout disabled.
 return {environment:"production",account:"redacted",
  checks,stripeConfigurationVerified,
  paidOrdersEnabled:stripeConfigurationVerified&&customerLaunchReadiness(env).readyForPaidOrders};
}
