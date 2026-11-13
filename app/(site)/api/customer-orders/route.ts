import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { reviewedCustomerOrderKey } from "@/lib/commerce/studio-order-key";
import { CommerceStore } from "@/lib/commerce/store";
import { prepareCustomerStudioOrder } from "@/lib/commerce/prepare-studio-order";
import {customerLaunchReadiness} from "@/lib/commerce/readiness";
import { dataDir, limit } from "@/lib/db";
import { stagingDenial } from "@/lib/staging";
import { applicationOrigin } from "@/lib/request-origin";
import { privateCustomerVideoLinks } from "@/lib/commerce/customer-video-links";
import { customerOrderStatusFilter, ownedCustomerOrderStatuses } from "@/lib/commerce/customer-orders-query";
import {requireRights,recordRights} from "@/lib/rights";
import {session as mediaSession} from "@/lib/db";
import {prepareStudioDraft} from "@/lib/live/media";
import {quotePlanSeconds} from "@/lib/commerce/plans";
import {reviewedVideoInputDigest} from "@/lib/commerce/reviewed-video";
import {reviewedCustomerOrderMaxSeconds} from "@/lib/commerce/reviewed-customer-duration";
import {createHash} from "node:crypto";
import {legacyCustomerPurchaseRetired,LEGACY_PURCHASE_RETIRED_RESPONSE} from "@/lib/commerce/credits-only-commerce";

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
      // Display-only names are account-scoped; the financial order is immutable.
      store.db.exec(`CREATE TABLE IF NOT EXISTS customer_order_display_names (
        order_id TEXT NOT NULL,account_id TEXT NOT NULL,name TEXT NOT NULL,
        PRIMARY KEY(order_id,account_id)
      )`);
      const displayName=store.db.prepare(
        "SELECT name FROM customer_order_display_names WHERE order_id=? AND account_id=?"
      );
      const safeOrders=orders.map((item:Record<string,unknown>)=>{
        const alias=typeof item.orderId==="string"
          ?displayName.get(item.orderId,accountId) as {name:string}|undefined
          :undefined;
        return {...item,...privateCustomerVideoLinks(item),displayName:alias?.name??null};
      });
      return respond({orders:safeOrders});
    } finally {store.close();}
  }
  const readiness=customerLaunchReadiness();
  return respond({
    available: !legacyCustomerPurchaseRetired() && process.env.CUSTOMER_ACCOUNTS_ENABLED === "true" &&
      process.env.CUSTOMER_ORDER_PREPARATION_ENABLED === "true",
    checkoutEnabled: !legacyCustomerPurchaseRetired() && readiness.readyForPaidOrders,
    // Public, non-secret categories only. An estimate is never evidence of
    // a working Stripe/BytePlus delivery system.
    checkoutUnavailableReason: readiness.readyForPaidOrders ? null :
      "Stripe Checkout und private BytePlus-Videolieferung sind für diese Umgebung noch nicht vollständig freigegeben.",
  });
}

/** Edit only the visible name of an order owned by the authenticated customer.
 * This never changes purchase amounts, delivery, provider tasks or a guest order.
 */
export async function PATCH(req:NextRequest){
  const denied=stagingDenial(req.headers.get("authorization"));
  if(denied)return denied;
  if(process.env.CUSTOMER_ACCOUNTS_ENABLED!=="true")
    return respond({error:"Customer accounts unavailable."},503);
  const origin=applicationOrigin(req.url,req.headers.get("host"));
  if(!origin||req.headers.get("origin")!==origin)
    return respond({error:"Request origin is not allowed."},403);
  if(Number(req.headers.get("content-length"))>2048)return respond({error:"Request too large."},413);
  const raw=await req.text();
  if(Buffer.byteLength(raw)>2048)return respond({error:"Request too large."},413);
  let body:Record<string,unknown>;
  try{body=JSON.parse(raw) as Record<string,unknown>;}
  catch{return respond({error:"Invalid request."},400);}
  if(!body||typeof body!=="object"||Array.isArray(body))
    return respond({error:"Invalid request."},400);
  const id=body.orderId,name=body.name;
  if(typeof id!=="string"||!/^[a-f0-9-]{36}$/.test(id)||
     typeof name!=="string"||name!==name.trim()||name.length<1||
     name.length>80||/[\x00-\x1f\x7f]/.test(name))
    return respond({error:"Invalid order reference or project name."},400);
  const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
  try{
    const accountId=store.session(req.cookies.get("sm_customer")?.value||"");
    if(!accountId)return respond({error:"Customer login required."},401);
    limit(accountId+":customer-order-rename",20,60000);
    if(!ownedCustomerOrderStatuses(store.db,accountId,
       customerOrderStatusFilter(id,null)).some(o=>o.orderId===id))
      return respond({error:"Project not found."},404);
    store.db.exec(`CREATE TABLE IF NOT EXISTS customer_order_display_names (
      order_id TEXT NOT NULL,account_id TEXT NOT NULL,name TEXT NOT NULL,
      PRIMARY KEY(order_id,account_id)
    )`);
    store.db.prepare(`INSERT INTO customer_order_display_names(order_id,account_id,name)
      VALUES (?,?,?) ON CONFLICT(order_id,account_id) DO UPDATE SET name=excluded.name`
    ).run(id,accountId,name);
    return respond({orderId:id,displayName:name});
  }finally{store.close();}
}

/** Customer-only preparation. No Checkout, BytePlus request or paid worker start. */
export async function POST(req: NextRequest) {
  if(legacyCustomerPurchaseRetired())return respond(LEGACY_PURCHASE_RETIRED_RESPONSE,410);
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
    if (!accountId) return await prepareGuestOrder(req,store,payload);
    if(!store.emailVerified(accountId))return respond({error:"Verify your email before preparing paid video orders.",code:"EMAIL_NOT_VERIFIED"},403);
    const account=store.db.prepare("SELECT email FROM customer_accounts WHERE id=?").get(accountId);
    if (!account || typeof account.email!=="string")
      return respond({error:"Customer account unavailable."},403);
    // The customer's browser checkbox alone is not durable authorization.
    // Require affirmative rights + current legal version at the trusted order
    // creation boundary, before reserving any price/allowance/promotion.
    try{requireRights(payload.consent,payload.termsVersion);}
    catch{return respond({error:"Confirm rights and current terms before ordering."},409);}
    // A browser draft may survive a guest -> customer sign-in. Never silently
    // change its owner: asset ownership must stay verifiable server-side.
    if (!payload.draft || typeof payload.draft !== "object" ||
        (payload.draft as {owner?:unknown}).owner !== `customer-${accountId}`)
      return respond({error:"This Studio draft belongs to a different media session. Sign in, reopen Studio and upload or import the media into your customer account before paying.",code:"STUDIO_OWNER_MISMATCH"},409);
    // Historical purchases never count toward an artificial project ceiling.
    // Never accept media owner, price or email from the browser.
    if(payload.promoCode!==undefined &&
       (typeof payload.promoCode!=="string" || payload.promoCode.length>40))
      return respond({error:"Invalid promotion code."},400);
    // The project ID identifies the saved draft, NOT its immutable payable
    // order. A changed duration, image, audio, prompt or promotion must use a
    // different idempotency key. Legacy orders keyed only by project ID must
    // never be accidentally repriced or charged for a newer selection.
    const selectionOrderKey=reviewedCustomerOrderKey({
      accountId,projectId:payload.projectId,draft:payload.draft,
      promoCode:typeof payload.promoCode==="string"?payload.promoCode:undefined,
    });
    const order=await prepareCustomerStudioOrder(store,{
      accountId,email:String(account.email),mediaOwner:`customer-${accountId}`,
      draft:payload.draft,projectId:payload.projectId,requestKey:selectionOrderKey,
      promoCode:typeof payload.promoCode==="string" ? payload.promoCode : undefined,
    });
    // Audit the exact server-reviewed media input commitment, not only the
    // untrusted draft that the browser displayed.
    const reviewed=store.db.prepare("SELECT input_digest FROM customer_order_inputs WHERE order_id=?")
      .get(order.id) as {input_digest:string}|undefined;
    if(!reviewed||!/^[a-f0-9]{64}$/.test(reviewed.input_digest))
      throw Error("Reviewed media commitment unavailable");
    recordRights(store.db,accountId,order.id,String(payload.termsVersion),{
      session:`customer-${accountId}`,content:reviewed.input_digest,
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
    // Report safe categories without leaking file paths, provider diagnostics
    // or another account's media identifiers to the browser.
    if (error instanceof Error && /Draft owner does not match|Customer media owner mismatch/.test(error.message))
      return respond({error:"This Studio draft belongs to another media session. Reopen Studio as the signed-in customer and import or upload your audio and image.",code:"STUDIO_OWNER_MISMATCH"},409);
    if (error instanceof Error && /File not found|Asset must remain in private storage|song and one reference image/.test(error.message))
      return respond({error:"The reviewed audio or image is no longer available in this customer account. Reopen Studio and select your account's media.",code:"STUDIO_MEDIA_UNAVAILABLE"},409);
    if (error instanceof Error && /Invalid video duration|Selected segment exceeds|Invalid audio duration/.test(error.message))
      return respond({error:"The selected video duration is not eligible. Adjust the audio selection and review it again.",code:"STUDIO_DURATION_INVALID"},409);
    if (error instanceof Error && /Previous provider failure for this recording/.test(error.message))
      return respond({error:"This recording already has a failed BytePlus generation. Use a different eligible recording, or request an independent-content review. No payment was taken.",code:"PREVIOUS_PROVIDER_REJECTION"},409);
    if (error instanceof Error && /Encoded MP3|Tempo duration validation|Decoded tempo ratio|exceeds processing bounds|outside processing bounds/i.test(error.message))
      return respond({error:"At 90% speed this music excerpt exceeds the BytePlus duration limit or its timing could not be verified. Select a shorter excerpt and review the price again. No payment was taken.",code:"TEMPO_AUDIO_DURATION_INVALID"},409);
    if (error instanceof Error && /Verified original recording is required|Original customer audio changed/.test(error.message))
      return respond({error:"The original audio could not be verified. Reopen Studio and select the original recording again. No payment was taken.",code:"TEMPO_SOURCE_UNAVAILABLE"},409);
    // Log only an allowlisted category. Never log source file paths, raw
    // drafts, provider credentials, customer email or payment evidence.
    const reason=error instanceof Error?error.message:"";
    const category=/Idempotency conflict|reservation conflict/i.test(reason)?"ORDER_IDEMPOTENCY":
      /Immutable Studio snapshot|cloud source|archived|R2|mirror|private storage/i.test(reason)?"PRIVATE_MEDIA_STORAGE":
      /ffmpeg|ffprobe|audio|decode|encode|trim/i.test(reason)?"AUDIO_PREPARATION":
      /reference|image|sharp/i.test(reason)?"IMAGE_PREPARATION":
      /database|SQLITE|constraint/i.test(reason)?"ORDER_STORAGE":"UNKNOWN_PREPARATION";
    console.error("Customer Studio order preparation failed", {category});
    return respond({error:"The video could not be prepared. No Stripe payment or AI generation was started. Please retry from Studio.",code:"STUDIO_PREPARATION_FAILED"},422);
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

/**
 * Password-gated site guests can purchase without creating a customer account.
 * Their uploaded media remains in their original private Studio workspace.
 * A per-order random capability protects Checkout and later private delivery.
 */
async function prepareGuestOrder(req:NextRequest,store:CommerceStore,payload:Record<string,unknown>){
  if(typeof payload.email!=="string" ||
     !/^[^\s@]{1,100}@[^\s@]{1,150}\.[^\s@]{2,30}$/.test(payload.email.trim()) ||
     payload.promoCode!==undefined)
    return respond({error:"Enter a valid delivery email; promotions require a customer account."},400);
  const email=payload.email.trim().toLowerCase();
  const media=mediaSession(req.cookies.get("sm_session")?.value);
  const owner=media?.owner;
  if(!owner||!/^[a-f0-9-]{36}$/.test(owner)||
     !payload.draft||typeof payload.draft!=="object"||
     (payload.draft as {owner?:unknown}).owner!==owner)
    return respond({error:"Your private guest Studio session and uploaded files must match."},403);
  try{requireRights(payload.consent,payload.termsVersion);}
  catch{return respond({error:"Confirm your rights and current terms."},409);}
  const projectId=String(payload.projectId);
  if(!/^[A-Za-z0-9_-]{1,160}$/.test(projectId))
    return respond({error:"Invalid guest project"},400);
  const maxSeconds=await reviewedCustomerOrderMaxSeconds(dataDir);
  const prepared=await prepareStudioDraft(payload.draft,owner,maxSeconds);
  const quote=quotePlanSeconds("free",0,prepared.durationSeconds);
  if(quote.extraCents<=0)throw Error("Invalid guest price");
  const key=reviewedCustomerOrderKey({accountId:"guest:"+owner,projectId,draft:payload.draft});
  const inputDigest=reviewedVideoInputDigest(prepared);
  const quoteEvidence="reviewed-guest-studio-eur-v1:"+createHash("sha256")
    .update(JSON.stringify({owner,projectId,inputDigest,cents:quote.extraCents,
      seconds:quote.seconds,currency:"EUR"})).digest("hex");
  const created=store.preparedVideoOrder({account:null,email,project:projectId,
    cents:quote.extraCents,quoteEvidence,key,media:prepared});
  const reviewed=store.db.prepare("SELECT input_digest FROM customer_order_inputs WHERE order_id=?")
    .get(created.id) as {input_digest:string}|undefined;
  if(!reviewed||reviewed.input_digest!==inputDigest)throw Error("Guest immutable input mismatch");
  recordRights(store.db,owner,created.id,String(payload.termsVersion),{
    session:owner,content:inputDigest,
  });
  const previousToken=req.cookies.get("sm_guest_"+created.id)?.value;
  // Never issue a second capability after a retry, or reveal a prior token.
  if(!created.guestToken){
    if(!previousToken) return respond({error:"Existing guest order: reopen your saved private order link."},409);
    store.ownedOrder(created.id,null,previousToken);
  }
  const response=respond({orderId:created.id,checkoutReady:store.reviewedOrderReadyForCheckout(created.id),
    guest:true,...(created.guestToken?{guestAccessUrl:`/orders/${created.id}#access=${encodeURIComponent(created.guestToken)}`}:{})},201);
  if(created.guestToken)response.cookies.set("sm_guest_"+created.id,created.guestToken,{
    httpOnly:true,secure:true,sameSite:"lax",path:"/",maxAge:90*86400,
  });
  return response;
}
