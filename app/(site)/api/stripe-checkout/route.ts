import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { CommerceStore } from "@/lib/commerce/store";
import { customerLaunchReadiness } from "@/lib/commerce/readiness";
import {verifiedStripeCheckoutSession} from "@/lib/commerce/stripe-webhook";
import {configuredStripePaymentMode} from "@/lib/commerce/stripe-payment-mode";
import {sanitizedStripeCheckoutError} from "@/lib/commerce/stripe-error-diagnostics";
import {stripeVideoCheckoutLineItem} from "@/lib/commerce/stripe-video-checkout-line-item";
import {auditSingMotionLaunch} from "@/lib/launch-audit";
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
  // Checkout mode is fixed by the actual Railway environment and credential
  // prefix. A live key alone cannot authorize accepting real payments.
  const key = process.env.STRIPE_SECRET_KEY;
  const mode = configuredStripePaymentMode(process.env);
  // Do not collect money before real paid-order generation and delivery work.
  if (!mode || !customerLaunchReadiness().readyForPaidOrders ||
      (mode==="live"&&!auditSingMotionLaunch(process.env,"production").ready) ||
      process.env.CUSTOMER_GENERATION_ENABLED !== "true" ||
      process.env.CUSTOMER_FULFILLMENT_ENABLED !== "true" ||
      process.env.CUSTOMER_DELIVERY_ENABLED !== "true" ||
      process.env.CUSTOMER_ACCOUNTS_ENABLED !== "true" ||
      !key)
    return reply({ error: "Customer Checkout is not configured." }, 503);
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
    // Real videos are delivered only to the authenticated owning account.
    // A guest order cannot be sent to BytePlus or privately downloaded by
    // our current paid customer pipeline, so never collect Stripe money for it.
    if(!accountId)return reply({error:"Sign in before paying for a real video."},401);
    if(!store.emailVerified(accountId))return reply({error:"Verify your email before paying for a video.",code:"EMAIL_NOT_VERIFIED"},403);
    const order = store.ownedOrder(input.orderId, accountId);
    if(order.account_id!==accountId)
      return reply({error:"Customer-owned video order required."},403);
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
      ...stripeVideoCheckoutLineItem(cents),
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
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      // Stripe 400 errors are input/configuration problems, not transient
      // network errors. Never log or forward raw Stripe error messages.
      let details:unknown=null;
      try{details=await response.json();}catch{/* safely fall back */}
      const diagnostic=sanitizedStripeCheckoutError(details);
      const isTest=mode==="test";
      console.error("Stripe Checkout session rejected", {
        httpStatus:response.status,
        type:diagnostic.type,
        code:diagnostic.code,
        param:diagnostic.param,
        category:diagnostic.category,
        mode,
      });
      return reply(isTest ? {
        error:"Stripe Test Checkout rejected this request. No payment was taken.",
        code:"STRIPE_TEST_CHECKOUT_REJECTED",
        stripeHttpStatus:response.status,
        stripeErrorCode:diagnostic.code,
        stripeErrorParameter:diagnostic.param,
        stripeFailureCategory:diagnostic.category,
      } : {error:"Checkout is temporarily unavailable."}, 502);
    }
    let session: { id: string; url: string };
    try {
      session = verifiedStripeCheckoutSession(await response.json(),String(order.id),cents,mode);
    } catch {
      return reply({ error: "Invalid Checkout response." }, 502);
    }
    store.bindStripeCheckout(String(order.id), session.id);
    return reply({ url: session.url });
  } catch {
    return reply({ error: "Order unavailable or Checkout could not be created." }, 403);
  } finally {
    store?.close();
  }
}
