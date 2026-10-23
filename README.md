# SingMotion AI

**Your music. Your artist. Your performance.**

A responsive Next.js studio for a **local, private demonstration** of a singing-video workflow. All customer copy is English. The supplied desktop and mobile mockups inform the restrained indigo, warm-white design, responsive editor, preview, and mobile steps.

## Run locally

Requirements: **Node.js 24**, npm, `ffmpeg` and `ffprobe` on `PATH`. No paid keys, database account, GPU, or hosted service is needed.

```sh
cd /workspace/singmotion-ai # or your existing checkout
npm ci
cp .env.example .env.local # only if this file does not already exist
npm run dev
```

In a second terminal, from the same repository:

```sh
npm run worker
```

After both processes are ready, `npm run smoke` verifies the local startup without leaving test data.

Use port 3000 in your local development browser. The cloud onboarding UI does not provide a user-facing preview. Existing cloud tasks are already isolated; use the existing checkout, not an extra Git worktree.

`DEMO_MODE=true` is the default. Setting it to `false` **disables the API**, rather than enabling paid services. Both web and worker must use the same `DATA_DIR` (default `.data`) and pricing configuration. Next reads `.env.local`; the npm worker and cleanup commands also load it. No environment file is committed with real credentials.

### What to try

1. Open `/studio`, upload an actual MP3 or WAV (50 MB maximum), and wait for validation.
2. Drag or keyboard-adjust waveform handles, or enter exact start/end seconds. Preview the selection. Recommended length: 5–10 seconds; maximum selected length: 300 seconds.
3. Add an artist and upload a JPEG/PNG reference. Name it, choose view labels, and optionally add more views. Select **one** primary image.
4. Choose performance/camera guidance. An optional English custom prompt **fully replaces** presets; the composed prompt is visible before submission.
5. Review the server quote, confirm content/likeness rights, and generate a demo.
6. The separate worker really trims/transcodes the selected segment to MP3, validates it, then produces a **copy of the included fixed sample**. It does not call an AI provider or animate the uploaded image. The sample is always 10 seconds, even if your requested segment is different.
7. Play and download the labeled sample, save the project, reload the page, and revisit `/projects` or `/artists`.

The sample MP4 was created locally with FFmpeg from a plain background, text, and a synthetic tone. It contains no third-party song, likeness, or stock performance. No fake completed singing examples appear in marketing.

### Data and session behavior

- Demo files are stored outside `public`, in `.data/media`, with session ownership checked on each read. URLs are not public share links.
- SQLite WAL persists jobs, artists, sessions, a simulated credit ledger, and rate limits across web/worker restarts. Sessions use random HttpOnly, SameSite=Strict cookies; only token hashes are stored. HTTPS makes cookies Secure.
- A session is valid for 30 days. This is **not** a recoverable production user account. Clearing cookies loses access; do not put important personal content into the demonstration.
- Audio: MP3/WAV, max. 50 MB; server decodes with FFprobe. Selected provider-ready MP3: max. 15 MB and 300 seconds; FFmpeg duration tolerance accounts for codec padding.
- Images: still JPEG/PNG only, max. 30 MB, max. 4096 × 4096. Sharp decodes and validates; originals are retained. No invented provider minimum dimensions.
- Per-session storage is capped at 250 MB; active jobs at two. Writes, uploads, session creation, and submissions are rate limited. This is local-demo abuse protection, not a public-launch security claim.
- Rights consent and expected price are checked server-side. Jobs have user-scoped idempotency keys. One transaction reserves simulated credits. Completion records capture; technical failure or queued cancellation restores exactly once.
- Queued cancellation is supported. Processing jobs cannot be cancelled in v0.1. Interrupted processing fails safely after a 10-minute lease; it never starts an automatic paid retry.
- Settings can delete this session's files and records after active jobs finish. `npm run cleanup` removes expired demo sessions and orphan temporary files older than 24 hours. Schedule it externally if using the demo for longer periods. The demo does not claim production retention automation.

## Checks

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:staging
# Install a browser when needed, or use a system Chromium below.
npx playwright install chromium
npm run test:e2e
# In this cloud machine:
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
npm run format:check
```

Playwright starts the production web server and worker on port 3100 with a separate temporary SQLite/media directory, and exercises desktop and mobile viewports. It requires a current production build. Browser recordings are retained only on failure. Tests generate their own synthetic input audio/image; no paid service is involved. See `docs/VALIDATION.md` for actual results and limitations.

### Production build, locally

```sh
npm run build
node --env-file-if-exists=.env.local scripts/serve.mjs
```

This starts the Next production server plus the demo worker. Production defaults to password protection; configure the variables in [the staging guide](docs/RAILWAY_STAGING.md) first. Use only in a trusted local environment; it binds all interfaces for Railway compatibility. For loopback-only validation use `npx next start --hostname 127.0.0.1 -p 3000` and a separate worker. Processes are not retained in cloud snapshots and must be restarted.

## Private admin scaffold

`/admin` is locked by default and **always locked under `NODE_ENV=production`**. Every `/api/admin` operation is gated server-side. No real customer records or financial actions are exposed.

For local development only, configure `ADMIN_DEMO_ENABLED=true` and a strong, independently chosen `ADMIN_DEMO_ACCESS_KEY` in `.env.local`, restart the dev server, and enter it in `/admin`. Never commit or share this key. Login is rate limited and audited; the session gets a server-controlled demo admin flag. All 11 requested management sections show explicitly illustrative data or readiness information. Mutations stay disabled. Production needs verified Supabase identity, server-owned roles, MFA assurance `aal2`, tested policies, and append-only audit trails.

## Architecture and integrations

| Area                                   | v0.1 state                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| Next.js / strict TypeScript / Tailwind | Implemented; shared responsive components, server pages and focused client editors  |
| Local private uploads / FFmpeg         | Working; separate worker and validated trimmed MP3                                  |
| Jobs / credits                         | Durable local SQLite demo; reservations and restorations are atomic                 |
| Supabase PostgreSQL / auth             | Versioned migrations and interfaces; **not connected or applied**                   |
| Cloudflare R2                          | Private provider-input uploads and signed GETs; **mock-tested, not live-connected** |
| BytePlus direct OmniHuman 2.0          | Explicitly disabled adapter; full API contract remains unverified                   |
| fal.ai OmniHuman 2.0                   | Disabled optional adapter; no automatic fallback                                    |
| Stripe                                 | Disabled checkout/webhook interface; **no live payments**                           |
| Legal pages                            | Clearly labeled review placeholders; operator/support details not invented          |

See `docs/ARCHITECTURE.md`, `docs/PROVIDER_VERIFICATION.md`, and `docs/LAUNCH_CHECKLIST.md`.

## Private Railway staging

See [Railway staging configuration](docs/RAILWAY_STAGING.md) for the exact variables, password setup, volume permissions and acceptance checks. A brief privileged Docker initializer repairs the mounted volume, then permanently drops to UID/GID 1000 before the launcher validates configuration and starts Next and the demo worker. Staging requires authentication on pages, APIs and media; generation and admin access remain disabled. Railway configuration and release are manual steps, not performed by this repository change.

## BytePlus first-test preparation (still offline)

The supplied October 15, 2026 OmniHuman 2.0 document now supports a mock-tested direct protocol adapter. HMAC signing is now verified against the official BytePlus SDK with deterministic fixtures. [Private R2 input delivery](docs/R2_PRIVATE_INPUTS.md) is implemented and mock-tested. Live transport remains blocked pending billing, live input-delivery validation and output restrictions. No 1.5 schema or guessed signing algorithm is substituted. The new operator-only preflight uses an existing owned project's selected clip, validates an actual trimmed MP3 and one original artist image, and persists an immutable local review plan:

```sh
npm run byteplus:preflight -- --job <project-id> --owner <owning-session-id> --confirm-english
```

It performs **no network request or paid generation**. The current plan reports an unknown provider cost and cannot be authorized. `.env.byteplus.example` describes separate, disabled operator settings; keep the normal app in demo mode. The internal one-time authorization, spending cap, task-ID persistence, polling and MP4 validation lifecycle has fake-provider tests, but no verified live transport. `npm run byteplus:live-test` always refuses submission in this version.

See [the verification matrix and BytePlus account checklist](docs/PROVIDER_VERIFICATION.md) for the precise evidence still needed. Do not add provider credentials or enable real spending until the model-specific contract and billing rules are confirmed.
