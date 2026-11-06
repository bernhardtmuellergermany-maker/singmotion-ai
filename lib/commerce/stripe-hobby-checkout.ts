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
