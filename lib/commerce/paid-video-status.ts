import { CommerceStore } from "./store.ts";
import { BytePlusProtocol } from "../live/byteplus.ts";
import type { Transport } from "../live/byteplus.ts";

/** Read-only customer fulfillment polling: never submits a second paid task.
 * A provider-reported completion is not delivery; a separate verified private
 * media ingestion step must record the asset before fulfillment is finalized. */
export async function pollPaidVideoStatus(
  store: CommerceStore,
  orderId: string,
  read: (jobId: string) => Promise<
    "in_queue" | "generating" | "done" | "not_found" | "expired" | "canceled"
  >,
): Promise<"awaiting-submission-review" | "pending" | "provider-completed" | "provider-canceled" | "outcome-unverified"> {
  if (!/^[a-f0-9-]{36}$/.test(orderId)) throw Error("Invalid paid order reference");
  const job = store.paidProviderJob(orderId);
  if (!job) return "awaiting-submission-review";
  if (job.provider !== "byteplus") throw Error("Unexpected paid provider");
  try {
    const status = await read(job.jobId);
    if (status === "in_queue" || status === "generating") return "pending";
    if (status === "done") return "provider-completed";
    if (status === "canceled") return "provider-canceled";
    return "outcome-unverified";
  } catch {
    // A read failure never proves the paid job failed or may be resubmitted.
    return "outcome-unverified";
  }
}

/** Explicit, injected BytePlus read-only adapter for trusted workers.
 * Does not construct a network client, submit, cancel, or deliver a video. */
export async function pollReviewedBytePlusJob(
  store: CommerceStore,
  orderId: string,
  transport: Transport,
  signal: AbortSignal,
) {
  const protocol = new BytePlusProtocol(transport);
  return pollPaidVideoStatus(store, orderId, async (jobId) => {
    const result = await protocol.status(jobId, signal);
    return result.status;
  });
}
