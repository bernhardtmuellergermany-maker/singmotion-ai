import { createHash } from "node:crypto";
import { prepareStudioDraft } from "../live/media.ts";
import { reviewedVideoInputDigest } from "./reviewed-video.ts";
import { CommerceStore } from "./store.ts";
import { PlanLedger, quotePlanSeconds } from "./plans.ts";

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
  const media = await prepareStudioDraft(input.draft, input.mediaOwner, 300);
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
  const cents = quote.extraCents;
  const reviewedInput = reviewedVideoInputDigest(media);
  const quoteEvidence = "reviewed-studio-eur-v1:" + createHash("sha256")
    .update(JSON.stringify({accountId: input.accountId, project: input.projectId,
      cents, billableSeconds, plan: plan.code, inputDigest: reviewedInput, currency: "EUR"})).digest("hex");
  return store.preparedVideoOrder({
    account: input.accountId,
    email: input.email,
    project: input.projectId,
    cents,
    quoteEvidence,
    key: input.requestKey,
    media,
  });
}
