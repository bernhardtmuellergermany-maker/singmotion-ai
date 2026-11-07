import { BytePlusError } from "./byteplus.ts";
/** Public allowlist only: never copy arbitrary provider text, URLs or credentials. */
const explanations: Record<string, string> = {
  TRANSPORT_AUTHENTICATION:
    "BytePlus rejected authentication. Check server AK/SK, IAM permissions and clock; do not submit again.",
  TRANSPORT_THROTTLED:
    "BytePlus throttled the status read. Wait and check this same task again.",
  TRANSPORT_TRANSIENT:
    "Status read failed or timed out. Check this same task again; its outcome remains unknown.",
  TRANSPORT_PROTOCOL:
    "Signing or HTTP/JSON response validation failed. Check server configuration and the documented response format.",
  PROVIDER_REJECTED:
    "BytePlus rejected the status read; use the HTTP/provider codes below to reconcile with support. Do not resubmit.",
  INVALID_PROVIDER_RESPONSE:
    "BytePlus returned an invalid response shape. The existing task is retained; provider response documentation is needed.",
  UNSUPPORTED_TASK_STATUS:
    "BytePlus returned an undocumented task status. Task remains recoverable; verify the provider status specification before changing parsing.",
  COMPLETED_WITHOUT_VIDEO_URL:
    "BytePlus reported completion without a documented video_url. Retry the same task read; do not generate again.",
  TASK_OUTCOME_UNVERIFIED:
    "Provider task status is missing or expired. Its final outcome is unverified; retain the lock and reservation until provider evidence is reconciled.",
  POLL_BUSY:
    "Another status read holds the lease. Wait up to ten minutes after an interrupted read, then resume this same task.",
  TASK_BINDING:
    "Task, plan or saved cost approval does not match the durable one-test authorization. Refresh saved status; do not reset the ledger.",
  OUTPUT_URL_INVALID:
    "The returned output URL failed HTTPS URL validation. No video was fetched; reconcile the same task with support.",
  POLL_STATE:
    "No pollable persisted task is available. Refresh saved status; never resubmit an uncertain task.",
  POLL_GATES:
    "Server test gates, exact plan binding, secret or spending caps are invalid. Review the panel checklist; do not change saved cost approvals.",
  POLL_STORAGE:
    "Private ledger read/write failed. Check volume access and database availability; retain the existing ledger.",
};
export class PollError extends Error {
  readonly code: string;
  readonly httpStatus?: number;
  readonly providerCode?: number;
  constructor(code: string, httpStatus?: number, providerCode?: number) {
    const safe = Object.hasOwn(explanations, code) ? code : "POLL_STORAGE";
    super(
      `[${safe}] ${explanations[safe]}${httpStatus ? ` HTTP ${httpStatus}.` : ""}${providerCode !== undefined ? ` Provider code ${providerCode}.` : ""}`,
    );
    this.code = safe;
    this.httpStatus = httpStatus;
    this.providerCode = providerCode;
  }
}
export function pollError(error: unknown): PollError {
  if (error instanceof PollError) return error;
  if (error instanceof BytePlusError)
    return new PollError(
      error.diagnostic.code,
      error.diagnostic.httpStatus,
      error.diagnostic.providerCode,
    );
  if (error instanceof Error && error.name === "TimeoutError")
    return new PollError("TRANSPORT_TRANSIENT");
  const message = error instanceof Error ? error.message : "";
  if (message === "Another worker is polling this attempt.")
    return new PollError("POLL_BUSY");
  if (message === "Invalid observed output URL.")
    return new PollError("OUTPUT_URL_INVALID");
  if (message === "First-test review or durable slot does not match.")
    return new PollError("TASK_BINDING");
  if (
    message ===
    "Only a persisted provider job may be polled; uncertain submissions require manual reconciliation."
  )
    return new PollError("POLL_STATE");
  return new PollError("POLL_STORAGE");
}
