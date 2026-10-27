# Private product rebuild — October 2026

## Working implementation

- Compact CMS-aware home, optimized fictional concert artwork and five-step responsive Studio. Existing published CMS text/images are read, never rewritten. Concept imagery is labelled and is not presented as a generated sample.
- Real uploads (MP3/WAV/audio-only AAC M4A), existing lazy-loaded waveform/playback, precise excerpt selection, image replacement, composed performance/camera prompt and editable summary.
- Owned persistent drafts after both inputs exist; earlier incomplete input remains in the existing browser draft. My Videos retains existing projects and adds resumable drafts.
- Persisted 9:16 / 16:9 choice. No undocumented provider parameter: source is validated against the saved contract, then locally fitted with padding, without stretching. Final output is validated again. Legacy plans with no format retain their original behavior.
- One generation dialog: unchecked rights consent, server cost review, then explicit submission through the existing private Super Admin API. No customer checkout is required for that operator. Existing policy, exact plan binding, EUR/USD bounds, active-task lock and duplicate prevention still apply. Repeat work requires a new review; recovery never submits a replacement.
- Technical budget/reconciliation controls remain at `/operator`, protected by Payload authentication and the existing staff allowlist. Existing Payload administration and recovery routes remain available.
- Persistent EUR 50 Berlin calendar-day reservation guard, including DST and approval across midnight. This is **additional to**, not a reset of, the existing EUR 50 cumulative guard. Historical reservations remain counted under the old guard. A fresh daily allowance beyond that cumulative limit is NOT enabled; settlement and an explicitly reviewed budget-policy change are still required.
- Separate customer-account and commerce database groundwork: salted password hashes, hashed expiring sessions and guest tokens, ownership, atomic integer-cent credit holds, idempotent capture/refund, audit and a verified-payment-adapter boundary. No artificial starting credit.

## Deliberately inactive / incomplete

`CUSTOMER_ACCOUNTS_ENABLED=false` by default. Private testing may enable it only after backup and review; this is not approval for public account launch. Accounts have no email verification, reset email, MFA, recovery or abuse-service integration yet.

Payments have **no live adapter**, active checkout or server-approved sale prices. `/checkout` explains this instead of simulating a payment. No card or Stripe activation occurs. Provider estimates/reservations are not customer sale prices.

Guest token exchange and private order-status access are implemented, but order creation, verified email delivery/reissue, guest-to-account claiming, customer paid-job dispatch and guest result delivery are not connected. Customer credits and webhook handling are tested server primitives, not an enabled business workflow. Invoice/tax/refund-provider integrations and operator credit-management UI remain outstanding.

English is the implemented UI language. A typed English/German step-label catalog provides the locale entry point; a complete translation catalog and German localization remain outstanding. The supplied desktop reference informed the responsive mobile design; no separate mobile image was available in this session.

Old operator Studio and security/recovery code are intentionally retained. Historical three-step browser specs remain in the repository; the default E2E selection now runs the replacement five-step suite plus API security. PostgreSQL-backed Payload integration/browser tests require a disposable configured PostgreSQL service and were not run in this environment.

## Storage and rollout

No existing data, task IDs, reservations or MP4s are rewritten. New SQLite tables are additive. Customer commerce is stored in `DATA_DIR/commerce.sqlite`; include it in encrypted backups and retention review. Draft selections use the existing app database, daily reservations the existing private ledger. Task 752756881 is never resubmitted by this change.

For a later, separately approved staging rollout:

1. Back up all databases/media consistently; retain the current image for rollback. Do not delete the persistent volume.
2. Keep Basic Auth, `GENERATIONS_ENABLED=false`, public payment disabling, existing CMS and private operator gates. No Railway changes were made by this task.
3. Use existing reviewed policy, private credentials and healthy recovery worker. Log into Payload as the allowlisted Super Admin, then open `/studio`. Missing budget/policy conditions link to `/operator`; they are not overridden.
4. Upload inputs, select format/prompt, open Generate, check rights, review server-calculated cost, and explicitly confirm only when authorized. This code review did not authorize or perform a paid test.
5. Resume existing projects through their existing result/recovery controls. Keep the source contract and private output-host allowlist. A horizontal export may contain padding; it is not evidence of native landscape generation.
6. Roll back application code if needed, retaining additive database tables and all financial/media data. Never reset ledgers to roll back UI.

Before public release: connect and test verified payment and email providers, complete sale-price/tax/invoice/refund policy, customer dispatch and result ownership, legal review, retention/deletion procedures, account recovery/verification, production load and PostgreSQL CMS tests, and an explicit launch/security review. This delivery is a private pilot and commerce foundation, not a customer-ready paid service.

## Verification and measurement

Offline tests include M4A validation, source MP4 normalization and tempo restoration followed by horizontal export, daily caps/DST/midnight, customer and guest isolation, expiring tokens, credit contention across two SQLite processes, verified/duplicate/conflicting payment events and disabled payments. Provider tests use mocks only.

Browser suite uses real local uploads and FFmpeg plus intercepted private generation endpoints. It checks 1440/1024/768/390/360 widths, waveform mouse/touch, back/forward, format/prompt persistence, saved drafts, unchecked rights and a single explicit intercepted submission. Axe checks the summary at all five sizes; this is not a claim of site-wide accessibility certification.

Local asset comparison: previous artwork 2,231,323 bytes; new WebP 64,564 bytes. Isolated minified/gzipped Studio bundle (esbuild, shared React/Next external): retained operator Studio 43,826/15,089 bytes; new wizard 27,194/9,927 bytes. This is not a Lighthouse or whole-application performance score. Waveform is lazy-loaded. No new runtime dependencies were added.

### Recorded local results

- Node 24.22.1: lint, typecheck and production build passed.
- 228 automated offline tests passed.
- Five production Playwright tests passed, including the nested five-viewport flow and desktop/mobile API isolation tests.
- Existing operator browser regression passed using intercepted HTTP only.
- Production staging checks passed: Basic Auth, static/media/range, CSRF, secure cookies, generation lock and recovery heartbeat.
- No BytePlus, R2 or payment service was contacted. No deployment or database reset was performed.
