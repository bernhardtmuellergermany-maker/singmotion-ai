import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { CommerceStore } from "@/lib/commerce/store";
import { customerLaunchReadiness } from "@/lib/commerce/readiness";
import { dataDir, limit } from "@/lib/db";
import { stagingDenial } from "@/lib/staging";
import { applicationOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (data: unknown, status = 200) => NextResponse.json(data, {
  status, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
});

export async function POST(req: NextRequest) {
  const denied = stagingDenial(req.headers.get("authorization"));
  if (denied) return denied;
  // Deliberately limited to the test-mode backend and pre-reviewed orders.
  const key = process.env.STRIPE_SECRET_KEY;
  // Do not collect money until paid-order generation and delivery are active.
  if (!customerLaunchReadiness().readyForPaidOrders ||
      process.env.STRIPE_CHECKOUT_ENABLED !== "true" ||
      process.env.CUSTOMER_GENERATION_ENABLED !== "true" ||
      process.env.CUSTOMER_FULFILLMENT_ENABLED !== "true" ||
      process.env.CUSTOMER_DELIVERY_ENABLED !== "true" ||
      process.env.CUSTOMER_ACCOUNTS_ENABLED !== "true" ||
      !key?.startsWith("sk_test_"))
    return reply({ error: "Test Checkout is not configured." }, 503);
  const origin = applicationOrigin(req.url, req.headers.get("host"));
  if (!origin || req.headers.get("origin") !== origin)
    return reply({ error: "Request origin is not allowed." }, 403);
  let store: CommerceStore | undefined;
  try {
    limit("stripe-checkout:global", 30, 60000);
    if (Number(req.headers.get("content-length")) > 1024) return reply({ error: "Request too large." }, 413);
    const raw = await req.text();
    if (Buffer.byteLength(raw) > 1024) return reply({ error: "Request too large." }, 413);
    const input = JSON.parse(raw);
    if (typeof input.orderId !== "string" || !/^[a-f0-9-]{36}$/.test(input.orderId))
      return reply({ error: "Invalid order." }, 400);
    store = new CommerceStore(path.join(dataDir, "commerce.sqlite"));
    const accountId = store.session(req.cookies.get("sm_customer")?.value || "");
    const order = store.ownedOrder(input.orderId, accountId, req.cookies.get(`sm_guest_${input.orderId}`)?.value);
    // Payment cannot open until the reviewed input snapshot is permanently bound.
    if (!store.reviewedOrderReadyForCheckout(String(order.id)))
      return reply({ error: "Video inputs must be reviewed before Checkout." }, 409);
    const cents = Number(order.price_cents);
    if (order.status !== "awaiting_payment" || order.currency !== "EUR" ||
        !Number.isSafeInteger(cents) || cents <= 0 ||
        typeof order.quote_evidence !== "string" || order.quote_evidence.length < 20)
      return reply({ error: "Order is not eligible for Checkout." }, 409);
    const form = new URLSearchParams({
      mode: "payment",
      "line_items[0][price_data][currency]": "eur",
      "line_items[0][price_data][unit_amount]": String(cents),
      "line_items[0][price_data][product_data][name]": "SingMotion AI music video",
      "line_items[0][quantity]": "1",
      "metadata[orderId]": String(order.id),
      "payment_intent_data[metadata][orderId]": String(order.id),
      customer_email: String(order.email),
      success_url: `${origin}/orders/${order.id}?checkout=success`,
      cancel_url: `${origin}/orders/${order.id}?checkout=cancelled`,
    });
    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": `singmotion-checkout-${order.id}`,
      },
      body: form,
      cache: "no-store",
    });
    if (!response.ok) {
      console.error("Stripe Checkout session request failed", response.status);
      return reply({ error: "Checkout is temporarily unavailable." }, 502);
    }
    const session = await response.json() as { url?: string; id?: string };
    if (!session.id?.startsWith("cs_test_") ||
        !session.url?.startsWith("https://checkout.stripe.com/"))
      return reply({ error: "Invalid test Checkout response." }, 502);
    store.bindStripeCheckout(String(order.id), session.id);
    return reply({ url: session.url });
  } catch {
    return reply({ error: "Order unavailable or Checkout could not be created." }, 403);
  } finally {
    store?.close();
  }
}
