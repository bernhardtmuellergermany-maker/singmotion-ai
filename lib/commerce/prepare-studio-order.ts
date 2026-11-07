import { createHash } from "node:crypto";
import { prepareStudioDraft } from "../live/media.ts";
import { slowExcerpt } from "../live/tempo.ts";
import { dataDir } from "../db.ts";
import { reviewedVideoInputDigest } from "./reviewed-video.ts";
import { CommerceStore } from "./store.ts";
import { PlanLedger, quotePlanSeconds } from "./plans.ts";
import { PromotionLedger, normalizePromoCode } from "./promotions.ts";
import {OWNER_CONFIRMED_SINGLE_JOB_MAX_INPUT_SECONDS} from "./owner-confirmed-provider-policy.ts";

/** Server-only Studio -> commerce gateway. No public endpoint, no charge and no
 * BytePlus request. Caller must authenticate the account AND media owner. */
export async function prepareCustomerStudioOrder(
  store: CommerceStore,
  input: {
    accountId: string;
    email: string;
    mediaOwner: string;
    draft: unknown;
    projectId: string;
    requestKey: string;
    promoCode?: string;
  },
  env: Record<string, string | undefined> = process.env,
) {
  if (env.CUSTOMER_ACCOUNTS_ENABLED !== "true" ||
      env.CUSTOMER_ORDER_PREPARATION_ENABLED !== "true")
    throw Error("Customer order preparation is not enabled");
  if (!/^[a-f0-9-]{36}$/.test(input.accountId) ||
      !/^[A-Za-z0-9_-]{1,160}$/.test(input.mediaOwner) ||
      !/^[A-Za-z0-9_-]{1,160}$/.test(input.projectId) ||
      !/^[A-Za-z0-9_-]{8,160}$/.test(input.requestKey))
    throw Error("Authenticated account and Studio selection required");
  // The caller must never select a different customer's private uploads.
  if(input.mediaOwner!==`customer-${input.accountId}`)
    throw Error("Customer media owner mismatch");
  // Pay-per-video preparation only. Included Hobby seconds require the
  // separately reserved subscription fulfillment pipeline, never Checkout.
  // Never take a Stripe payment for audio outside the currently activated
  // provider/customer pricing interval. Encoded MP3 duration is authoritative.
  const maxSeconds=env.CUSTOMER_BYTEPLUS_OWNER_CONFIRMED_PRICING==="true" ?
    OWNER_CONFIRMED_SINGLE_JOB_MAX_INPUT_SECONDS : 300;
  let media = await prepareStudioDraft(input.draft, input.mediaOwner, maxSeconds);
  if (env.AUDIO_TEMPO_ENABLED === "true") {
    if (!media.recording?.songId || !/^[a-f0-9]{64}$/.test(media.recording.sourceSha256))
      throw Error("Verified original recording is required for customer tempo processing");
    // Earlier provider failures are independent, durable orders; they must
    // not prohibit uploading, editing or preparing a new user-initiated order.
    // A new order still requires separately approved Stripe Checkout and
    // BytePlus applies its own content review without any bypass.
    const digest=createHash("sha256").update(JSON.stringify([
      "customer-original-tempo-v1", input.accountId,
      media.recording.sourceSha256, media.imageSha256,
    ])).digest("hex");
    // Transform BEFORE pricing and Stripe Checkout. The immutable reviewed
    // customer order therefore binds the actual slowed MP3 and its measured
    // provider duration; no paid job is retimed or repriced retroactively.
    media=await slowExcerpt(media,dataDir,media.recording.songId,{
      sourceSha256:media.recording.sourceSha256,digest,
    },maxSeconds);
  }
  const plan = new PlanLedger(store.db).snapshot(input.accountId);
  const billableSeconds = Math.ceil(media.durationSeconds);
  if (!Number.isSafeInteger(billableSeconds) || billableSeconds < 5)
    throw Error("Invalid video duration");
  const quote = quotePlanSeconds(plan.code, plan.secondsRemaining, billableSeconds);
  // Fully included Hobby videos must never be sent through paid Checkout.
  // Mixed paid/allowance orders are reserved atomically by preparedVideoOrder.
  if (quote.extraCents === 0 && plan.code !== "hobby")
    throw Error("Hobby allowance required for zero-price order");
  // Fixed VAT-inclusive tariff. Do not trust a browser-supplied price.
  const promoCode = input.promoCode ? normalizePromoCode(input.promoCode) : undefined;
  // Only the server-calculated, VAT-inclusive excess is discountable. Never
  // apply coupons to BytePlus costs or silently deduct Hobby subscriptions.
  const promotion = promoCode
    ? new PromotionLedger(store.db).preview(promoCode,input.accountId,quote.extraCents,media.durationSeconds)
    : null;
  const cents = promotion?.finalCents ?? quote.extraCents;
  const reviewedInput = reviewedVideoInputDigest(media);
  const quoteEvidence = "reviewed-studio-eur-v1:" + createHash("sha256")
    .update(JSON.stringify({accountId: input.accountId, project: input.projectId,
      cents, originalCents: quote.extraCents, promoCode: promoCode || null,
      billableSeconds, plan: plan.code, inputDigest: reviewedInput, currency: "EUR"})).digest("hex");
  return store.preparedVideoOrder({
    account: input.accountId,
    email: input.email,
    project: input.projectId,
    cents,
    originalCents: promoCode ? quote.extraCents : undefined,
    promoCode,
    quoteEvidence,
    key: input.requestKey,
    media,
  });
}
