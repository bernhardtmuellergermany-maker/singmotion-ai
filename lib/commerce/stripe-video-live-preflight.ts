/** Read-only, product-specific preflight for one-time LIVE music-video Checkout.
 * Hobby subscriptions have an independent gate and do not belong in this audit.
 * No Checkout sessions, refunds, invoices, providers or approval flags change.
 */
import {customerLaunchReadiness} from "./readiness.ts";
import {assessProtectedProductionLivePilot} from "./protected-production-live-pilot.ts";
import {SINGMOTION_VIDEO_TAX_CODE,stripeVideoCheckoutLineItem,
 stripeVideoCheckoutLiveTaxSettings} from "./stripe-video-checkout-line-item.ts";

const PRODUCTION="36adc41d-7e54-4396-ad1a-fd432ba0441d";
const VIDEO_EVENTS=["checkout.session.completed","checkout.session.async_payment_succeeded",
 "refund.created","refund.updated","charge.dispute.created"] as const;
type Fetcher=(url:string,init:RequestInit)=>Promise<Response>;
type Json=Record<string,unknown>;
export type LiveVideoPreflight={
 environment:"production";
 checks:{name:string;ok:boolean}[];
 taxRegistrationCount:number|null;
 stripeVideoConfigurationVerified:boolean;
 privateProductionPilotApproved:boolean;
 customerFulfillmentReady:boolean;
 paidVideoOrdersEnabled:boolean;
};
const record=(v:unknown):Json|null=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Json:null;
function canonicalOrigin(value:string|undefined):string|null{
 try{
  const u=new URL(value||"");
  if(u.protocol!=="https:"||u.username||u.password||u.port||
     u.pathname!=="/"||u.search||u.hash||u.origin!==value||
     !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(u.hostname))return null;
  return u.origin;
 }catch{return null}
}
function verifiedVideoEndpoint(origin:string,body:Json|null):boolean{
 const approved=new Set([origin]);
 if(origin==="https://www.singmotion.ai")
  approved.add("https://singmotion-ai-production.up.railway.app");
 return Array.isArray(body?.data)&&body.data.some(entry=>{
  const hook=record(entry);
  if(!hook||hook.livemode!==true||hook.status!=="enabled"||
     typeof hook.url!=="string")return false;
  let url:URL;
  try{url=new URL(hook.url)}catch{return false}
  if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash||
     url.pathname!=="/api/stripe-webhook"||!approved.has(url.origin))return false;
  const events=hook.enabled_events;
  return Array.isArray(events)&&VIDEO_EVENTS.every(e=>events.includes(e)||events.includes("*"));
 });
}
export async function readOnlyStripeVideoLivePreflight(
 env:Record<string,string|undefined>,fetcher:Fetcher=fetch,
):Promise<LiveVideoPreflight>{
 const checks:{name:string;ok:boolean}[]=[];
 const check=(name:string,ok:boolean)=>{checks.push({name,ok});return ok};
 const production=check("production-environment",env.RAILWAY_ENVIRONMENT_ID===PRODUCTION);
 const key=env.STRIPE_SECRET_KEY||"";
 const credential=check("stripe-live-key-format",/^(?:sk|rk)_live_[A-Za-z0-9_]+$/.test(key));
 const webhook=check("signed-live-video-webhook-secret",
  /^whsec_[A-Za-z0-9_]+$/.test(env.STRIPE_WEBHOOK_SECRET||""));
 const origin=canonicalOrigin(env.PUBLIC_SITE_ORIGIN);
 const allowedOrigin=check("exact-production-https-origin",origin==="https://www.singmotion.ai");
 const stagingBlocked=check("public-access-remains-disabled",
  env.STAGING_AUTH_ENABLED==="true"&&(env.STAGING_PASSWORD?.length||0)>=32&&
  env.PRODUCTION_PUBLIC_ACCESS_ENABLED==="false"&&env.PUBLIC_CUSTOMER_LAUNCH_APPROVED==="false");
 check("hobby-live-off",env.HOBBY_SUBSCRIPTIONS_ENABLED!=="true");
 const quoted=stripeVideoCheckoutLineItem(250);
 const liveTax=stripeVideoCheckoutLiveTaxSettings("live");
 check("video-price-tax-inclusive-with-explicit-code",
  quoted["line_items[0][price_data][currency]"]==="eur"&&
  quoted["line_items[0][price_data][tax_behavior]"]==="inclusive"&&
  quoted["line_items[0][price_data][product_data][tax_code]"]===SINGMOTION_VIDEO_TAX_CODE&&
  /^txcd_[0-9]+$/.test(SINGMOTION_VIDEO_TAX_CODE));
 check("billing-address-and-automatic-tax-requested",
  liveTax["billing_address_collection"]==="required"&&
  liveTax["automatic_tax[enabled]"]==="true"&&
  liveTax["invoice_creation[enabled]"]==="true");
 let taxRegistrationCount:number|null=null;
 // Never connect a live key to Stripe outside exact, password-protected
 // Production. The source account is inspected with GET only.
 if(production&&credential&&webhook&&allowedOrigin&&stagingBlocked){
  const get=async(url:string):Promise<Json|null>=>{
   try{
    const response=await fetcher(url,{
     method:"GET",headers:{Authorization:"Bearer "+key},
     cache:"no-store",signal:AbortSignal.timeout(8000),
    });
    if(!response.ok)return null;
    return record(await response.json());
   }catch{return null}
  };
  const [account,hooks,tax,registrations]=await Promise.all([
   get("https://api.stripe.com/v1/account"),
   get("https://api.stripe.com/v1/webhook_endpoints?limit=100"),
   get("https://api.stripe.com/v1/tax/settings"),
   get("https://api.stripe.com/v1/tax/registrations?limit=100"),
  ]);
  check("live-account-enabled-to-charge",
   account?.object==="account"&&account.charges_enabled===true&&
   account.details_submitted===true);
  check("video-webhook-endpoint-configured",
   verifiedVideoEndpoint(origin!,hooks));
  check("live-stripe-tax-active",tax?.status==="active");
  check("tax-registrations-readable",Array.isArray(registrations?.data)&&
   registrations?.has_more===false);
  if(Array.isArray(registrations?.data)&&registrations?.has_more===false)
   taxRegistrationCount=registrations.data.length;
 }else{
  for(const name of ["live-account-enabled-to-charge","video-webhook-endpoint-configured",
   "live-stripe-tax-active","tax-registrations-readable"])check(name,false);
 }
 const stripeVideoConfigurationVerified=checks.every(x=>x.ok);
 // A zero registration count is an operator review item, not automatic
 // evidence of a legal defect nor permission to charge. Nor does an enabled
 // endpoint prove a signed event was delivered successfully.
 const privateProductionPilotApproved=assessProtectedProductionLivePilot(env).ready;
 const customerFulfillmentReady=customerLaunchReadiness(env).readyForPaidOrders;
 return {environment:"production",checks,taxRegistrationCount,
  stripeVideoConfigurationVerified,privateProductionPilotApproved,customerFulfillmentReady,
  paidVideoOrdersEnabled:stripeVideoConfigurationVerified&&
   privateProductionPilotApproved&&customerFulfillmentReady};
}
