# One future paid OmniHuman 2.0 test: readiness review

Live generation remains disabled. This review makes no BytePlus or R2 requests,
changes no Railway settings and does not authorize a test.

## Evidence and limits

- Owner-confirmed R2 connectivity result: `ok: true`, `stage: complete`,
  `cleanup: deleted`. Private PUT, authenticated GET, temporary GET capability
  and both SHA-256 checks succeeded. This verifies the owner's connectivity
  path, not BytePlus fetching, bucket-policy auditing or a retention rule.
- Product Team evidence relayed by the owner: **USD 0.07 per generated video
  second before tax**. A five-second audio input can produce six seconds of
  video, with a confirmed **USD 0.42 maximum base charge before tax** for that
  case. This is not an inclusive cap. See the exact statements and limitations
  in [the billing update](BYTEPLUS_SUPPORT_EVIDENCE.md#product-team-billing-update--operator-provided-recorded-october-23-2026).
- Re-read the supplied October 15, 2026 `BytePlus API.txt` (source hash in
  [provider verification](PROVIDER_VERIFICATION.md)). It documents 4–300 seconds
  of input audio, queued-task cancellation, a one-hour output URL lifetime and
  possible task lookup expiry after 12 hours. It contains no billing rules;
  “Pricing” appears as footer navigation, not terms. Four seconds is an input
  minimum, not evidence of a billing minimum.
- Access to the BytePlus documentation domain remains blocked by the Cloud
  environment's proxy (CONNECT 403). No additional authoritative billing terms
  were obtainable here. The later Product Team response defines the meter, but leaves rounding ambiguous.

## New operator-provided Support evidence

[Support evidence and input policy](BYTEPLUS_SUPPORT_EVIDENCE.md) records general
private presigned R2/S3 support, required full 12-hour input availability including
queue time, no automatic input-fetch retry, 720p output up to five minutes and
one-hour output URL expiry. Pre-call content moderation rejection is not billed;
the later Product Team update additionally covers specified failed tasks and successful cancellation. Original ticket/date were not
provided and live behavior was not independently tested.

## Blocking evidence to obtain (no credentials needed)

Ask BytePlus support/account documentation for account-specific OmniHuman **2.0**
terms covering:

1. Clarify ambiguous duration rounding, minimum monetary charges, fees and tax
   bounds. No stated minimum duration is not verified zero. Obtain an inclusive
   worst-case bound covering the actual encoded input and generated output.
2. Clarify unlisted validation errors, cancellation races, uncertain submissions
   and settlement/reconciliation. Specified internal algorithm, download and
   processing-timeout failures and successful cancellation are reported uncharged;
   reservations are not automatically released from local status alone.
3. Any additional input range/redirect constraints if the current direct GET
   design requires them; operational retention and eventual account validation.
   The input availability requirement itself is now known: at least 12 hours,
   without automatic input-fetch retries.
4. Exact permitted HTTPS output hostnames and their ownership; whether redirects
   are required; exact dimensions/aspect handling, FPS, codecs, duration tolerance
   and whether polling can refresh an expired URL. Support confirms 720p, but
   1280×720/25fps fixture expectations are not a complete model guarantee.

Also finish the documented current Common Parameters/error/IAM review. Live
account entitlement/signature acceptance can only be verified by a separately
approved future request; deterministic signing already matches the pinned
BytePlus SDK.

## Safeguards and remaining implementation work

The existing SQLite ledger reserves an inclusive worst-case amount atomically
on approval. It retains reservations for success, failure, cancellation and
uncertain outcomes; no automatic refund or resubmission exists. Submission now
rechecks the current per-job and cumulative limits inside the transaction that
consumes the token, so lowering a cap after approval blocks the request.
Keep one durable ledger across runs/processes: recreating it would lose spending
history. These are application admission limits, not a provider-enforced account
spending cap. They cover generation only; R2 storage/operations and any other
charges need separate consideration. Unknown inclusive billing still blocks.

A reviewed `inputFetchWindowSeconds` is required before delivery. The policy now
requires at least 12h15m remaining immediately before submission regardless of a
smaller contract value. R2 uses a bounded 13-hour GET lease measured from before
upload, with no automatic renewal, reupload or paid resubmission. The explicit
cleanup method deletes only the two recorded objects after expiry plus one hour;
no lifecycle setting or automatic cleanup job is configured. See the
[design and safety margins](BYTEPLUS_SUPPORT_EVIDENCE.md).

Output downloads require an exact reviewed hostname, HTTPS, no embedded
credentials, no redirects, status 200, a 100 MiB cap and 120-second transfer
signal. Cookies are explicitly omitted and caching disabled. Downloads request
identity encoding, reject malformed/oversized lengths and encoded responses,
verify declared length, and cancel the body if exclusive private-file creation
fails. Partial/invalid files are removed; an existing file is never overwritten.
MP4 structure, audio/video, duration, dimensions/FPS and FFmpeg decoding must
validate before completion. Poll promptly to retrieve expiring results; a failed
or expired download never triggers a new generation.

The output allowlist remains unset. Exact-host checking alone does not pin DNS
or exclude private addresses after DNS resolution. Before live wiring, review
approved host ownership and enforce public-destination resolution/egress at the
connection boundary (including rebinding protection). Do not replace this with
wildcards or a separate DNS lookup followed by unpinned fetch. Codec guarantees
also still need contract evidence; decoding is not proof of a vendor codec SLA.

## Next operator steps

1. Obtain the remaining billing and output evidence above; retain the
   non-secret source/version with the reviewed contract. R2 connectivity does
   not need repeating solely for this code change.
2. Complete a reviewed implementation of the contract, output destination policy
   and isolated operator CLI. `assertBytePlusVerified()` and the production
   transport remain hard-blocked; environment variables alone cannot unlock
   them. The current CLI intentionally cannot submit a paid task.
3. Keep Railway `DEMO_MODE=true`, `GENERATIONS_ENABLED=false`,
   `ADMIN_DEMO_ENABLED=false`, `BYTEPLUS_LIVE_TEST_ENABLED=false`.
   Use only a separate operator process for a future authorized test.
4. Prepare one owned artist snapshot and one measured encoded MP3 excerpt of
   at least 4 seconds, comfortably below the duration cap. Review the exact
   English prompt, hashes, measured duration, confirmed billing revision and
   inclusive cost ceiling. MP3 padding counts toward measured duration.
5. Only after a new explicit authorization, use the server-only variables in
   `.env.byteplus.example` and `docs/R2_PRIVATE_INPUTS.md` plus the same durable
   `DATA_DIR`. Set reviewed positive `BYTEPLUS_LIVE_TEST_MAX_JOB_MICRO_USD`,
   `BYTEPLUS_LIVE_TEST_MAX_TOTAL_MICRO_USD` and
   `BYTEPLUS_LIVE_TEST_MAX_DURATION_SECONDS`. Do not use $0.28 as an assumed cap.
   Protect `BYTEPLUS_LIVE_TEST_OPERATOR_SECRET`; AK/SK remain server-side.
6. The completed future CLI must display the plan and require the existing exact
   `AUTHORIZE ONE PAID BYTEPLUS TEST <id> UP TO <amount> MICROUSD` confirmation.
   Reserve once, submit once, persist the provider task ID, then poll that ID and
   promptly download/validate. Reconcile ambiguous submissions manually; never
   replay the token or reset the ledger. Review actual charges before further
   authorization and return the isolated operator process to disabled settings.

All new verification uses mocked HTTP and fictional terms; no real paid request
has been made. The integration is not yet ready to authorize a paid submission.

Validation for this change: `npm run lint`, `npm run typecheck` and `npm test`
passed (80 automated tests). New regression coverage checks lowered cumulative
caps, unknown/insufficient input leases, output length/encoding rejection and
safe cancellation when private-file creation fails.

A network-blocked [offline preflight rehearsal](OFFLINE_PREFLIGHT.md) now checks
real media preparation, CLI output, snapshot hashes and fictional approval guards.
[Draft export and offline image review](OFFLINE_OPERATOR_DRAFT.md) now work without
creating a generation job. Transitioning an unpriced plan to a verified priced
approval remains blocked; passing offline tests does not unblock paid submission.

The [backend operator lifecycle](BACKEND_OPERATOR_WORKFLOW.md) now implements
same-plan verified-contract pricing and full mock orchestration, including
cancellation and crash recovery. A local read-only `byteplus:operator review`
command is available. Production pricing/approval/submission commands still fail
closed; no environment or contract-file input enables them.
