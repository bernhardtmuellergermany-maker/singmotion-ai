import { cookies } from "next/headers";
import path from "node:path";
import { CommerceStore } from "@/lib/commerce/store";
import { dataDir } from "@/lib/db";
import { ProductHeader } from "@/components/product-header";
import { GuestOrderAccess } from "@/components/guest-order-access";
import { CustomerPaidOutput } from "@/components/customer-paid-output";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Private order",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let order: Record<string, unknown> | null = null,
    fulfillmentState: string | null = null,
    videoReady = false,
    authenticatedOwner = false,
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
      authenticatedOwner = Boolean(account && order && order.account_id === account);
      if(authenticatedOwner && store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='promo_redemptions'").get())
        promotion = store.db.prepare("SELECT code,original_cents,discount_cents,state FROM promo_redemptions WHERE order_id=?")
          .get(id) as typeof promotion;
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
      <main id="content" className="account-content wizard-card">
        <h1>Your private order</h1>
        {order ? (
          <>
            <p>Status: {String(order.status)}</p>
            <p>
              Recorded total: EUR {(Number(order.price_cents) / 100).toFixed(2)}
            </p>
            {promotion && <p role="status">
              Promotion {promotion.code}: EUR {(promotion.discount_cents/100).toFixed(2)}
              {" "}discount from EUR {(promotion.original_cents/100).toFixed(2)}.
              {" "}Redemption state: {promotion.state}.
            </p>}
            {promotion && Number(order.price_cents)===0 && order.status==="awaiting_payment" && <p role="status">
              Your free-video voucher is reserved, but video processing is not authorized yet.
              No payment or AI provider job has been started.
            </p>}
            <p>Video order: {fulfillmentState === "pending" ? "Awaiting processing" : fulfillmentState === "processing" ? "Processing or under review" : fulfillmentState === "delivered" ? "Delivered" : fulfillmentState === "failed" ? "Needs support review" : "Not started"}</p>
            <p>Video ready: {videoReady ? "Yes" : "No"}</p>
            {authenticatedOwner && <CustomerPaidOutput orderId={id} />}
            {!videoReady && <p>Payment confirmation alone does not start BytePlus generation. The video will appear in the output card only after verified delivery.</p>}
          </>
        ) : (
          <GuestOrderAccess id={id} />
        )}
      </main>
    </div>
  );
}
