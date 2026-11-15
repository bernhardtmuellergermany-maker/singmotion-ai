/**
 * Read-only Stripe Live account preflight. Never creates Checkout, customer,
 * refund or invoice objects and never upgrades a launch gate.
 */
import {customerLaunchReadiness} from "./readiness.ts";
const PRODUCTION="36adc41d-7e54-4396-ad1a-fd432ba0441d";
const videoEvents=["checkout.session.completed","checkout.session.async_payment_succeeded",
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
 const credential=check("live-secret-key-format",/^(?:sk|rk)_live_[A-Za-z0-9_]+$/.test(key));
 const webhookConfigured=check("live-webhook-signing-secret",/^whsec_[A-Za-z0-9_]+$/.test(env.STRIPE_WEBHOOK_SECRET||""));
 const origin=safeOrigin(env.PUBLIC_SITE_ORIGIN);
 check("public-https-origin",origin!==null);
 // The connection cannot access live Stripe outside real Production. This
 // protects private Staging from accidentally using an operator's live key.
 if(environment&&credential&&webhookConfigured&&origin){
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
  const [account,product,webhooks]=await Promise.all([
   request("https://api.stripe.com/v1/account"),
   request("https://api.stripe.com/v1/products/prod_Vchw1yEak3Xa6k"),
   request("https://api.stripe.com/v1/webhook_endpoints?limit=100"),
  ]);
  check("stripe-account-accepts-charges",
   account?.object==="account"&&account.charges_enabled===true&&
   account.details_submitted===true);
  // Credits-only release: verify the exact live product rather than retired Hobby billing.
  // The tax code does not by itself certify a tax or merchant-of-record decision.
  const creditProductId="prod_Vchw1yEak3Xa6k";
  const approvedCreditTaxCodes=new Set(["txcd_10105001","txcd_10105002",
    "txcd_10105003","txcd_10105004"]);
  const description=typeof product?.description==="string"?product.description:"";
  check("credits-live-product-active-and-classified",
    product?.id===creditProductId&&product.livemode===true&&
    product.active===true&&product.name==="SingMotion AI Credits"&&
    /prepaid credits/i.test(description)&&
    approvedCreditTaxCodes.has(String(product.tax_code||"")));
  const items=Array.isArray(webhooks?.data)?webhooks.data:[];
  // Credits purchases require the signed payment/refund/dispute endpoint.
  // Hobby is retired and its webhook cannot block a credits-only release.
  // Stripe currently delivers to this specific, TLS-verified Production
  // Railway domain. The public custom host is also permitted. No arbitrary
  // staging Railway host, wildcard or untrusted configured redirect is valid.
  const approvedWebhookOrigins=new Set([origin,
   ...(origin==="https://www.singmotion.ai"?
    ["https://singmotion-ai-production.up.railway.app"]:[])]);
  const endpoint=(route:string,required:readonly string[])=>items.some(value=>{
    if(!value||typeof value!=="object")return false;
    const hook=value as Record<string,unknown>;
    const enabled=hook.enabled_events;
    return hook.livemode===true&&hook.status==="enabled"&&
     typeof hook.url==="string"&&approvedWebhookOrigins.has(hook.url.slice(0,-route.length))&&
     hook.url.endsWith(route) &&
     Array.isArray(enabled)&&required.every(t=>enabled.includes(t)||enabled.includes("*"));
  });
  check("verified-live-checkout-webhook",endpoint("/api/stripe-webhook",videoEvents));
 }else{
  check("stripe-account-accepts-charges",false);
  check("credits-live-product-active-and-classified",false);
  check("verified-live-checkout-webhook",false);
 }
 const stripeConfigurationVerified=checks.every(c=>c.ok);
 // Even a fully configured Stripe account does NOT prove that customers can
 // receive their product. An unready paid worker keeps checkout disabled.
 return {environment:"production",account:"redacted",
  checks,stripeConfigurationVerified,
  paidOrdersEnabled:stripeConfigurationVerified&&customerLaunchReadiness(env).readyForPaidOrders};
}
