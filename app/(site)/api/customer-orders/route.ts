import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { CommerceStore } from "@/lib/commerce/store";
import { prepareCustomerStudioOrder } from "@/lib/commerce/prepare-studio-order";
import { dataDir, limit } from "@/lib/db";
import { stagingDenial } from "@/lib/staging";
import { applicationOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const respond = (body: unknown, status = 200) =>
  NextResponse.json(body, {status, headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"}});

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
    // Never accept media owner, price or email from the browser.
    const order=await prepareCustomerStudioOrder(store,{
      accountId,email:String(account.email),mediaOwner:`customer-${accountId}`,
      draft:payload.draft,projectId:payload.projectId,requestKey:payload.requestKey,
    });
    return respond({orderId:order.id,checkoutReady:store.reviewedOrderReadyForCheckout(order.id)},201);
  } catch {
    return respond({error:"Studio order could not be prepared."},422);
  } finally {
    store?.close();
  }
}
