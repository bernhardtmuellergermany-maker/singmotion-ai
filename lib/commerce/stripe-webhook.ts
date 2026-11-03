import { createHmac, timingSafeEqual } from "node:crypto";
import type { PaymentAdapter, VerifiedPayment } from "@/lib/commerce/store";
/** Parsed Stripe JSON remains untrusted until each required field is checked. */
export type StripeTestEvent = {
  livemode?: boolean;
  id?: string;
  type?: string;
  data?: {object?: {
    id?: string;
    object?: string;
    mode?: string;
    payment_status?: string;
    currency?: string;
    amount_total?: number;
    metadata?: {orderId?: string};
  }};
};
type StripeCheckoutResponse = Record<string, unknown> & {
  livemode?: boolean;
  id?: string;
  mode?: string;
  currency?: string;
  amount_total?: number;
  metadata?: {orderId?: string};
  url?: string;
};


/** Strict streaming bound: a malicious caller cannot force the webhook to buffer
 * an unbounded body before the Stripe signature is checked. */
export class StripeWebhookPayloadTooLarge extends Error {
 constructor(){super("Stripe webhook payload too large");}
}
export async function readBoundedStripeWebhookBody(request: Request, maxBytes = 128 * 1024): Promise<Uint8Array> {
 if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw Error("Invalid webhook body limit");
 const length = request.headers.get("content-length");
 if (length !== null) {
  if (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))
   throw new StripeWebhookPayloadTooLarge();
  if (Number(length) > maxBytes) throw new StripeWebhookPayloadTooLarge();
 }
 if (!request.body) return new Uint8Array();
 const reader = request.body.getReader();
 const chunks: Uint8Array[] = [];
 let bytes = 0;
 try {
  while (true) {
   const {done,value} = await reader.read();
   if (done) break;
   bytes += value.byteLength;
   if (bytes > maxBytes) throw new StripeWebhookPayloadTooLarge();
   chunks.push(value);
  }
  // Reassemble once, only after verifying the entire streamed length.
  return Buffer.concat(chunks,bytes);
 } catch (error) {
  await reader.cancel().catch(()=>{});
  throw error;
 } finally {
  reader.releaseLock();
 }
}

/** Stripe's signed payload must be verified before interpreting any payment data. */
export function verifyStripeSandboxEvent(raw:Uint8Array,signature:string,secret:string):StripeTestEvent{
 if(!secret.startsWith("whsec_"))throw Error("Stripe secret unavailable");
 const fields=signature.split(",").map(x=>x.trim().split("="));
 const t=fields.find(x=>x[0]==="t")?.[1]||"";
 const v=fields.filter(x=>x[0]==="v1").map(x=>x[1]);
 if(!/^\d+$/.test(t)||!Number.isSafeInteger(Number(t))||Math.abs(Date.now()/1000-Number(t))>300)
  throw Error("Invalid Stripe signature");
 const expected=createHmac("sha256",secret).update(Buffer.concat([Buffer.from(t+"."),Buffer.from(raw)])).digest();
 if(!v.some(x=>/^[a-f0-9]{64}$/i.test(x)&&timingSafeEqual(Buffer.from(x,"hex"),expected)))
  throw Error("Invalid Stripe signature");
 const event=JSON.parse(Buffer.from(raw).toString("utf8"));
 if(event.livemode!==false||typeof event.id!=="string"||!event.id.startsWith("evt_"))
  throw Error("Only Stripe sandbox events permitted");
 return event;
}
export function stripeCheckoutAdapter(secret: string): PaymentAdapter {
  if (!secret.startsWith("whsec_")) throw Error("Stripe webhook secret is not configured.");
  return {
    async verify(raw: Uint8Array, signature: string): Promise<VerifiedPayment> {
      const event = verifyStripeSandboxEvent(raw,signature,secret);
      if (event.type !== "checkout.session.completed") throw Error("Unsupported Stripe payment event.");
      const checkout = event.data?.object;
      if (checkout?.object !== "checkout.session" || checkout.mode !== "payment" ||
          checkout.payment_status !== "paid" || checkout.currency?.toLowerCase() !== "eur" ||
          !Number.isSafeInteger(checkout.amount_total) || checkout.amount_total <= 0 ||
          typeof checkout.metadata?.orderId !== "string" || !/^[a-f0-9-]{36}$/.test(checkout.metadata.orderId) ||
          typeof checkout.id !== "string" || !checkout.id.startsWith("cs_test_") ||
          typeof event.id !== "string" || !event.id.startsWith("evt_"))
        throw Error("Stripe Checkout payment is not eligible for fulfillment.");
      return {
        eventId: event.id,
        provider: "stripe",
        orderId: checkout.metadata.orderId,
        cents: checkout.amount_total,
        currency: "EUR",
        evidence: checkout.id,
      };
    },
  };
}

/** Validate the actual Stripe test-mode checkout against the reviewed order.
 * A valid API HTTP response alone is not authorization to bind an order. */
export function verifiedStripeTestCheckoutSession(
 value:unknown,orderId:string,priceCents:number
):{id:string;url:string}{
 if(!value||typeof value!=="object")throw Error("Invalid Stripe Checkout Session");
 const session=value as StripeCheckoutResponse;
 if(session.livemode!==false||session.mode!=="payment"||
    session.currency!=="eur"||session.amount_total!==priceCents||
    session.metadata?.orderId!==orderId||
    typeof session.id!=="string"||!/^cs_test_[A-Za-z0-9_]+$/.test(session.id)||
    typeof session.url!=="string")throw Error("Unverified Stripe Checkout Session");
 let url:URL;
 try{url=new URL(session.url);}catch{throw Error("Unverified Stripe Checkout URL");}
 if(url.protocol!=="https:"||url.hostname!=="checkout.stripe.com"||
    url.port||url.username||url.password)
  throw Error("Unverified Stripe Checkout URL");
 return {id:session.id,url:session.url};
}
