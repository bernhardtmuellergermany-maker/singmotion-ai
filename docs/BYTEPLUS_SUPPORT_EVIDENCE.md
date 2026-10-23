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

## Product Team billing update — operator-provided, recorded October 23, 2026

The operator relayed these statements as an official Product Team response.
The ticket, original response date and account contract were not supplied; this
is evidence supplied by the operator, not independently verified billing.
The earlier table above is historical; this update supersedes its unknown meter
and specified unsuccessful-task categories:

- “USD 0.07 per generated video second before tax.”
- “No stated minimum billable duration.”
- “Billing is based on generated video duration, not input audio duration.”
- “rounded down; however, any fraction less than a full second is counted as 1 second.”
- “Failed tasks (internal algorithm errors, input download failures, processing timeouts) are not charged.”
- “Successfully canceled tasks are not charged.”
- “A 5-second audio input may produce up to 6 seconds of video.”
- “Support confirms a maximum base charge of USD 0.42 before tax for that 5-second input.”

The rounding sentence is ambiguous. We implement neither floor nor ceil as an
asserted invoice algorithm. No *stated* minimum does not verify a zero minimum.
The USD 0.42 bound is **420,000 microUSD before tax for the stated case only**.
It is not an inclusive spending cap, a general one-second expansion rule, or a
bound for an MP3 that actually measures 5.04 seconds. No tax rate is assumed.
No-charge evidence is limited to the listed outcomes and successful cancellation;
a cancel request, timeout, uncertain submit or local download failure is not
proof of a no-charge outcome. Reservations remain retained for reconciliation.

### Pricing implementation and next operator steps

All internal pricing/revalidation now uses `planUpperBoundMicroUsd`, requiring
an explicit reviewed generated-video duration envelope with evidence and an
input range. Missing/legacy envelopes fail closed. The envelope is included in
the full immutable contract digest. Only fictional test contracts have one;
no production envelope or billing contract is installed. In particular, the
five-second example must never justify an envelope over all input durations.
The low-level upward quantum arithmetic is a conservative admission calculation
for explicitly reviewed rules, not documentation of BytePlus invoice rounding.

Keep draft plans unpriced and non-authorizable. Before a future pricing review:

1. Obtain a complete inclusive worst-case account contract: clarify rounding,
   monetary minimums/fees, applicable taxes and currency rounding. A reviewed
   inclusive exact-case bound could avoid needing a universal billing formula;
   the current pre-tax statement cannot. Do not populate unknowns with zero.
2. Match the **measured encoded** input duration to the documented bound's scope.
   Obtain coverage for that actual duration, or prepare and measure a new draft;
   do not round the input down or infer shorter inputs inherit the same bound.
3. Review output hostnames and public-destination connection protections,
   dimensions/aspect, codecs, FPS and duration validation. Support's six-second
   example does not automatically widen output validation for every job.
4. Review the complete contract and operational cleanup, then obtain separate
   explicit authorization. Keep all live gates disabled until that later review.

No refunds, automatic retries, pricing CLI bypass, paid calls or settings changes
are introduced. SQLite atomic reservations, cumulative caps, single-use approval
and uncertain-submission protection are unchanged.

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

- Account-specific minimum charges, ambiguous rounding, fees, taxes and an
  inclusive bound covering the measured input; unlisted/uncertain outcomes.
  Generated-video billing and the listed no-charge outcomes are now evidenced.
- Exact output hostname allowlist, deployment egress review, codec/FPS and exact
  dimensions/aspect/duration expectations. Connection-level public-IP pinning is
  now implemented; see [private output protection](PRIVATE_OUTPUT_DOWNLOADS.md).
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

Billing-update validation (October 23, 2026): lint, typecheck, production build
and all **107 automated tests** passed. Five new billing tests cover generated
video vs audio duration, exact input scope including MP3 overrun, missing legacy
bounds, missing tax information, retained unpriced plans, and exact per-job and
cumulative cost boundaries. Staging authentication/worker checks, disposable
root-owned volume checks, six desktop/mobile browser tests and two offline
review browser tests also passed. Provider/storage responses were mocked; no
real BytePlus or R2 calls, deployments or account settings changes were made.
