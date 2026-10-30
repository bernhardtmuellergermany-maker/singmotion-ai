import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { CommerceStore } from "@/lib/commerce/store";
import { dataDir } from "@/lib/db";
import { stagingDenial } from "@/lib/staging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = stagingDenial(req.headers.get("authorization"));
  if (denied) return denied;
  const { id } = await context.params;
  if (!/^[a-f0-9-]{36}$/.test(id))
    return NextResponse.json({ error: "Order unavailable." }, { status: 404 });
  const store = new CommerceStore(path.join(dataDir, "commerce.sqlite"));
  try {
    const account = store.session(req.cookies.get("sm_customer")?.value || "");
    const token = req.cookies.get(`sm_guest_${id}`)?.value;
    const order = store.ownedOrder(id, account, token);
    const fulfillment = store.db.prepare("SELECT state FROM customer_fulfillment_queue WHERE order_id=?").get(id);
    const videoAssetId = store.ownedDeliveredVideoAsset(id, account, token);
    return NextResponse.json({
      orderId: id,
      paymentStatus: order.status,
      fulfillmentStatus: fulfillment?.state ?? null,
      videoReady: videoAssetId !== null,
    }, { headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  } catch {
    return NextResponse.json({ error: "Order unavailable." }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  } finally {
    store.close();
  }
}
