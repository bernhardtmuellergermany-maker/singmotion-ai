import type { PreparedMedia } from "../live/store.ts";
import { CommerceStore } from "./store.ts";
import { verifyPrivatePaidMediaSnapshot } from "./verify-paid-media.ts";

/** Trusted worker boundary. No public route or provider credentials are exposed.
 * A submission error is intentionally NOT retried automatically: BytePlus may
 * have accepted it even if the response was lost. */
export async function submitReviewedPaidVideo(
  store: CommerceStore,
  orderId: string,
  operations: {
    prepare?: (orderId: string) => Promise<PreparedMedia>;
    submit: (media: PreparedMedia, orderId: string) => Promise<string>;
    verify?: (media: PreparedMedia) => Promise<void>;
  },
): Promise<"already-claimed" | "submitted" | "submission-uncertain"> {
  if (!/^[a-f0-9-]{36}$/.test(orderId)) throw Error("Invalid paid order reference");
  if (!store.claimPaidFulfillment(orderId)) return "already-claimed";
  // Prepare before opening the network submission barrier. An invalid input
  // leaves a claimed order for manual inspection, never auto-resubmits.
  // Default to the sealed, private order snapshot; never reconstruct from browser input.
  const media = operations.prepare ? await operations.prepare(orderId) : store.paidPreparedMedia(orderId);
  store.assertPaidOrderMediaUnchanged(orderId, media);
  await (operations.verify ?? verifyPrivatePaidMediaSnapshot)(media);
  // Check the immutable order commitment before crossing the paid provider boundary.
  if (!store.beginPaidProviderSubmission(orderId)) return "submission-uncertain";
  try {
    const jobId = await operations.submit(media, orderId);
    // A malformed provider ID is uncertain, not proof that nothing was billed.
    store.recordPaidProviderJob(orderId, "byteplus", jobId);
    return "submitted";
  } catch {
    // Do not swallow ambiguity by retrying or changing the queue to pending.
    return "submission-uncertain";
  }
}
