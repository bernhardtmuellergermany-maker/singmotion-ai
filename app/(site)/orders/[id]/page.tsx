import { cookies } from "next/headers";
import Link from "next/link";
import path from "node:path";
import { CommerceStore } from "@/lib/commerce/store";
import { dataDir } from "@/lib/db";
import { ProductHeader } from "@/components/product-header";
import { GuestOrderAccess } from "@/components/guest-order-access";
import { CustomerPaidOutput } from "@/components/customer-paid-output";
import { CustomerVideoCheckout } from "@/components/customer-video-checkout";
import {customerLaunchReadiness} from "@/lib/commerce/readiness";
import { CancelUnstartedOrder } from "@/components/cancel-unstarted-order";
import { StripeOrderReturnRecovery } from "@/components/stripe-order-return-recovery";
import "./private-order.css";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Private order",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
export default async function Page({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { id } = await params;
  const { checkout } = await searchParams;
  let order: Record<string, unknown> | null = null,
    fulfillmentState: string | null = null,
    videoReady = false,
    authenticatedOwner = false,
    guestOwner = false,
    promotion: {code:string;original_cents:number;discount_cents:number;state:string}|null = null,
    store: CommerceStore | undefined;
  if (
    process.env.CUSTOMER_ACCOUNTS_ENABLED === "true" &&
    /^[a-f0-9-]{36}$/.test(id)
  )
    try {
      const c = await cookies();
      store = new CommerceStore(path.join(dataDir, "commerce.sqlite"));
      const account = store.session(c.get("sm_customer")?.value || "");
      const guestToken = c.get(`sm_guest_${id}`)?.value;
      order = store.ownedOrder(id, account, guestToken);
      authenticatedOwner = Boolean(account && order && (order.account_id === account || store.guestClaimedBy(id,account)));
      guestOwner = Boolean(order && !order.account_id && guestToken);
      if(authenticatedOwner && store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='promo_redemptions'").get())
        promotion = store.db.prepare("SELECT code,original_cents,discount_cents,state FROM promo_redemptions WHERE order_id=?")
          .get(id) as {code:string;original_cents:number;discount_cents:number;state:string} | undefined ?? null;
      const fulfillment = store.db.prepare("SELECT state FROM customer_fulfillment_queue WHERE order_id=?").get(id);
      fulfillmentState = fulfillment ? String(fulfillment.state) : null;
      videoReady = store.ownedDeliveredVideoAsset(id, account, guestToken) !== null;
    } catch {
    } finally {
      store?.close();
    }
  return (
    <div className="product-theme">
      <ProductHeader />
      <main id="content" className="account-content wizard-card sm-private-order-page">
        <header className="sm-order-heading" style={order && (order.status==="paid" || fulfillmentState!==null || videoReady)?{display:"none"}:undefined}>
          <span className="sm-order-eyebrow">SINGMOTION AI / PRIVATE ORDER</span>
          <h1>Your music video</h1>
          <p>Your video and order status in one private place.</p>
        </header>
        {order ? (
          <>
            <div className="sm-order-summary" aria-label="Order information">
              <div className="sm-order-summary-item"><span>Payment</span><strong className={order.status==="paid"?"sm-order-paid":""}>{order.status==="paid"?"Paid":String(order.status).replaceAll("_"," ")}</strong></div>
              <div className="sm-order-summary-item"><span>Order total</span><strong>€{(Number(order.price_cents)/100).toFixed(2)}</strong></div>
              <div className="sm-order-summary-item"><span>Video status</span><strong>{videoReady?"Ready":fulfillmentState==="failed"?"Under review":fulfillmentState==="processing"?"Checking status":fulfillmentState==="pending"?"Queued":"Not started"}</strong></div>
            </div>
            {promotion && <p role="status">
              Promotion {promotion.code}: EUR {(promotion.discount_cents/100).toFixed(2)}
              {" "}discount from EUR {(promotion.original_cents/100).toFixed(2)}.
              {" "}Redemption state: {promotion.state}.
            </p>}
            {promotion && Number(order.price_cents)===0 && order.status==="awaiting_payment" && <p role="status">
              Your free-video voucher is reserved, but video processing is not authorized yet.
              No payment or AI provider job has been started.
            </p>}

            {(authenticatedOwner||guestOwner) && order.status==="awaiting_payment" && !fulfillmentState &&
              Number(order.price_cents)>0 && customerLaunchReadiness().readyForPaidOrders &&
              <CustomerVideoCheckout orderId={id}
                staging={process.env.RAILWAY_ENVIRONMENT_ID==="dfaeabed-03df-43ed-aa71-50f343a75041"}/>}
            {authenticatedOwner && order.status==="awaiting_payment" && !fulfillmentState && <CancelUnstartedOrder orderId={id}/>}
            {(authenticatedOwner||guestOwner) && (order.status==="paid" || fulfillmentState!==null || videoReady) && <CustomerPaidOutput orderId={id} guest={guestOwner} amountCents={Number(order.price_cents)} />}
            {guestOwner && <p className="sm-order-assurance">No customer account required. Keep your private order link safe; it is needed to reopen this video on a new device.</p>}
            {order.status==="awaiting_payment" && <p>Payment has not been confirmed. No video generation has started. Complete secure Checkout to begin processing.</p>}
            <p className="sm-order-assurance">Probleme mit dem Video oder der Lieferung? <Link href="/contact">Reklamation und Support</Link>. Gesetzliche Ansprüche bleiben bestehen. <Link href="/withdrawal">Vertrag widerrufen</Link> ist davon getrennt.</p>
            {order.status==="paid" && !videoReady && <p className="sm-order-assurance">Your payment is confirmed. We will show the video here once processing and private validation are complete. You do not need to pay again.</p>}
          </>
        ) : checkout === "success" && /^[a-f0-9-]{36}$/.test(id) ? (
          <StripeOrderReturnRecovery orderId={id}/>
        ) : (
          <>
            {checkout === "recovered" && <p role="status">Your payment return was received, but your customer session could not be confirmed. Sign in to your customer account and reopen this same order link. Do not pay again.</p>}
            <GuestOrderAccess id={id} />
          </>
        )}
      </main>
    </div>
  );
}
