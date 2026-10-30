import { createHash } from "node:crypto";
import { prepareStudioDraft } from "../live/media.ts";
import { reviewedVideoInputDigest } from "./reviewed-video.ts";
import { CommerceStore } from "./store.ts";

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
  const centsPerTenSeconds = Number(env.CUSTOMER_CENTS_PER_TEN_SECONDS);
  if (!Number.isSafeInteger(centsPerTenSeconds) ||
      centsPerTenSeconds < 1 || centsPerTenSeconds > 10000000)
    throw Error("Validated inclusive customer pricing is unavailable");

  // Owned upload resolution, audio trim, MIME/duration and private image checks.
  const media = await prepareStudioDraft(input.draft, input.mediaOwner, 10);
  const cents = Math.ceil(media.durationSeconds / 10) * centsPerTenSeconds;
  const reviewedInput = reviewedVideoInputDigest(media);
  const quoteEvidence = "reviewed-studio-eur-v1:" + createHash("sha256")
    .update(JSON.stringify({accountId: input.accountId, project: input.projectId,
      cents, inputDigest: reviewedInput, currency: "EUR"})).digest("hex");
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
