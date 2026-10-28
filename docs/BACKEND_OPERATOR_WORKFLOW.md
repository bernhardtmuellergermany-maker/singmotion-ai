# Backend operator lifecycle — mocked end-to-end, live transport blocked

> Latest update: [clarified base billing, unapproved candidate hostname and
> operator-only existing-task MP4 retrieval](OUTPUT_RETRIEVAL_REVIEW.md).
> Rounding is clarified; inclusive taxes and host/media approval remain required.
> No real provider/R2 requests were made.

> **Operator discovery update:** [First controlled live test](FIRST_CONTROLLED_LIVE_TEST.md)
> documents a separate, explicitly gated one-plan CLI. It requires a manually
> reviewed inclusive exact-case bound and records the output URL without download.
> The ordinary production contract/transport and public flow remain blocked.
> No live request was performed during implementation.

This update completes internal lifecycle orchestration with dependency-injected
providers and fictional verified contracts. It does **not** enable a live operator
command, verify the pending billing/output contract, or authorize any paid test.
No real R2/BytePlus request, deployment or Railway change is part of this work.

## Audit and implemented changes

| Step           | Current behavior                                                                                                                                                                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Select/prepare | Existing Studio draft export resolves both assets by owner, trims MP3, checks actual duration and creates hash-bound private snapshots without a queued job.                                                                                                                                                              |
| Review         | Local `byteplus:operator review` reads the owned persisted plan. The existing private HTML report remains available for visual image/prompt review.                                                                                                                                                                       |
| Price          | `OperatorWorkflow.price` requires a trusted verified-contract resolver. Its production default throws. It revalidates owned media/private paths and atomically promotes the **same** unreserved plan; it never creates a duplicate source attempt.                                                                        |
| Bind contract  | Store the full reviewed contract and a deterministic SHA-256 digest with the revision/cost. A revision reused with different output, billing or other terms cannot authorize/submit the old plan. Identical concurrent pricing is idempotent; conflicting pricing is refused.                                             |
| Approve        | Revalidate media/contract, require operator secret plus exact one-time phrase, atomically reserve per-job/cumulative spend, and issue a short-lived hashed token. Pricing alone reserves nothing.                                                                                                                         |
| Submit         | Consume token before private delivery or HTTP. Exactly one input pair and submission invocation; persist the provider task ID before any polling. Failure/timeout is uncertain and cannot automatically resubmit.                                                                                                         |
| Poll           | Persisted ID only; exclusive SQLite lease across connections. Retryable reads leave the ID intact. Recheck the lease inside the state/file-commit transaction so an expired worker cannot commit a stale result.                                                                                                          |
| Download       | Existing exact-host HTTPS, no-redirect/no-cookie bounded downloader writes a unique lease-specific partial file. Decode/validate MP4, restrict permissions, then rename atomically into private storage under the checked lease. Never mark complete before validation.                                                   |
| Recover output | Check/validate a final private MP4 **before** another provider poll. A crash after rename but before the database commit can recover even if task lookup/output URLs have since expired.                                                                                                                                  |
| Cancel         | Explicit queued-only protocol cancellation under the same poll lease. A durable unique action claim precedes the request; cancellation timeout/crash cannot repeat it. Confirmed cancellation maps to local `failed` with `PROVIDER_TASK_CANCELED`; uncertainty leaves the task ID available for later read-only polling. |
| Cleanup        | Explicit operator orchestration invokes the existing R2 exact-two-key expiry-plus-grace cleanup. It cannot release spending reservations or resubmit work.                                                                                                                                                                |

No original image/audio copy, English prompt, hash or owner is changed by pricing.
The contract review and cancellation tables are additive; no volume/ledger data
is dropped. Existing legacy priced fixture records remain usable by low-level
tests, but the new operator boundary requires the full contract binding and will
refuse a legacy record without it. Do not edit the database to bypass that check.

## Offline commands available now (PowerShell)

Use the same local repository and private DATA_DIR as the prepared Studio draft.
The operator process is trusted by local filesystem access; the owner argument
is not a session token or a replacement for remote authentication.

```powershell
Set-Location 'C:\path\to\singmotion-ai'
$env:DATA_DIR = Join-Path (Get-Location).Path '.data' # Use the actual existing directory.
$env:DEMO_MODE = 'true'
$env:GENERATIONS_ENABLED = 'false'
$env:ADMIN_DEMO_ENABLED = 'false'
$env:BYTEPLUS_LIVE_TEST_ENABLED = 'false'
$planId = '<planId from the successful preflight report>'
$ownerId = '<owner from your own Studio draft export>'
npm.cmd run byteplus:operator -- review --plan $planId --owner $ownerId
npm.cmd run test:byteplus:backend
```

The read-only review reports status, measured duration, prompt, hashes, contract
binding/cost (null for unpriced plans), task ID and whether private output exists.
No keys, tokens, signed URLs or raw provider errors are printed. The HTML report
is the original unpriced snapshot review; consult the current CLI state to learn
whether a future verified workflow has priced the plan.

`price`, `approve`, `submit`, `poll`, `cancel` and `cleanup` CLI verbs deliberately
hit `assertBytePlusVerified()` **before** loading credentials, building a provider
or mutating the plan. There is no `--mock`, `--force`, JSON contract import or env
bypass. The mock backend rehearsal runs entirely in disposable private test data
with fictional credentials, signed transport backed by a fake HTTP function,
real S3 serializer/presigner backed by a fake handler, and fake MP4 download HTTP.
It uses FFmpeg for actual trimming/validation and blocks sockets. It does not
change the real prepared draft or any production flag.

## Future reviewed operator sequence (not executable/authorized now)

1. Obtain account-specific inclusive billing rules and the remaining output
   contract/security evidence. Review a pinned contract and change the production
   verifier only through a separately reviewed code change. Do not interpret a
   supplied JSON object or environment value as proof of verification.
2. Complete reviewed production transport/CLI wiring. The internal
   `OperatorWorkflow` accepts a verified-contract resolver, matching provider,
   downloader and exact-input cleanup dependency. None defaults to a real live
   provider. The existing `DocumentedBytePlusProvider`, signed transport and R2
   adapter were reused in mock integration tests, not duplicated.
3. Review the existing owner's plan, confirm English, and call `price` with the
   verified contract. Inspect the same plan ID, full contract digest and inclusive
   microUSD amount. Set bounded per-job/cumulative limits in an isolated operator
   process; leave Railway's flags untouched.
4. With separate explicit permission for that single paid test, approve the exact
   `AUTHORIZE ONE PAID BYTEPLUS TEST <id> UP TO <amount> MICROUSD` phrase using the
   server-only operator secret. Keep the returned token private and do not log it.
5. Submit once; retain the durable SQLite store. Poll only its task ID. If queued
   cancellation is explicitly requested, invoke it once and reconcile outcome;
   do not assume it refunds anything. A lost cancellation acknowledgement is not
   permission to repeat cancellation or generation.
6. Download and validate promptly, then retain the private MP4. At input expiry
   plus the configured grace, explicitly reconcile/delete only the recorded R2
   keys. Confirm actual charges before any further approval. Neither failure,
   success nor cleanup clears the reserved amount automatically.

## Recovery rules and operational limits

- `submitting` after a process crash and `uncertain` after a transport failure
  both forbid resubmission. Even a crash that appears to precede HTTP is not
  evidence of a safe retry. Reconcile with the provider/account. There is no
  automatic API for attaching an arbitrary task ID: account/ownership evidence
  and a reviewed recovery procedure are needed first.
- An expired read lease can be reclaimed after ten minutes. Older workers cannot
  overwrite final state or rename their partial file under a new lease. A crash
  may leave a private `.partial.mp4`; it is never trusted as a final result. After
  confirming the corresponding worker/lease is inactive, the operator may remove
  only that attempt's identified orphan partial file, not unrelated outputs.
- Filesystem rename and SQLite commit are not a single crash-atomic transaction.
  The supported ordering (validate, rename, save) deliberately leaves a valid
  final file for restart recovery if the DB commit fails. Failure before rename
  leaves only a partial. Input/output folders stay private, with Windows NTFS
  permissions remaining the operator's responsibility.
- Reads and cancellation currently use the same operator enable/authorization
  controls as submission. Do not toggle flags to resume a task until separately
  authorized; production CLI operations remain hard-blocked in this version.
- The code has request deadlines and bounded downloads, not an unattended daemon
  with scheduling/alerts. After a provider read error, invoke only a later poll;
  monitor the one-hour output URL and twelve-hour task lookup lifetimes.
- Output host verification is still required before real downloads. The default
  downloader now uses [pinned public-IP HTTPS](PRIVATE_OUTPUT_DOWNLOADS.md). An injected mock downloader is a test seam,
  not permission to bypass validation; the runner always validates its MP4.

## Validation and remaining evidence

The backend suite covers owned draft preparation, concurrent pricing, same-revision
contract changes, full signed submit/poll flow, restart, read failures, pending and
terminal states, invalid MP4s, cancellation/uncertain cancellation, consumed-token
replay, crashed submission claims, stale lease fencing and expiry-scoped cleanup.
Existing suites retain media, budget, authentication, R2/signing and staging tests.

Still pending: billing minimum/rounding/unsuccessful-task fees and tax bounds;
verified output hostnames, exact dimensions/aspect, codecs/FPS and deployment
egress review (connection pinning is implemented); current Common Parameters/IAM review; eventual live account acceptance;
operator retention/cleanup ownership and explicit one-test authorization. See
[Support evidence](BYTEPLUS_SUPPORT_EVIDENCE.md) and [readiness](BYTEPLUS_TEST_READINESS.md).

Validation completed in the Cloud Linux environment: lint, typecheck, production
build, all 102 automated tests (including nine backend integration scenarios),
staging production security checks, root-owned-volume startup/restart checks,
and all eight desktop/mobile browser checks passed. No real provider/R2 requests
were made. The operator commands use Node 24 strip-compatible TypeScript and
argument-based subprocess calls; an actual Windows run of this new backend suite
has not been performed here.

## Generated-video billing review

Pricing now requires an explicit reviewed generated-duration envelope and scope,
not direct use of encoded audio duration as billable duration. Missing legacy
envelopes are refused. See [Product Team billing evidence](BYTEPLUS_SUPPORT_EVIDENCE.md).
The stated five-second-input USD 0.42 maximum is before tax only; it does not
authorize pricing, general one-second padding or automatic reservation release.
Existing review commands remain offline and unpriced; all live commands stay blocked.
