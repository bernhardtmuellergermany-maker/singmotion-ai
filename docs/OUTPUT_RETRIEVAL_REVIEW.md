# Retrieve the same first-test task after explicit output review

The operator can now complete one controlled lifecycle:
**offline review → one authorized submit → observe URL → separately approve exact
host/media policy → download/validate → private MP4**. These are deliberate stages,
not a second generation. No stage in the download command submits or uploads.
The public app and global production contract remain disabled.

## New Technical Support evidence

The operator relayed these statements as official BytePlus Technical Support
information. The original ticket, date, account-specific tax determination and
source export were not supplied; these are operator-provided evidence, not live
observations independently made during implementation:

1. Billing rounds generated video duration **DOWN to whole seconds**, except
   positive durations below one second are billed as one second. Example:
   **5.3 seconds bills as 5 seconds**.
2. A **5-second input may generate up to 6 seconds** of video. Maximum base charge
   for that stated case is **USD 0.42 before tax**.
3. **Taxes depend on billing country and account type. No inclusive maximum or
   applicable tax rate was provided.**
4. The currently observed output hostname is **`v16m-default.tiktokcdn.com`**,
   **but it may change**.

This clarifies the older ambiguous rounding quotation. At USD 0.07/generated
second the reported base-only rule is `max(1, floor(seconds)) * 70000` microUSD
for positive durations. Zero/invalid duration is rejected. Tests cover subsecond,
whole/fractional seconds, 5.3 → 350000 and 6 → 420000. The exact-input operator
review uses this base floor check; existing conservative generic-contract quantum
arithmetic remains unchanged. Old approvals/reservations are never repriced or
refunded automatically. No universal one-second output padding is inferred.

## Candidate hostname review — still NOT approved

`v16m-default.tiktokcdn.com` is recorded in code as informational evidence with
`approved: false`; output review templates leave `hostname` empty. It is a
syntactically valid exact DNS hostname for an HTTPS/443 URL. No wildcard,
suffix-based approval or production allowlist entry is introduced.

This session has **not** resolved it, connected to it, inspected its certificate
or independently verified its ownership, CDN tenancy or relation to the owner's
BytePlus task. A recognizable domain name or valid TLS certificate alone does not
establish that authorization. Before approval, retain the support ticket/source
confirming its use for the account/model and compare the exact hostname of the
persisted task's `video_url`. Record the reviewer, date and evidence separately.
Changing hosts requires another explicit exact-host review; never approve
`*.tiktokcdn.com`, redirects, aliases or an arbitrary host just to make a URL work.

Approval is scoped to the plan, immutable cost-review digest, provider task ID,
one exact host and a bounded media acceptance policy. It is an operator trust
decision, not an automatic promotion of the candidate or global provider contract.
The actual connection still resolves/checks all addresses and pins a fresh
TLS-authenticated HTTPS socket to a public IP. DNS rebinding, internal addresses,
redirects, credentials/cookies, transfer limits and private-file protections remain
as documented in [private output downloads](PRIVATE_OUTPUT_DOWNLOADS.md).

## Establishing a defensible inclusive cost bound

The clarified base calculation does **not** resolve tax. There is no valid tax
rate or inclusive cap available in the evidence supplied here. Do not infer tax
from the repository owner's name/location, R2 region, prepaid balance or the USD
pricing currency. A zero placeholder, arbitrary buffer or observed past invoice
alone is not a guaranteed future upper bound.

Ask BytePlus Billing/account support for a written determination tied to the
actual billing legal entity, billing country/address, business/consumer account
classification and applicable VAT/GST registration/exemption/reverse-charge
status. Supply those through the owner's private account channel, not this PR.
Request either:

- A tax/fee-inclusive USD maximum for this exact measured input/output bound,
  with explicit component bounds suitable for the current review fields; or
- Written applicable tax rules/rates and taxable base, including fees, minimum
  monetary charges, invoice/currency rounding order and any FX/payment charges,
  sufficient for the owner/accountant to derive an upper bound in microUSD.

Confirm whether taxes are invoiced separately, whether a documented exemption
actually applies, and which entity is responsible for payment. Corroborate with
current account tax settings/invoices; retain source and effective date. Include
any account-specific fixed charge or rounding increment in the bound. An arbitrary
application cap or wallet balance is not a provider-enforced inclusive ceiling.

Only then populate `taxMaxMicroUsd`, `feesMaxMicroUsd` and the summed
`inclusiveMaxMicroUsd` in the existing first-test cost review with evidence. Zero
requires affirmative supporting evidence. The 5-second example does not itself
cover a differently measured encoded input. If an inclusive bound cannot be
established, stop before the first paid submit. Existing funded attempts retain
their original immutable approval and reservation; this change does not create
an unpriced recovery path or release budgets. R2 charges are accounted separately.

## Exact local PowerShell workflow

Use the same existing DATA_DIR, `$plan`, `$owner`, `$reviewFile`, `$confirmation`
and isolated operator environment from [the first-test guide](FIRST_CONTROLLED_LIVE_TEST.md).
The existing result must have a saved provider task ID and state `output_observed`.
No `.env` values or Railway settings are changed automatically.

Generate an **offline, unapproved** output-review template:

```powershell
$outputReviewFile = Join-Path $env:DATA_DIR 'first-test-output-review.json'
npm.cmd run byteplus:first-test -- review-output --plan $plan --owner $owner --review-file $reviewFile --write-output-review $outputReviewFile
if ($LASTEXITCODE -ne 0) { throw 'Output review preparation failed.' }
```

The command refuses to overwrite a file. Review and fill its exact hostname,
width/height (1–4096), positive FPS (at most 120), duration range (within the
approved generated-video bound), supported video codec (`h264` or `hevc`) and
AAC audio (`aac`). These are explicit acceptance constraints, not guesses about
provider guarantees. Support currently has not confirmed exact dimensions/aspect,
FPS/codecs. Obtain those facts or deliberately review a suitable acceptance
policy; a mismatch will safely reject the file, never relax validation.

Fill `reviewedBy`, ISO `reviewedAt`, `evidence`, and acknowledgment exactly
`APPROVE_EXACT_HOST_AND_MEDIA_POLICY`. Leave plan/task/cost binding fields intact.
Reviewing the JSON does not approve its hostname globally or fetch any URL.
Compute its confirmation digest offline:

```powershell
$outputReport = npm.cmd --silent run byteplus:first-test -- review-output --plan $plan --owner $owner --review-file $reviewFile --output-review-file $outputReviewFile | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $outputReport.confirmationDigest) { throw 'Output approval incomplete.' }
$outputConfirmation = $outputReport.confirmationDigest
```

Only after that explicit review, enable the **additional** local download gate
and retrieve the already observed result:

```powershell
$env:BYTEPLUS_FIRST_TEST_DOWNLOAD_ENABLED = 'true'
npm.cmd run byteplus:first-test -- download --plan $plan --owner $owner --review-file $reviewFile --confirm-live-test $confirmation --output-review-file $outputReviewFile --confirm-output $outputConfirmation
$env:BYTEPLUS_FIRST_TEST_DOWNLOAD_ENABLED = 'false'
```

`download` deliberately rejects `--skip-download`. It still requires the original
operator secret, plan/environment gates and spending caps; it needs **no BytePlus
AK/SK or R2 credentials** and constructs neither provider nor R2 clients. The only
remote operation is the explicitly approved, pinned HTTPS GET. It does not infer
or refresh URLs from a hostname, change the global allowlist, or resubmit a task.

On success it prints `state: completed` and an absolute `outputPath` under
`DATA_DIR/live-output/`. Only a decoded, validated MP4 is marked complete. Files
use exclusive mode 0600 creation (keep appropriate Windows ACLs), with unique
partial names and an approval-bound final name. Review metadata and the completed
path are recorded under the SQLite read lease. Budgets remain reserved.

## Retry/resume and URL expiration

Run the **same `download` command** to resume after a failed transfer or restart,
with the same gate/approvals. It never repeats generation. A valid final file
left by a crash between rename and SQLite commit is recovered locally, even if
the URL has since expired. A completed file is revalidated and returned without
network access. Missing, invalid or redirected existing files fail rather than
being overwritten. Concurrent/stale download leases cannot commit. A crashed
lease may require waiting up to ten minutes before an explicit retry.

A 403/expired URL or changed host leaves the attempt `output_observed`, retains
its task ID/reservation and removes only this attempt's partial file. No automatic
refresh, retry, refund or second submission occurs. To explicitly re-read the
same provider task (requires the existing BytePlus AK/SK, no R2 credentials):

```powershell
npm.cmd run byteplus:first-test -- refresh-result --plan $plan --owner $owner --review-file $reviewFile --skip-download --confirm-live-test $confirmation
```

This issues **one** signed `CVSync2AsyncGetResult`, never SubmitTask. Only a `done`
result replaces the stored observation. Support has not confirmed that polling
refreshes expired URLs; it may return the same URL or no usable result. Failures
preserve the prior observation. If the new host differs, download remains blocked
until another explicit output review/digest is approved for that exact hostname.
If refresh is unavailable or the task lookup has expired, stop and reconcile with
Support; there is no paid resubmission fallback.

## What is ready and what is blocked

One task can now reach a private, validated local MP4 through a controlled,
operator-reviewed workflow, including restart/retrieval without another submit.
It is mock-tested, not live-provider verified. Remaining prerequisites are a
justified account-specific inclusive spending bound, explicit exact-host approval,
reviewed media validation expectations and eventual authorized real account/DNS/
TLS acceptance. The candidate remains unapproved and all live gates default off.

Validation completed in Cloud Linux / Node 24: lint, typecheck, production build,
all **128 automated tests**, staging security/worker checks, disposable root-owned
volume startup/restart checks, and all **eight desktop/mobile browser tests**
passed. Regression coverage includes actual CLI download through mocked DNS/HTTPS
boundaries, retained reservations, no second submit, expired URLs, changed hosts,
invalid MP4, local crash recovery and concurrent/stale lease fencing. No real
BytePlus/R2 requests or deployments occurred. Windows BOM/spaced paths are covered;
no native Windows execution was available in this session.
