import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { CommerceStore } from "@/lib/commerce/store";
import { PlanLedger } from "@/lib/commerce/plans";
import { prepareCustomerStudioOrder } from "@/lib/commerce/prepare-studio-order";
import { dataDir, limit } from "@/lib/db";
import { stagingDenial } from "@/lib/staging";
import { applicationOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const respond = (body: unknown, status = 200) =>
  NextResponse.json(body, {status, headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"}});

export async function GET(req: NextRequest) {
  const denied = stagingDenial(req.headers.get("authorization"));
  if (denied) return denied;
  if (req.nextUrl.searchParams.get("view") === "mine") {
    if (process.env.CUSTOMER_ACCOUNTS_ENABLED !== "true")
      return respond({error:"Customer accounts unavailable."},503);
    const store = new CommerceStore(path.join(dataDir,"commerce.sqlite"));
    try {
      const accountId=store.session(req.cookies.get("sm_customer")?.value || "");
      if (!accountId) return respond({error:"Customer login required."},401);
      // Read-only status: never expose provider identifiers, input paths, payment
      // evidence or another account's order. This endpoint does not dispatch work.
      const orders=store.db.prepare(`SELECT o.id AS orderId,o.project_id AS projectId,
        o.price_cents AS priceCents,o.currency,o.status,o.created,
        q.state AS fulfillmentState,
        CASE WHEN q.state='delivered' AND d.asset_id IS NOT NULL THEN 1 ELSE 0 END AS videoReady
        FROM customer_orders o
        LEFT JOIN customer_fulfillment_queue q ON q.order_id=o.id
        LEFT JOIN customer_video_deliveries d ON d.order_id=o.id
        WHERE o.account_id=? ORDER BY o.created DESC,o.id DESC LIMIT 50`).all(accountId);
      return respond({orders});
    } finally {store.close();}
  }
  return respond({
    available: process.env.CUSTOMER_ACCOUNTS_ENABLED === "true" &&
      process.env.CUSTOMER_ORDER_PREPARATION_ENABLED === "true",
    checkoutEnabled: false,
  });
}

/** Customer-only preparation. No Checkout, BytePlus request or paid worker start. */
export async function POST(req: NextRequest) {
  const denied = stagingDenial(req.headers.get("authorization"));
  if (denied) return denied;
  if (process.env.CUSTOMER_ACCOUNTS_ENABLED !== "true" ||
      process.env.CUSTOMER_ORDER_PREPARATION_ENABLED !== "true")
    return respond({error:"Customer order preparation is not enabled."},503);
  const origin = applicationOrigin(req.url,req.headers.get("host"));
  if (!origin || req.headers.get("origin") !== origin)
    return respond({error:"Request origin is not allowed."},403);
  let store: CommerceStore | undefined;
  try {
    limit("customer-order-preparation",10,60000);
    if (Number(req.headers.get("content-length")) > 8192)
      return respond({error:"Request too large."},413);
    const raw=await req.text();
    if (Buffer.byteLength(raw)>8192) return respond({error:"Request too large."},413);
    const payload=JSON.parse(raw) as Record<string,unknown>;
    if (typeof payload.projectId!=="string" || typeof payload.requestKey!=="string")
      return respond({error:"Invalid Studio project."},400);
    store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
    const accountId=store.session(req.cookies.get("sm_customer")?.value || "");
    if (!accountId) return respond({error:"Customer login required."},401);
    const account=store.db.prepare("SELECT email FROM customer_accounts WHERE id=?").get(accountId);
    if (!account || typeof account.email!=="string")
      return respond({error:"Customer account unavailable."},403);
    // Enforce the same Free/Hobby project quota in the customer commerce entry.
    // Revisions to an existing owned project do not consume another slot.
    const plan=new PlanLedger(store.db).snapshot(accountId);
    const known=store.db.prepare("SELECT 1 FROM customer_orders WHERE account_id=? AND project_id=? LIMIT 1").get(accountId,payload.projectId);
    if(!known){
      const existing=store.db.prepare("SELECT COUNT(DISTINCT project_id) AS count FROM customer_orders WHERE account_id=?").get(accountId) as {count:number};
      if(existing.count>=plan.maxProjects)
        return respond({error:`Your ${plan.code} plan allows at most ${plan.maxProjects} customer video projects.`,code:"PROJECT_LIMIT_REACHED",limit:plan.maxProjects},409);
    }
    // Never accept media owner, price or email from the browser.
    const order=await prepareCustomerStudioOrder(store,{
      accountId,email:String(account.email),mediaOwner:`customer-${accountId}`,
      draft:payload.draft,projectId:payload.projectId,requestKey:payload.requestKey,
    });
    return respond({orderId:order.id,checkoutReady:store.reviewedOrderReadyForCheckout(order.id), includedOnly:store.db.prepare("SELECT price_cents FROM customer_orders WHERE id=?").get(order.id)?.price_cents===0},201);
  } catch (error) {
    if(error instanceof Error && error.message==="PRICE_CHANGED_REVIEW_AGAIN")
      return respond({error:"Your included seconds or price changed. Please review the current price again.",code:"PRICE_CHANGED_REVIEW_AGAIN"},409);
    if(error instanceof Error && error.message==="INCLUDED_HOBBY_REQUIRES_SUBSCRIPTION_FULFILLMENT")
      return respond({error:"This video is covered by your Hobby allowance. Paid Checkout is not applicable.",code:"HOBBY_INCLUDED_ONLY"},409);
    if(error instanceof Error && error.message==="PROJECT_LIMIT_REACHED")
      return respond({error:"Project limit reached for the current plan.",code:"PROJECT_LIMIT_REACHED"},409);
    return respond({error:"Studio order could not be prepared."},422);
  } finally {
    store?.close();
  }
}
