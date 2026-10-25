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

| Variable | Required value/purpose |
| --- | --- |
| `BYTEPLUS_STUDIO_ENABLED` | Defaults false. Only `true` permits new pilot approvals/submissions. |
| `BYTEPLUS_STUDIO_ALLOWED_STAFF_IDS` | Comma-separated Payload staff IDs, no automatic/admin wildcard. Super Admin role also required. |
| `BYTEPLUS_STUDIO_OPERATOR_SECRET` | Independent random server secret, at least 32 characters; never sent to browser. |
| `BYTEPLUS_STUDIO_MAX_DURATION_SECONDS` | Integer 4–300; also restricted by actual encoded duration and reviewed policy input range. |
| `BYTEPLUS_STUDIO_MAX_JOB_MICRO_USD` | Positive reviewed per-job ceiling, integer microUSD. No default allowance. |
| `BYTEPLUS_STUDIO_MAX_TOTAL_MICRO_USD` | Positive cumulative ceiling over **all** reservations in the existing ledger. No default allowance. |
| `BYTEPLUS_STUDIO_RECOVERY_ENABLED` | Defaults false. `true` enables recovery-only polling in the existing `npm run worker`; it cannot submit. |
| `BYTEPLUS_ACCESS_KEY_ID`, `BYTEPLUS_SECRET_ACCESS_KEY` | Existing server-side BytePlus credentials. |
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Existing private R2 configuration; 13-hour signed GET leases remain unchanged. |
| `DATA_DIR` | Existing `/app/.data` persistent volume. Never point at a fresh ledger to avoid caps. |

The recovery worker is part of the existing worker process; deployment startup is unchanged. It checks every 30 seconds, serially handles up to 20 eligible pilot tasks, and automatically reads for at most 13 hours after approval. Monitor worker health and pending results because provider URLs expire after roughly one hour. Browser GETs read saved state only. POST recovery, background polling and download have durable leases; a crashed lease may require waiting ten minutes. Network errors remain sanitized and never trigger resubmission. Successful URLs are stored privately for retry; validated MP4 files can be recovered after a rename/SQLite-commit interruption. Failed downloads retain the same task and reservation. Provider read errors such as 50510 are not proof of task failure or zero billing.

To pause: set `BYTEPLUS_STUDIO_ENABLED=false` while leaving recovery, existing allowlist, secret, credentials and storage intact. New submissions stop; existing task retrieval remains possible even after policy expiry or lower submission caps. This does not authorize any additional provider submission. `authorized`, `submitting` and `uncertain` states require operator reconciliation, never a replacement task or budget reset. Remote input cleanup remains available in the existing R2 adapter with expiry-plus-grace/exact-object checks; no cleanup action is added to the Studio UI/worker. Scheduling that maintenance is still an operational rollout requirement. No automatic customer object deletion is added.

## Remaining customer-launch blockers

- Durable verified customer login/account ownership and lifecycle (the pilot uses the current 30-day private Studio session plus staff auth); account/session deletion is blocked while charged ledger records require reconciliation. Loss/expiry of a session requires controlled ownership recovery, not changing IDs in the browser.
- Reviewed inclusive billing contracts for each advertised duration range, actual invoice reconciliation, customer price disclosures, account budgets, subscriptions/credits and tested payments. None are inferred from demo balances or the two tests.
- Independently reviewed output host/media policy from the actual successful task; monitored long-video transfer/validation capacity and queue concurrency; production end-to-end rehearsal and separately authorized rollout.
- Operational alerts/reconciliation for uncertain/expired tasks and output URLs, and scheduling expiry-safe R2 input cleanup. A newly observed unapproved output host stays blocked; adding it requires a separately reviewed recovery policy, not editing a browser allowlist. No public rollout switch bypasses these missing integrations.

Validation commands: `npm run lint`, `npm run typecheck`, `npm test`, `npx tsx tests/studio-live.browser.ts`, `npm run build`. Tests use mocks; no BytePlus/R2 request or paid generation occurs.
