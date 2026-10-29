import { createHmac, timingSafeEqual } from "node:crypto";
import type { PaymentAdapter, VerifiedPayment } from "@/lib/commerce/store";

/** Stripe's signed payload must be verified before interpreting any payment data. */
export function stripeCheckoutAdapter(secret: string): PaymentAdapter {
  if (!secret.startsWith("whsec_")) throw Error("Stripe webhook secret is not configured.");
  return {
    async verify(raw: Uint8Array, signature: string): Promise<VerifiedPayment> {
      const fragments = signature.split(",").map((part) => part.trim().split("="));
      const timestamp = fragments.find(([key]) => key === "t")?.[1] || "";
      const candidates = fragments.filter(([key]) => key === "v1").map(([, value]) => value);
      const seconds = Number(timestamp);
      if (!/^\d+$/.test(timestamp) || !Number.isSafeInteger(seconds) ||
          Math.abs(Date.now() / 1000 - seconds) > 300 || !candidates.length)
        throw Error("Invalid Stripe signature.");
      const signed = Buffer.concat([Buffer.from(timestamp + ".", "utf8"), Buffer.from(raw)]);
      const expected = createHmac("sha256", secret).update(signed).digest();
      if (!candidates.some(value => /^[a-f0-9]{64}$/i.test(value) &&
          timingSafeEqual(Buffer.from(value, "hex"), expected)))
        throw Error("Invalid Stripe signature.");
      const event = JSON.parse(Buffer.from(raw).toString("utf8"));
      if (event.type !== "checkout.session.completed") throw Error("Unsupported Stripe payment event.");
      const checkout = event.data?.object;
      if (checkout?.object !== "checkout.session" || checkout.mode !== "payment" ||
          checkout.payment_status !== "paid" || checkout.currency?.toLowerCase() !== "eur" ||
          !Number.isSafeInteger(checkout.amount_total) || checkout.amount_total <= 0 ||
          typeof checkout.metadata?.orderId !== "string" || !/^[a-f0-9-]{36}$/.test(checkout.metadata.orderId) ||
          typeof checkout.id !== "string" || !checkout.id.startsWith("cs_") ||
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
