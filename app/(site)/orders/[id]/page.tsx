import { cookies } from "next/headers";
import path from "node:path";
import { CommerceStore } from "@/lib/commerce/store";
import { dataDir } from "@/lib/db";
import { ProductHeader } from "@/components/product-header";
import { GuestOrderAccess } from "@/components/guest-order-access";
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
            <p>Video order: {fulfillmentState === "pending" ? "Awaiting processing" : fulfillmentState === "processing" ? "Processing or under review" : fulfillmentState === "delivered" ? "Delivered" : fulfillmentState === "failed" ? "Needs support review" : "Not started"}</p>
            <p>Video ready: {videoReady ? "Yes" : "No"}</p>
            <p>Customer generation and secure video downloads are not yet activated. Payment confirmation alone does not start BytePlus generation.</p>
          </>
        ) : (
          <GuestOrderAccess id={id} />
        )}
      </main>
    </div>
  );
}
