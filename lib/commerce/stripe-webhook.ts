import { createHmac, timingSafeEqual } from "node:crypto";
import type { PaymentAdapter, VerifiedPayment } from "@/lib/commerce/store";

/** Stripe's signed payload must be verified before interpreting any payment data. */
export function verifyStripeSandboxEvent(raw:Uint8Array,signature:string,secret:string):Record<string,any>{
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
