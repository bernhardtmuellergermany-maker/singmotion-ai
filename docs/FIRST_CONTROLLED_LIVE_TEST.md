# One manually authorized OmniHuman 2.0 discovery test

This CLI is implemented, **not executed against live services**. The ordinary
provider transport, public app and production contract remain blocked. The new
`byteplus:first-test` command is a separate local operator entrypoint and is
never started by a web route, worker, build or deployment. Railway stays unchanged.

The generation `run`/`resume` commands require **`--skip-download`**. They can submit
one paid task, poll and record its output URL without approving or contacting the
unknown output host. There is no download bypass or wildcard. A separate operator `review-output` /
`download` / `refresh-result` workflow now supports retrieval of the same task
after explicit host/media approval; see [output retrieval](OUTPUT_RETRIEVAL_REVIEW.md).

## Required review before any paid submission

Start with an existing offline-reviewed owned plan and unchanged snapshots.
Encoded MP3 duration must actually be 4–5 seconds (inclusive), not just a nominal
five-second waveform selection. Encoding padding may require a shorter selection
and a newly prepared plan. The exact-case review binds the plan/owner, encoded
duration, image/audio SHA-256 hashes and composed English prompt hash.

A dry run generates a review template with **null costs and video bound**. It is
unpriced and non-authorizable until a human reviews all of:

- `generatedVideoMaxSeconds`: supported bound for this exact measured input, no
  more than six seconds for this narrowly scoped first-test mode.
- `baseMaxMicroUsd`, `taxMaxMicroUsd`, `feesMaxMicroUsd`: explicit conservative
  account-specific worst-case amounts. Tax/fee zero must be justified, never a
  placeholder. Base must cover at least the stated generated-duration rate;
  the base-only check now uses Support's clarified floor-with-one-second-minimum rule.
- `inclusiveMaxMicroUsd`: exact sum of these three components, in integer
  microUSD (one USD = 1,000,000 microUSD), within both spending caps.
- `reviewedBy`, ISO `reviewedAt`, and `evidence`: identify the reviewer and source,
  including why the inclusive bound covers this exact input, taxes and fees.
  Do not put keys or other credentials in the evidence text.
- `acknowledgment`: exactly `INCLUSIVE_BOUND_FOR_EXACT_INPUT`.

The USD 0.42 support statement is **before tax and for the stated five-second
input only**. It does not establish an inclusive amount or coverage of every
shorter input. Do not fill missing terms with assumptions. If a complete defensible
inclusive bound is unavailable, **stop at dry run**. The CLI enforces structural
and arithmetic checks; a human remains responsible for the truth of the evidence.
It does not certify a universal production billing contract or alter its hard gate.

The review digest printed by the dry run is the deliberate confirmation value.
Any change to the review, media identifiers or prompt invalidates it. A command
flag alone cannot authorize an unpriced plan. The operator secret must have at
least 32 characters and be present only in the server-side operator environment.

## Exact required environment variables

Use ignored `.env.first-test.local` in the repository root, copied from the
blank `.env.first-test.example`. Never load it into Railway/web/worker processes.
Existing shell environment variables override the env file in Node.

| Variable | Required value / purpose |
| --- | --- |
| `DATA_DIR` | Existing local private data directory containing the prepared `live-test.sqlite` and snapshots. Never use a fresh ledger to reset the allowance. |
| `DEMO_MODE` | `true` — public app remains demo-only. |
| `GENERATIONS_ENABLED` | `false` |
| `ADMIN_DEMO_ENABLED` | `false` |
| `BYTEPLUS_FIRST_TEST_DOWNLOAD_ENABLED` | `false` by default; explicitly `true` only for reviewed existing-result download. |
| `BYTEPLUS_FIRST_TEST_ENABLED` | `true` only in the deliberately authorized CLI session. Default `false`. |
| `BYTEPLUS_FIRST_TEST_PLAN_ID` | Exact reviewed plan ID. |
| `BYTEPLUS_LIVE_TEST_ENABLED` | `true` only in that isolated CLI session. Default `false`. |
| `BYTEPLUS_LIVE_TEST_OPERATOR_SECRET` | Private random secret, at least 32 characters. |
| `BYTEPLUS_LIVE_TEST_MAX_DURATION_SECONDS` | `5` (strict actual input duration cap). |
| `BYTEPLUS_LIVE_TEST_MAX_JOB_MICRO_USD` | Positive manually approved inclusive cap; procedure below uses the reviewed amount. |
| `BYTEPLUS_LIVE_TEST_MAX_TOTAL_MICRO_USD` | Same one-test cap, including any prior reservations in this ledger. |
| `BYTEPLUS_ACCESS_KEY_ID` | Existing dedicated IAM user's AK, server-side only. |
| `BYTEPLUS_SECRET_ACCESS_KEY` | Existing IAM user's SK, server-side only. |
| `R2_ACCOUNT_ID` | Existing Cloudflare account ID. |
| `R2_BUCKET` | `singmotion-ai-private` |
| `R2_ACCESS_KEY_ID` | Existing bucket-scoped R2 key. |
| `R2_SECRET_ACCESS_KEY` | Existing bucket-scoped R2 secret. |

Dry run/result need only the existing `DATA_DIR` and local plan ownership; they
do not load credentials or construct network clients. Resume/cancel require the
BytePlus keys but not R2 credentials; they do not upload inputs. Cleanup currently
checks the same operator gates/BytePlus credentials and uses R2 credentials to
delete only the two manifest objects after lease expiry plus grace.

The CLI locally adapts its private spending configuration to authorize a paid
operator action while **leaving `process.env.DEMO_MODE=true`**. This is intentional:
no global app flags are flipped, no public live route is enabled, and the ordinary
`liveSignedTransport` / `assertBytePlusVerified` remain unchanged. Merely possessing
keys or setting these variables does not start this script or submit a task.

## Exact Windows PowerShell procedure

Run from your existing local checkout with Node 24 and FFmpeg/ffprobe on PATH.
No global package installation is needed. Keep `.env.first-test.local`, the review
file and `.data` private with appropriate Windows account ACLs. POSIX mode 0600
alone is not a Windows ACL guarantee. Do not run a PowerShell transcript while
printing the private output URL.

Create the env file **only if it does not exist** and use your local secure editor
to populate the existing BytePlus/R2 credentials. Keep its enable flags false:

```powershell
if (-not (Test-Path .env.first-test.local)) {
  Copy-Item .env.first-test.example .env.first-test.local
}
$env:DATA_DIR = (Resolve-Path '.data').Path # Use your existing prepared DATA_DIR.
$plan = 'REPLACE_WITH_PREPARED_PLAN_ID'
$owner = 'REPLACE_WITH_OWNING_SESSION_ID'
$reviewFile = Join-Path $env:DATA_DIR 'first-test-review.json'
npm.cmd run byteplus:first-test -- dry-run --plan $plan --owner $owner --write-review $reviewFile
if ($LASTEXITCODE -ne 0) { throw 'Offline review failed; do not proceed.' }
```

`--write-review` exclusively creates a new file and refuses to overwrite one.
Review the offline image/report and prompt, then fill the review fields listed
above in that local JSON file. Do not change its plan binding fields. Once an
inclusive bound is justified, validate it offline and retain the digest:

```powershell
$report = npm.cmd --silent run byteplus:first-test -- dry-run --plan $plan --owner $owner --review-file $reviewFile | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $report.confirmationDigest) { throw 'Review incomplete; stop.' }
$confirmation = $report.confirmationDigest
$report | Select-Object planId, encodedAudioSeconds, inclusiveMaxMicroUsd, confirmationDigest
```

Only when you deliberately approve this exact reviewed expense, use a dedicated
local PowerShell session and run the following **once**. The secret assignment
captures its output rather than printing it; credentials remain in the env file.
This is the only step below that can submit a paid generation:

```powershell
$env:DEMO_MODE = 'true'
$env:GENERATIONS_ENABLED = 'false'
$env:ADMIN_DEMO_ENABLED = 'false'
$env:BYTEPLUS_FIRST_TEST_ENABLED = 'true'
$env:BYTEPLUS_FIRST_TEST_PLAN_ID = $plan
$env:BYTEPLUS_LIVE_TEST_ENABLED = 'true'
$env:BYTEPLUS_LIVE_TEST_OPERATOR_SECRET = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
$env:BYTEPLUS_LIVE_TEST_MAX_DURATION_SECONDS = '5'
$env:BYTEPLUS_LIVE_TEST_MAX_JOB_MICRO_USD = [string]$report.inclusiveMaxMicroUsd
$env:BYTEPLUS_LIVE_TEST_MAX_TOTAL_MICRO_USD = [string]$report.inclusiveMaxMicroUsd
npm.cmd run byteplus:first-test -- run --plan $plan --owner $owner --review-file $reviewFile --skip-download --confirm-live-test $confirmation
```

Do not put this command in a startup task, worker, deployment, CI or retry loop.
Close this dedicated shell afterwards, or disable its gates explicitly:

```powershell
$env:BYTEPLUS_FIRST_TEST_ENABLED = 'false'
$env:BYTEPLUS_LIVE_TEST_ENABLED = 'false'
Remove-Item Env:BYTEPLUS_LIVE_TEST_OPERATOR_SECRET -ErrorAction SilentlyContinue
```

## Successful URL observation and recovery

Before any R2 upload or BytePlus submit, SQLite records the singleton first-test
slot, prices the exact plan, reserves the inclusive amount and consumes its
one-time approval. Existing R2 code verifies/upload immutable buffers, issues
13-hour GET capabilities, and enforces at least 12h15m remaining before submit.
The signed submit happens at most once; its task ID is persisted immediately.

The CLI prints task ID/state progress, then polls every 15 seconds for at most
12 hours from slot claim. On `done` with a syntactically valid HTTPS `video_url`:

- Persist `state: output_observed`, task ID, observed time, URL and hostname in
  the private ledger. This is **not** `completed`; `outputPath` remains null.
- Persist a sanitized raw-response projection (numeric code, safe request ID,
  known status, video URL), discarding arbitrary messages/headers and echoed
  input URLs. This is not an unfiltered raw dump.
- Print JSON containing `observation.result.video_url` and
  `observation.result.observedHostname`, with `downloaded: false` and
  `hostnameVerified: false`. JSON escaping prevents terminal control sequences.
- Do **not** resolve/contact that host, download an MP4, modify the allowlist,
  release the reservation or create another generation.

The URL is a sensitive bearer capability and expires approximately one hour
according to Support; capture time is not proof of its exact expiry. Do not paste
it into a public issue/PR. The hostname alone can be shared for support review.
No automatic browser preview/open is performed. If it expires, consult Support
about safe read-only refresh; never resubmit a paid generation to refresh a URL.

Inspect persisted state without network activity:

```powershell
npm.cmd run byteplus:first-test -- result --plan $plan --owner $owner
```

After a crash/read timeout, rebuild `$plan`, `$owner`, `$reviewFile`, `$report`,
`$confirmation` and the same explicit environment gates in a dedicated session
as above. **Do not run `run` again.** If a task ID was persisted, resume polling:

```powershell
npm.cmd run byteplus:first-test -- resume --plan $plan --owner $owner --review-file $reviewFile --skip-download --confirm-live-test $confirmation
```

Resume never submits/uploads. A crashed poll lease may take up to ten minutes to
expire; wait, then explicitly resume. Read errors stop the command without
inventing a terminal failure. Terminal observations are printed from SQLite;
expired URLs are not refreshed automatically. At the 12-hour deadline, stop and
reconcile rather than automatically canceling, refunding or resubmitting.

If no task ID was durably saved (`submitting` or `uncertain`), reconcile with
BytePlus Support/account records. A crash between reservation and send can also
leave `authorized`; the command does not regenerate a token. These cases stop
safely even if no charge occurred. Never delete/reset/copy the ledger to bypass
the singleton, consumed approval or cumulative budget. There is no automatic
second-test unlock, even following a failed or successfully canceled task.

Optional **deliberate** cancellation checks the provider queue and consumes a
separate durable cancellation claim before any cancel call:

```powershell
npm.cmd run byteplus:first-test -- cancel --plan $plan --owner $owner --review-file $reviewFile --skip-download --confirm-live-test $confirmation
```

If the queue check or cancel is uncertain, resume polling; do not repeat cancel
requests automatically. Reservations remain held for operator reconciliation.
Private R2 cleanup remains a separate explicit action, allowed only after the
recorded 13-hour lease plus one-hour grace; it never lists customer objects:

```powershell
npm.cmd run byteplus:first-test -- cleanup --plan $plan --owner $owner --review-file $reviewFile --skip-download --confirm-live-test $confirmation
```

## Remaining blockers and validation

This mode makes one guarded **discovery** request possible; it does not declare
the live integration production-ready. A defensible manually reviewed inclusive
exact-case cost bound is still required. Account-specific minimum/fees/taxes,
verified output hostnames, codecs/FPS/dimensions/aspect, operational egress and
real account acceptance remain unverified. No default cost or host is supplied.
The separate operator downloader uses the pinned public-IP transport and FFmpeg
validation; an observed hostname is never automatically approved. Public live generation remains blocked.

Tests use mocked signed HTTP and R2 responses, deny real socket connections, and
exercise the actual CLI. They cover dry run, review/gate failures, singleton and
concurrent submit protection, uncertain submission, retained reservations,
cancellation, skip-download observation and restart/resume. Windows BOM/spaced
paths are covered; an actual Windows runner was not available in this session.

Validation completed in Cloud Linux / Node 24: lint, typecheck, production build,
all **122 automated tests**, staging authentication/security/worker checks,
root-owned-volume startup/restart checks, and **eight desktop/mobile browser
tests** passed. No real BytePlus or R2 requests were made. The mocked CLI test
executes the real entrypoint with network boundaries replaced and all real
socket connections denied.

Spending reservations cover the reviewed BytePlus generation bound. R2 storage
and request charges remain separately accounted for; the script does not claim
a provider-enforced account budget or configure a storage lifecycle policy.

## Offline review validation diagnostics

An incomplete `byteplus:first-test dry-run --review-file ...` exits with status 1
and writes `OFFLINE_REVIEW_INVALID` JSON to stderr. Its `issues` array names each
missing or invalid required field and gives a fixed explanation. For example:

```json
{
  "error": "OFFLINE_REVIEW_INVALID",
  "issues": [
    { "field": "taxMaxMicroUsd", "message": "Required; supply an explicitly reviewed value." },
    { "field": "reviewedBy", "message": "Required; supply an explicitly reviewed value." }
  ]
}
```

Checks include plan bindings, numeric bounds, cost arithmetic, review provenance,
dates and acknowledgment. Dependent arithmetic is checked only once its operands
are valid. Unknown fields are reported without echoing their names. Malformed,
unreadable or oversized review files receive a static `reviewFile` diagnostic;
parser excerpts, file paths, submitted values, URLs and credentials are omitted.

These diagnostics are restricted to offline dry-run errors. Other command
failures retain their generic safe message. Validation does not fill any review
fields, price a plan, reserve spending or enable submission. Fix only the named
fields using justified reviewed facts, then rerun the same dry-run command.
