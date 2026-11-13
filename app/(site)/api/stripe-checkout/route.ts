import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { CommerceStore } from "@/lib/commerce/store";
import { customerLaunchReadiness } from "@/lib/commerce/readiness";
import {verifiedStripeCheckoutSession} from "@/lib/commerce/stripe-webhook";
import {configuredStripePaymentMode,customerStripeCredential} from "@/lib/commerce/stripe-payment-mode";
import {sanitizedStripeCheckoutError} from "@/lib/commerce/stripe-error-diagnostics";
import {stripeVideoCheckoutLineItem,stripeVideoCheckoutIdempotencyKey,stripeVideoCheckoutLiveTaxSettings} from "@/lib/commerce/stripe-video-checkout-line-item";
import {auditSingMotionLaunch} from "@/lib/launch-audit";
import {protectedProductionLivePilotApproved} from "@/lib/commerce/protected-production-live-pilot";
import { dataDir, limit } from "@/lib/db";
import { stagingDenial } from "@/lib/staging";
import { applicationOrigin } from "@/lib/request-origin";
import {resolveVideoCheckoutOwner} from "@/lib/commerce/video-checkout-owner";

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
  const mode = configuredStripePaymentMode(process.env);
  const key = mode?customerStripeCredential(process.env,mode):null;
  // Do not collect money before real paid-order generation and delivery work.
  if (!mode || !customerLaunchReadiness().readyForPaidOrders ||
      (mode==="live"&&!protectedProductionLivePilotApproved(process.env)&&
       !auditSingMotionLaunch(process.env,"production").ready) ||
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
    if(input.immediateStart !== true || input.acknowledgedWithdrawalConsequences !== true)
      return reply({error:"Both explicit production-start acknowledgements are required."},400);
    store = new CommerceStore(path.join(dataDir, "commerce.sqlite"));
    const accountId = store.session(req.cookies.get("sm_customer")?.value || "");
    const guestToken=req.cookies.get("sm_guest_"+input.orderId)?.value;
    // A guest purchase remains accessible when the browser also contains an
    // unrelated signed-in customer session. An account cannot impersonate
    // that guest without the exact order capability.
    const owner=resolveVideoCheckoutOwner(store,input.orderId,accountId,guestToken);
    const order=owner.order;
    // A protected LIVE pilot never charges an anonymous guest order.
    if(mode==="live"&&protectedProductionLivePilotApproved(process.env)&&owner.kind!=="account")
      return reply({error:"Sign in to purchase a customer video."},403);
    // Payment cannot open until the reviewed input snapshot is permanently bound.
    if (!store.reviewedOrderReadyForCheckout(String(order.id)))
      return reply({ error: "Video inputs must be reviewed before Checkout." }, 409);
    const cents = Number(order.price_cents);
    if (order.status !== "awaiting_payment" || order.currency !== "EUR" ||
        !Number.isSafeInteger(cents) || cents <= 0 ||
        typeof order.quote_evidence !== "string" || order.quote_evidence.length < 20)
      return reply({ error: "Order is not eligible for Checkout." }, 409);
    // Persist the exact acknowledgement version and reviewed commercial snapshot
    // before creating a payable Stripe Session. Client flags alone are insufficient.
    if(owner.kind==="account")store.recordEarlyPerformanceConsent(String(order.id),owner.accountId);
    else store.recordGuestEarlyPerformanceConsent(String(order.id),owner.guestToken);
    const form = new URLSearchParams({
      mode: "payment",
      ...stripeVideoCheckoutLineItem(cents),
      ...stripeVideoCheckoutLiveTaxSettings(mode),
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
        "Idempotency-Key": stripeVideoCheckoutIdempotencyKey(String(order.id)),
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
