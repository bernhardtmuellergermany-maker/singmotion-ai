import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { CommerceStore } from "@/lib/commerce/store";
import { dataDir } from "@/lib/db";
import { stagingDenial } from "@/lib/staging";
import { customerAccountSettingsAccessible } from "@/lib/commerce/customer-live-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

/** Read-only, account-scoped historical ledger. No top-up or payment capability. */
export async function GET(req: NextRequest) {
  const denied = stagingDenial(req.headers.get("authorization"));
  if (denied) return denied;
  if (!customerAccountSettingsAccessible(process.env))
    return json({ error: "Credit overview currently unavailable." }, 403);

  const store = new CommerceStore(path.join(dataDir, "commerce.sqlite"));
  try {
    const accountId = store.session(req.cookies.get("sm_customer")?.value || "");
    if (!accountId) return json({ error: "Customer login required." }, 401);

    // Legacy ledger uses euro cents as its internal units: one historical unit
    // is displayed as one credit. New purchases are NOT enabled by this route.
    const reserved = store.db.prepare(
      "SELECT COALESCE(SUM(cents),0) AS total FROM customer_holds WHERE account_id=? AND state='reserved'"
    ).get(accountId) as { total: number };
    const total = store.db.prepare(
      "SELECT COALESCE(SUM(delta),0) AS total FROM customer_credits WHERE account_id=?"
    ).get(accountId) as { total: number };
    const rows = store.db.prepare(
      "SELECT id,delta,kind,created FROM customer_credits WHERE account_id=? ORDER BY created DESC,id DESC LIMIT 50"
    ).all(accountId) as Array<{ id: string; delta: number; kind: string; created: number }>;

    const availableCredits = Math.max(0, Math.trunc(store.balance(accountId)));
    const reservedCredits = Math.max(0, Math.trunc(Number(reserved.total)));
    return json({
      availableCredits,
      reservedCredits,
      totalCredits: Math.max(0, Math.trunc(Number(total.total))),
      currency: "EUR",
      purchaseEnabled: false,
      entries: rows.map((row) => ({
        id: row.id,
        credits: row.delta,
        type: row.kind === "order" ? "video" : row.kind === "verified-refund" ? "returned" : "adjustment",
        created: row.created,
      })),
    });
  } finally {
    store.close();
  }
}
