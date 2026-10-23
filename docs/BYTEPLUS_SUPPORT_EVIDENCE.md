# OmniHuman 2.0 Support evidence and private input policy

## Source and scope

The operator relayed an official BytePlus Support response in this development
session. The original ticket/export, response date and support URL were not
provided. These are **operator-provided support statements**, not independently
verified account/API observations. They supplement the October 15, 2026 API
attachment; no real BytePlus or R2 requests were used to verify this update.

| Support statement relayed by the operator                                                                                                | Interpretation / action                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Private Cloudflare R2/S3 presigned HTTPS image/audio URLs are generally supported.                                                       | Retain object-scoped S3 GET capabilities. “Generally” is not proof that a particular live task/account will succeed.                                                                     |
| Inputs should stay accessible for at least the full 12-hour task lifetime, including queue time.                                         | Replace the insufficient one-hour input lease with the bounded policy below.                                                                                                             |
| No automatic input-fetch retry is provided.                                                                                              | Keep inputs continuously reachable; do not rely on eventual retry, renew/upload again automatically, or resubmit a paid task. Read-only task polling is distinct from input-fetch retry. |
| Output is 720p, up to five minutes.                                                                                                      | Record this evidence. Exact width/aspect handling, codec and FPS remain unknown; do not assume every output is 1280×720 at 25fps.                                                        |
| Generated video URLs expire after one hour.                                                                                              | Poll promptly and download immediately on completion; this output lifetime is independent of input validity.                                                                             |
| Pre-call content moderation rejections are not billed.                                                                                   | Do not extend this exemption to other validation errors, failed, canceled, expired or uncertain tasks. No automatic reservation refund is added.                                         |
| Minimum billing duration, rounding and charges for most unsuccessful tasks remain unknown. Output hosts, codecs and FPS are unconfirmed. | Keep the contract unset and production submission blocked.                                                                                                                               |

The previously owner-confirmed account rate remains USD 0.07/second before tax.
It is still insufficient to compute a verified inclusive worst-case charge.

## Bounded 13-hour input design

`lib/live/input-policy.ts` defines a fixed **46,800-second (13-hour)** S3 GET lease.
This is within Cloudflare's documented 1-second to 7-day presigning range (see
[R2 sources](R2_PRIVATE_INPUTS.md#evidence-and-tests)). It is not configurable via
an environment variable. The constructor rejects shorter/longer overrides.

The signing timestamp is captured, rounded down to seconds, and recorded before
both uploads. Upload/signing time consumes the lease rather than extending it.
Immediately before returning the lease and before provider submission, at least
**44,100 seconds (12 hours 15 minutes)** must remain. A larger reviewed contract
window is also enforced. An unknown contract window still fails closed.

The additional hour in the signed lifetime leaves at most 45 minutes for elapsed
pre-submission time plus the 15-minute remaining safety margin. In normal use the
upload operation already has a 60-second deadline. These margins are application
choices for clock/scheduling/transport overhead, not guarantees from Support.
Keep the operator clock synchronized; a clock jump consuming the margin fails
closed. Do not keep a lease to submit later without rechecking it. No URL renewal,
paid retry or longer fallback is performed when validity is insufficient.

The full 12-hour requirement applies from submission, not merely from signing.
Even with the allowed pre-submission elapsed time, a fetch 12 hours after
submission still has at least 15 minutes before URL expiry. The provider must be
able to fetch the inputs during the entire period: do not revoke the storage key,
delete objects, or configure a conflicting lifecycle rule before then.

The longer bearer lifetime is deliberately bounded and scoped: one immutable
approved MP3 and one image, GET-only signatures, exact account/bucket/object paths,
HTTPS, no ACL/public bucket changes, no browser exposure and no logged/persisted
URLs. Stored manifests contain the account ID, bucket, two private object keys
and expiry, not credentials or signatures. Timestamp, expiry and signature query
fields must be unique and match the locally generated lease. Existing hash,
ownership, atomic delivery claim and spend reservations remain mandatory.

## Expiry, deletion and retention

Expiry prevents subsequent signed access; **it does not delete stored objects**.
The adapter now provides an explicit internal operator method:
`cleanupExpired(attemptId, signal)`. It is not a web route, CLI deployment step,
worker schedule or automatic action in this change.

It permits deletion only after recorded expiry **plus one hour** (14 hours after
signing for this policy). It checks the current account/bucket and both paths
against the attempt's owner hash, ID, random delivery directory and approved
content hashes. Both keys are validated before either DELETE is sent. It never
lists objects, changes policies or deletes other prefixes. A cleaned marker is
written only after both deletions are acknowledged. Failure retains the manifest
and spending reservation. An explicitly requested retry can repeat those exact
idempotent deletes; it never repeats upload or generation. Failed/partial/crash
uploads can be reconciled from the same manifest after expiry plus grace.

Existing manifests lacking the new account binding are refused by this method
and require manual reconciliation. No database rows or volume data are removed.
No cleanup request has been performed here; all deletion tests use mocks.

Before a future test, agree who will invoke cleanup and verify bucket retention.
A separately approved lifecycle rule scoped only to `byteplus-inputs/` may serve
as a backstop (for example 24 hours or longer, after reviewing R2 lifecycle timing).
Never apply a bucket-wide rule or delete within the guaranteed access window.
This change configures no lifecycle rule. R2 storage/operations remain separate
from the BytePlus generation cap, and orphaned objects incur storage until
explicit cleanup or the separately configured lifecycle policy removes them.

## Remaining gates

- Account-specific minimum duration/charge, rounding, fees, taxes, billing meter,
  unsuccessful/canceled-task charges and an inclusive per-task upper bound.
- Exact output hostname allowlist, connection-level public-destination protection,
  codec/FPS and exact dimensions/aspect/duration expectations.
- Reviewed operator workflow for transitioning an offline plan to a priced
  approval, current Common Parameters/IAM review and live account acceptance.
- Operational retention/cleanup ownership and eventual explicitly authorized
  validation of BytePlus fetching. R2 connectivity is already owner-confirmed,
  but no real provider retrieval is claimed.

The production verification gate stays false, the live CLI/transport remain
blocked, and all demo/staging/spending settings remain unchanged. No automatic
refund is inferred even from the known moderation exception: safe classification
and charge reconciliation require a separately reviewed policy.

Validation: lint, typecheck and all 92 automated tests passed using mocks. New
coverage includes signed 13-hour expiry, a 12-hour delayed fetch window, exact
remaining-lifetime boundaries, upload delays, altered signed object paths,
partial upload/delete failures, cleanup grace and account/bucket/key isolation.
The separate non-sensitive connectivity probe retains its short 60-second GET
URL; it is not the provider input-delivery path and was not run here.
