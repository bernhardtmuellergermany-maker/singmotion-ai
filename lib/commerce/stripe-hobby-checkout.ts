import {stripeSessionIdMatchesMode,type StripePaymentMode} from "./stripe-payment-mode.ts";

/** Do not trust a successful HTTP status from Stripe until the session
 * belongs to the expected sandbox/live environment, account and Stripe host. */
export function verifiedHobbyCheckoutSession(value:unknown,mode:StripePaymentMode,accountId:string,now=Date.now()):{
 id:string;url:string;expiresAt:number;
}{
 if(!value||typeof value!=="object")throw Error("Invalid Hobby Checkout session");
 const session=value as {id?:unknown;url?:unknown;livemode?:unknown;mode?:unknown;status?:unknown;client_reference_id?:unknown;expires_at?:unknown};
 if(typeof session.id!=="string"||!stripeSessionIdMatchesMode(session.id,mode)||
  session.livemode!==(mode==="live")||session.mode!=="subscription"||
  session.client_reference_id!==accountId||
  session.status!=="open"||
  typeof session.expires_at!=="number"||!Number.isSafeInteger(session.expires_at)||
  session.expires_at*1000<=now+60000||typeof session.url!=="string")
   throw Error("Unexpected Hobby Checkout session");
 let url:URL;
 try{url=new URL(session.url)}catch{throw Error("Invalid Hobby Checkout URL")}
 if(url.protocol!=="https:"||url.hostname!=="checkout.stripe.com"||
   url.username||url.password||url.port)throw Error("Unexpected Hobby Checkout host");
 return {id:session.id,url:session.url,expiresAt:session.expires_at*1000-30000};
}

/** Reuse a pending session only when Stripe's fresh response and the local
 * account-bound reservation match exactly. Never trust a browser URL. */
export function verifiedReusableHobbyCheckoutSession(
  stripeResponse:unknown,mode:StripePaymentMode,accountId:string,
  pending:{sessionId:string;url:string},now=Date.now(),
):{id:string;url:string;expiresAt:number}{
  const verified=verifiedHobbyCheckoutSession(stripeResponse,mode,accountId,now);
  if(verified.id!==pending.sessionId||verified.url!==pending.url)
    throw Error("Hobby Checkout reservation conflict");
  return verified;
}

/** Live subscription checkout must reject any staging-labeled Stripe product.
 * This is checked against Stripe's fresh price + product responses before
 * creating OR resuming a Checkout session; no local configuration can bypass it.
 */
export function verifiedHobbyLiveProduct(price:unknown,product:unknown):boolean{
 if(!price||typeof price!=="object"||!product||typeof product!=="object")return false;
 const p=price as Record<string,unknown>;
 const v=product as Record<string,unknown>;
 const meta=v.metadata&&typeof v.metadata==="object"&&!Array.isArray(v.metadata)?
  v.metadata as Record<string,unknown>:{};
 const staging=(x:unknown)=>typeof x==="string"&&
  /(?:^|[^a-z])(?:staging|sandbox)(?:$|[^a-z])/i.test(x);
 return typeof p.product==="string"&&/^prod_[A-Za-z0-9_]+$/.test(p.product)&&
  v.id===p.product&&v.livemode===true&&v.active===true&&
  meta.environment==="production"&&
  ![p.nickname,p.lookup_key,v.name,v.description,meta.environment].some(staging);
}
