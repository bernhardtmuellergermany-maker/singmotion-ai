# Studio OmniHuman pilot (disabled by default)

Operator-provided evidence, 25 October 2026: task **2062100414** completed, private MP4 retrieval worked, and the owner confirmed realistic motion and good lip synchronization. No live request was made or result inspected during this implementation. This does not establish universal output hostnames, inclusive invoice limits, or duration bounds for longer clips.

## Implemented flow

An explicitly allowlisted Payload **Super Admin**, using their existing private Studio session, can upload MP3/WAV, trim an excerpt on the existing waveform, select one owned artist image and compose the existing English prompt. The existing FFmpeg/model checks enforce the **actual encoded MP3** duration (4–300s), image limits and hashes. MP3 padding may require shortening a selection near a cap; the server never silently relaxes the cap. Audio upload remains 50 MB; encoded provider audio must be below 15 decimal MB. Existing JPEG/PNG and private upload controls remain unchanged.

The compact Studio summary gains **Review real video cost — no paid request** only for the admin pilot. It snapshots the selection and saves a private project, measures the encoded clip and shows the prompt, an input-length pre-tax estimate at USD 0.07/s, and a separately reviewed inclusive reservation ceiling. Actual billing uses generated video duration. Confirmation binds the exact project, contract digest and ceiling; **Generate ONE real video** is a separate deliberate action. No credit balance or payment is charged/manufactured. Existing demo credits remain explicitly simulated and are not used by the pilot.

Jobs are persisted in the existing `live-test.sqlite`, with a new additive `live_studio_projects` table. All original operator slots, results, reservations and MP4s stay untouched. The shared sum of outstanding reservations—including both operator tests—counts against the explicitly configured Studio total USD ceiling. This is a new separately reviewed pilot budget, not an automatic extension/conversion of the earlier EUR 50 authorization. Reservations are never released based on presumed failure/refund. Identical selections reuse the same plan even across reloads or changed browser request IDs. Changing a selection creates a separate review, never an automatic submission.

My Projects includes the owned live projects. Status and MP4 routes require staging Basic Auth, Payload Super Admin allowlisting **and** the owning Studio session. No signed provider/R2 URL, task credential or filesystem path is returned. The ownership boundary can later be adapted to verified customer accounts; public/anonymous live generation is not implemented or unlocked by an environment switch.

## Readiness and staged rollout checklist

1. Preserve/backup `/app/.data`, `live-test.sqlite`, existing private media and operator MP4s. Do not reset anything. No database migration command is required; the additive table is created at runtime, never during build.
2. Review actual account-specific inclusive billing and generated-duration bounds for the intended input range. The five-second/6-second/USD 0.42 base example is **not** a universal padding rule or tax-inclusive price. Do not fill unknown tax/fees with zero. Conservative billing quantum arithmetic rounds upward for admission, not to claim BytePlus invoice rounding.
3. Copy the blank `config/studio-live-policy.example.json` to **`DATA_DIR/studio-live-policy.json`**, outside public assets/Git. Complete its evidence, reviewer, dates, explicit input range, generated-duration envelope and inclusive billing rules. Start with the proven short-clip range; enable longer clips only after reviewing a bound covering that range. All numeric nulls/blank evidence are intentionally invalid. Policy expiry stops new approvals; stored policy snapshots still permit recovery of already-paid tasks.
4. Review the successful MP4's actual exact HTTPS hostname, dimensions, FPS and codecs. Enter only approved **exact** hostnames, no wildcard; no hostname is approved by this code. Output acceptance requires 720 on the short side, at most 4096 on the long side, reviewed FPS, h264/hevc plus AAC and a duration tolerance no greater than the reviewed generated-duration allowance. The existing pinned-public-IP HTTPS downloader rejects internal IPs/rebinding/redirects, imposes 100 MiB/120s transfer limits, and fully decodes/validates the MP4 before exposing it. Large/long outputs may exceed these limits and remain blocked for review; they are never accepted silently.
5. Keep staging's existing `DEMO_MODE=true`, `GENERATIONS_ENABLED=false`, `ADMIN_DEMO_ENABLED=false`, `BYTEPLUS_LIVE_TEST_ENABLED=false`, CMS Origin and Basic Auth unchanged. Keep public generation and Stripe disabled.
6. Configure the separate server-only pilot controls below. Begin with `BYTEPLUS_STUDIO_ENABLED=false` and `BYTEPLUS_STUDIO_RECOVERY_ENABLED=false`; verify offline/tests first. On a separately authorized future rollout, enable recovery before submission, verify its heartbeat, allowlist only the intended staff ID, and choose independently reviewed hard caps. No setting/deployment was changed by this implementation.
7. In the **same browser/session**, log into Payload as that Super Admin and open `/studio`. Resolve displayed readiness blockers. Select/upload media, confirm rights and English prompt, click **Review real video cost**, check the measured duration/prompt/ceiling, then explicitly confirm and click **Generate ONE real video** only when authorized.
8. Open the saved live project. The worker polls/retrieves in the background; **Resume status / retrieve same task** manually resumes the same task. A validated result exposes playback and **Download MP4**. This is never another submission.

### Exact environment variables

| Variable                                                                 | Required value/purpose                                                                                   |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `BYTEPLUS_STUDIO_ENABLED`                                                | Defaults false. Only `true` permits new pilot approvals/submissions.                                     |
| `BYTEPLUS_STUDIO_ALLOWED_STAFF_IDS`                                      | Comma-separated Payload staff IDs, no automatic/admin wildcard. Super Admin role also required.          |
| `BYTEPLUS_STUDIO_OPERATOR_SECRET`                                        | Independent random server secret, at least 32 characters; never sent to browser.                         |
| `BYTEPLUS_STUDIO_MAX_DURATION_SECONDS`                                   | Integer 4–300; also restricted by actual encoded duration and reviewed policy input range.               |
| `BYTEPLUS_STUDIO_MAX_JOB_MICRO_USD`                                      | Positive reviewed per-job ceiling, integer microUSD. No default allowance.                               |
| `BYTEPLUS_STUDIO_MAX_TOTAL_MICRO_USD`                                    | Positive cumulative ceiling over **all** reservations in the existing ledger. No default allowance.      |
| `BYTEPLUS_STUDIO_RECOVERY_ENABLED`                                       | Defaults false. `true` enables recovery-only polling in the existing `npm run worker`; it cannot submit. |
| `BYTEPLUS_ACCESS_KEY_ID`, `BYTEPLUS_SECRET_ACCESS_KEY`                   | Existing server-side BytePlus credentials.                                                               |
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Existing private R2 configuration; 13-hour signed GET leases remain unchanged.                           |
| `DATA_DIR`                                                               | Existing `/app/.data` persistent volume. Never point at a fresh ledger to avoid caps.                    |

The recovery worker is part of the existing worker process; deployment startup is unchanged. It checks every 30 seconds, serially handles up to 20 eligible pilot tasks, and automatically reads for at most 13 hours after approval. Monitor worker health and pending results because provider URLs expire after roughly one hour. Browser GETs read saved state only. POST recovery, background polling and download have durable leases; a crashed lease may require waiting ten minutes. Network errors remain sanitized and never trigger resubmission. Successful URLs are stored privately for retry; validated MP4 files can be recovered after a rename/SQLite-commit interruption. Failed downloads retain the same task and reservation. Provider read errors such as 50510 are not proof of task failure or zero billing.

To pause: set `BYTEPLUS_STUDIO_ENABLED=false` while leaving recovery, existing allowlist, secret, credentials and storage intact. New submissions stop; existing task retrieval remains possible even after policy expiry or lower submission caps. This does not authorize any additional provider submission. `authorized`, `submitting` and `uncertain` states require operator reconciliation, never a replacement task or budget reset. Remote input cleanup remains available in the existing R2 adapter with expiry-plus-grace/exact-object checks; no cleanup action is added to the Studio UI/worker. Scheduling that maintenance is still an operational rollout requirement. No automatic customer object deletion is added.

## Remaining customer-launch blockers

- Durable verified customer login/account ownership and lifecycle (the pilot uses the current 30-day private Studio session plus staff auth); account/session deletion is blocked while charged ledger records require reconciliation. Loss/expiry of a session requires controlled ownership recovery, not changing IDs in the browser.
- Reviewed inclusive billing contracts for each advertised duration range, actual invoice reconciliation, customer price disclosures, account budgets, subscriptions/credits and tested payments. None are inferred from demo balances or the two tests.
- Independently reviewed output host/media policy from the actual successful task; monitored long-video transfer/validation capacity and queue concurrency; production end-to-end rehearsal and separately authorized rollout.
- Operational alerts/reconciliation for uncertain/expired tasks and output URLs, and scheduling expiry-safe R2 input cleanup. A newly observed unapproved output host stays blocked; adding it requires a separately reviewed recovery policy, not editing a browser allowlist. No public rollout switch bypasses these missing integrations.

Validation commands: `npm run lint`, `npm run typecheck`, `npm test`, `npx tsx tests/studio-live.browser.ts`, `npm run build`. Tests use mocks; no BytePlus/R2 request or paid generation occurs.

## First short-clip activation through Payload (offline preparation)

After a separately approved release of this code, open **Payload → dashboard → Studio pilot activation — offline only**. Click **Inspect successful task / my staff ID / recovery health**. This requires Super Admin authentication and staging Basic Auth, but does not require the Studio allowlist yet. It reports only the authenticated user's staff ID, worker health and owned task `2062100414`'s local validated MP4 metadata/hash, approved hostname and total outstanding reservations. No URL, cookie, credential or local path is exposed. Missing local task/output/approval or another owner's record blocks preparation. The cloud development workspace does not have Railway's successful MP4; its actual codecs/FPS are therefore measured on Railway, not assumed here.

The panel offers a **4–5-second encoded input / maximum 6-second output** pilot acceptance policy, with at most two seconds of duration deviation. These are explicitly approved application acceptance limits, not a universal inference from one successful video. Evidence for the separately reviewed ceiling must cover that intended short-clip range. The rate is USD 0.07 per generated second. The six-second base case is USD 0.42; a **provisional 19% planning uplift** yields USD 0.4998, **not verified BytePlus tax or a guaranteed inclusive charge**. Unknown minimums, fees and tax remain null. The independent aggregate admission ceiling must be explicitly entered, reviewed, and no smaller than that planning estimate. It is what the shared ledger reserves, bounded again by the configured per-job/total caps. Neither the previous EUR 50 budget nor the uplift establishes an inclusive USD guarantee.

Review the measured dimensions, codec, FPS and previously approved exact hostname. Enter the separate USD ceiling and its review basis, tick the explicit approval, then **Save private Studio policy — no paid request**. This locally revalidates the MP4, binds the observed evidence digest and authenticated reviewer, and creates `/app/.data/studio-live-policy.json` with mode 0600 and seven-day expiry. It never replaces an existing policy or edits the test ledger, MP4 or Railway variables. An existing/expired policy requires a separately reviewed server-side replacement; do not delete it to bypass a blocker.

In Railway, preserve all current BytePlus/R2 credentials and staging flags. Add the displayed staff ID to `BYTEPLUS_STUDIO_ALLOWED_STAFF_IDS`; supply `BYTEPLUS_STUDIO_OPERATOR_SECRET` (random ≥32-character server secret), set `BYTEPLUS_STUDIO_MAX_DURATION_SECONDS=5`, and set positive integer microUSD job/total caps from the approved ceiling. **Total must retain all outstanding reservations shown in Payload plus the new ceiling**; never assume earlier tasks were free. `BYTEPLUS_STUDIO_MAX_JOB_MICRO_USD` must cover the policy ceiling. Set `BYTEPLUS_STUDIO_RECOVERY_ENABLED=true`; keep `BYTEPLUS_STUDIO_ENABLED=false` until checks pass. Railway's existing Docker entrypoint launches `scripts/serve.mjs`, which starts both Next.js and the worker; do not replace the start command with `next start` alone. A manually approved configuration release/restart is required for these variables to take effect; no deployment is performed by this implementation.

The recovery loop writes a private `studio-recovery-health.json` heartbeat. The panel must show **recovery enabled / healthy true**; missing, stale (>180s), future or error heartbeats block new Studio submissions. This reports loop health, not a guarantee of provider availability. Once the policy, staff allowlist, credentials, worker and caps are reviewed, explicitly enable `BYTEPLUS_STUDIO_ENABLED=true` in a separately authorized configuration release. Keep `DEMO_MODE=true`, `GENERATIONS_ENABLED=false`, `ADMIN_DEMO_ENABLED=false`, `BYTEPLUS_LIVE_TEST_ENABLED=false`, public generation and Stripe disabled. In the same browser, open Studio, select a short clip whose actual encoded duration is ≤5 seconds, review its cost, and separately confirm **Generate ONE real video**. Saving the policy or enabling the flag never starts a generation.

For repeated private tests and independently reviewed 4–60s bands, see [Flexible Studio tests](STUDIO_FLEXIBLE_TESTS.md). The fixed EUR 50 authorization and atomic one-active-generation guard now additionally constrain new Studio approvals; old reservations and recovery paths are preserved. Existing short policies do not automatically authorize longer clips.

### Reconcile a blocked task without erasing its reservation

The operator-supplied October 15 OmniHuman document describes HTTP 500 / 50510
as “Algovproxy Risk Error / Content Pre-filter failed / Not needed” (retry).
It does **not** establish that a GetResult error is a final task status.
Do not infer terminal state or zero billing from that status-read error.

For project `live_93475956-5359-422e-a182-6dd557a1af30`, obtain a BytePlus
support response explicitly identifying the saved provider task ID and confirming
a terminal rejected, failed or canceled outcome. This change does not inspect or
modify the staging database, and does not release that project's lock automatically.

Open the saved project while signed into the allowlisted Payload Super Admin
and the owning Studio session. Expand **Super Admin: reconcile a confirmed terminal
task**. Retain the provider response in the operator's private evidence archive;
enter its support-case reference and SHA-256, select the confirmed outcome,
attest that the evidence was verified and confirm. No evidence URL is fetched.
The server records the authenticated reviewer, task binding, evidence hash,
reference and timestamp atomically with the terminal transition. An active poll
lease blocks reconciliation; retry after the poll finishes. This is a human
evidence-verification workflow, not automated verification of support documents.
Unknown submissions without an assigned task ID remain blocked.

Only the active-generation lock is released. All reservations remain counted,
including unresolved first/second operator tests; there is no refund or budget
reset. A new paid test still requires independent approval and available budget.

**Delete project** on a live Studio project hides it from My Projects after
confirmation. It never deletes files, ledger entries, provider IDs, evidence,
or reservations. Active/uncertain projects keep their lock and recovery worker.
Save the project URL before hiding it: the owning session can still open that
URL to poll, reconcile, play or download. Demo-project behavior is unchanged.

### Start fresh test

My Projects now offers **Delete project** on each private live project and
**Start fresh test**, even when every live project has been hidden. Deletion
removes the card after the server confirms the hide; deletion from details
returns to My Projects. It never releases a generation lock.

**Start fresh test** performs status/recovery reads on owned pending Studio
tasks, including hidden ones, without submitting a paid request. A verified
terminal response allows the existing lifecycle to release the active lock;
full reservations remain. Uncertain submissions, status-read errors, foreign
tasks and unresolved operator slots remain blockers. The result links owned
blocked projects to their existing evidence-backed reconciliation screen.
A clear check offers a Studio link, not a paid submission. A racing request
cannot bypass the existing transactional one-active-task and budget checks.
Select the new inputs, review their measured duration/cost and explicitly
confirm each generation. No public generation or payment settings change.

### Task 176942047: pre-filter recovery and explicit private exception

Operator-provided BytePlus Technical Support evidence: 50510 means Content
Pre-filter rejection and the task will not be generated. The operator reports
disabling the optional filter. This is semantic evidence, not proof that a
particular saved task returned that response; changing the console does not
change an old task's outcome.

Start fresh test / Resume status uses a task-bound GetResult response. An
HTTP 500 / integer code 50510 from that protocol call now establishes rejection.
The code atomically records its task ID, response hash, safe HTTP/provider codes,
support semantics and prior diagnostic with the terminal transition. Reservations
are not released. No raw provider message, signed URL or credential is logged.
A competing poll lease prevents this transition until recovery can run safely.

Historical diagnostics alone are not automatically promoted to terminal evidence.
The old implementation retained sanitized diagnostics, not a full task-bound
response, and this development workspace cannot inspect Railway's actual ledger.

For this one task only, an owning allowlisted Super Admin can open its project
(via Start fresh test's recovery link even if hidden), click **Acknowledge
unresolved-task risk — permit private testing**, and confirm the possible
overlapping generation/billing exposure. The old task remains unresolved, its
full reservation remains counted, and the audit records actor, timestamp, state,
diagnostic and acknowledgment. This exception is bound to the exact attempt,
owner and provider task 176942047. It cannot exempt another task or legacy
operator submissions. Only one additional non-exempt generation may be active.
A failed/canceled new task does not replenish the budget.

Then click **Start fresh test** → **Open Studio**, prepare new inputs, review the
ceiling and explicitly approve each new generation. All EUR 50/cumulative USD,
duration, policy, ownership and server authorization gates still apply. The
Studio cost review also discloses unresolved overlapping exposure. No new support
ticket is required for the generic 50510 explanation. No paid action occurs
during acknowledgment or readiness checks. Existing response/history/media
records remain untouched; no old task is resubmitted.

### Historical operator blockers in Start fresh test

The authenticated, allowlisted Super Admin now sees each blocking task's provider
ID (or “ID not assigned”), saved state and Studio/operator workflow. Only this
minimal operational metadata crosses ownership boundaries; private inputs,
prompts, output URLs and credentials do not.

Before reporting blockers, the staff-only readiness check examines retained
first/second-test poll results. A registered operator slot, matching durable
task ID, `readFailed: true` and numeric `sanitizedResult.code: 50510` establish
rejection under the operator-provided BytePlus Support semantics. An atomic
transition records the response hash, timestamp, reviewer and semantic basis,
retaining the original response, slot and full reservation. Active poll leases
and changed evidence prevent reconciliation. No new network request is needed
to evaluate this saved evidence.

If historical task 1660608639 lacks matching evidence, its blocker offers
**Acknowledge operator-task risk — permit private testing**. Confirm the displayed
task and overlapping generation/billing risk. The state is not falsely changed
to failed. The exception binds the registered historical operator slot, exact
task, authenticated reviewer and current Studio session. It admits private
Studio testing only, never a new first/second operator submission. All old
reservations remain counted against the EUR 50 and USD ceilings; one additional
non-exempt generation maximum and explicit per-generation approval still apply.

Click **Start fresh test** in My Projects; if necessary acknowledge the displayed
operator blocker, then **Open Studio** and review a new test. No further support
ticket is required for the generic 50510 semantics. Changing the provider filter
does not itself establish an old task's outcome. This development change does
not inspect or modify Railway data and does not deploy.
