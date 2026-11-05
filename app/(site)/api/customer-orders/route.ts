import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { CommerceStore } from "@/lib/commerce/store";
import { prepareCustomerStudioOrder } from "@/lib/commerce/prepare-studio-order";
import {customerLaunchReadiness} from "@/lib/commerce/readiness";
import { dataDir, limit } from "@/lib/db";
import { stagingDenial } from "@/lib/staging";
import { applicationOrigin } from "@/lib/request-origin";
import { privateCustomerVideoLinks } from "@/lib/commerce/customer-video-links";
import { customerOrderStatusFilter, ownedCustomerOrderStatuses } from "@/lib/commerce/customer-orders-query";
import {requireRights} from "@/lib/rights";

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
      const orderId=req.nextUrl.searchParams.get("orderId");
      const projectId=req.nextUrl.searchParams.get("projectId");
      let filter:ReturnType<typeof customerOrderStatusFilter>;
      try { filter=customerOrderStatusFilter(orderId,projectId); }
      catch { return respond({error:"Invalid order or project reference."},400); }
      const orders=ownedCustomerOrderStatuses(store.db,accountId,filter);
      const safeOrders=orders.map((item:Record<string,unknown>)=>({...item,...privateCustomerVideoLinks(item)}));
      return respond({orders:safeOrders});
    } finally {store.close();}
  }
  return respond({
    available: process.env.CUSTOMER_ACCOUNTS_ENABLED === "true" &&
      process.env.CUSTOMER_ORDER_PREPARATION_ENABLED === "true",
    checkoutEnabled: customerLaunchReadiness().readyForPaidOrders,
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
    // The customer's browser checkbox alone is not durable authorization.
    // Require affirmative rights + current legal version at the trusted order
    // creation boundary, before reserving any price/allowance/promotion.
    try{requireRights(payload.consent,payload.termsVersion);}
    catch{return respond({error:"Confirm rights and current terms before ordering."},409);}
    // Historical purchases never count toward an artificial project ceiling.
    // Never accept media owner, price or email from the browser.
    if(payload.promoCode!==undefined &&
       (typeof payload.promoCode!=="string" || payload.promoCode.length>40))
      return respond({error:"Invalid promotion code."},400);
    const order=await prepareCustomerStudioOrder(store,{
      accountId,email:String(account.email),mediaOwner:`customer-${accountId}`,
      draft:payload.draft,projectId:payload.projectId,requestKey:payload.requestKey,
      promoCode:typeof payload.promoCode==="string" ? payload.promoCode : undefined,
    });
    const saved=store.db.prepare("SELECT price_cents FROM customer_orders WHERE id=?").get(order.id) as {price_cents:number}|undefined;
    const freePromo=store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='promo_redemptions'").get()
      ? store.db.prepare("SELECT 1 FROM promo_redemptions WHERE order_id=? AND discount_cents>0").get(order.id)
      : undefined;
    return respond({orderId:order.id,
      checkoutReady:saved?.price_cents!==0 && store.reviewedOrderReadyForCheckout(order.id),
      includedOnly:saved?.price_cents===0 && !freePromo,
      promotionAwaitingActivation:saved?.price_cents===0 && !!freePromo},201);
  } catch (error) {
    if(error instanceof Error && error.message==="PRICE_CHANGED_REVIEW_AGAIN")
      return respond({error:"Your included seconds or price changed. Please review the current price again.",code:"PRICE_CHANGED_REVIEW_AGAIN"},409);
    if(error instanceof Error && error.message==="INCLUDED_HOBBY_REQUIRES_SUBSCRIPTION_FULFILLMENT")
      return respond({error:"This video is covered by your Hobby allowance. Paid Checkout is not applicable.",code:"HOBBY_INCLUDED_ONLY"},409);
    if(error instanceof Error && (/^Promotion |^Customer promotion |^VIDEO_TOO_LONG_FOR_PROMO$|^Authenticated paid customer price/.test(error.message)))
      return respond({error:"Promotion is unavailable, expired, exhausted or incompatible with this video.",code:"PROMOTION_UNAVAILABLE"},409);
    return respond({error:"Studio order could not be prepared."},422);
  } finally {
    store?.close();
  }
}

/** Authenticated, same-origin cancellation of an order never sent to Stripe or a worker.
 * Releases split-quote and voucher reservation in the same SQLite transaction. */
export async function DELETE(req: NextRequest) {
  const denied=stagingDenial(req.headers.get("authorization"));
  if(denied)return denied;
  if(process.env.CUSTOMER_ACCOUNTS_ENABLED!=="true")
    return respond({error:"Customer accounts unavailable."},503);
  const origin=applicationOrigin(req.url,req.headers.get("host"));
  if(!origin || req.headers.get("origin")!==origin)
    return respond({error:"Request origin is not allowed."},403);
  const orderId=req.nextUrl.searchParams.get("orderId")||"";
  if(!/^[a-f0-9-]{36}$/.test(orderId))
    return respond({error:"Invalid order reference."},400);
  let store:CommerceStore|undefined;
  try{
    limit("customer-order-cancel",20,60000);
    store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
    const accountId=store.session(req.cookies.get("sm_customer")?.value||"");
    if(!accountId)return respond({error:"Customer login required."},401);
    const cancelled=store.cancelUnstartedCustomerOrder(orderId,accountId);
    return respond({cancelled,status:"cancelled"});
  }catch{
    // Never reveal another account's order or whether its payment exists.
    return respond({error:"Order cannot be cancelled automatically. Contact support if Checkout has started."},409);
  }finally{store?.close();}
}
