import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { CommerceStore } from "@/lib/commerce/store";
import { stripeCheckoutAdapter } from "@/lib/commerce/stripe-webhook";
import { dataDir } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Fail closed until a test-mode Stripe webhook signing secret is installed.
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || process.env.STRIPE_CHECKOUT_ENABLED !== "true")
    return NextResponse.json({ error: "Stripe Checkout is disabled." }, { status: 503 });
  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  const raw = new Uint8Array(await req.arrayBuffer());
  if (raw.byteLength > 128 * 1024)
    return NextResponse.json({ error: "Webhook payload too large." }, { status: 413 });
  let store: CommerceStore | undefined;
  try {
    store = new CommerceStore(path.join(dataDir, "commerce.sqlite"));
    await store.webhook(raw, signature, stripeCheckoutAdapter(secret));
    return NextResponse.json({ received: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Never leak private payment or account details into the HTTP response.
    console.error("Stripe webhook reconciliation failed:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Stripe webhook verification or reconciliation failed." }, { status: 400 });
  } finally {
    store?.close();
  }
}
