# Implementation and production boundary

## Local demo

Browser → Next route handler → private filesystem + SQLite WAL.
A separate Node 24 worker claims queued jobs transactionally, runs bounded FFmpeg processes, validates the trimmed MP3, copies a fixed sample, validates its video dimensions, and settles the demo reservation. SQLite survives browser and server restarts. The worker's 10-minute processing lease exceeds FFmpeg's 120-second timeout. Failed interrupted jobs restore credits once; they are not rerendered automatically.

Uploaded original audio/images are never placed in `public`. Asset lookup uses both ID and session owner; API output excludes filesystem paths. Each mutation checks exact same origin, authentication, and rate limits. User data does not control filesystem paths or shell commands. FFmpeg uses argument arrays and bounded execution. Image metadata, dimensions, file size, still-image format, and decoding are checked.

The default local credit balance is simulated. Price comes from `lib/domain.ts` on the server. `CUSTOMER_CENTS_PER_TEN_SECONDS` defaults to 299; cents round upward once after duration multiplication. No provider minimum is assumed. A custom prompt replaces preset guidance, making the exact submitted direction unambiguous. Live provider cost is neither charged nor displayed as the customer price.

The browser persists the studio draft locally to make back/forward steps and reloads convenient. Preferences are browser-local; the guidance preference is explicitly marked for future personalization. Anonymous identity is not production authentication.

## Planned production architecture

One Next application + a durable worker. Supabase verifies identities and owns PostgreSQL; private Cloudflare R2 stores binaries. A single provider interface maps verified schemas. Stripe event processing is independent and idempotent. No Kubernetes, GPU hosting, or model training.

### Supabase

`migrations/001_production_foundation.sql` creates profiles, server-owned roles, artists, reference images, asset metadata, projects, generation jobs, provider requests/costs, versioned prices, ledger, purchases, webhook event deduplication, and admin audit records.

- All tables enable RLS. Browser writes are denied in this initial foundation.
- User-readable records have `auth.uid()` ownership policies. Raw object keys, roles, provider costs and audit records are service-only.
- Composite foreign keys prevent cross-user artist/assets/project/job associations.
- Ledger, payment events, and admin audit records reject updates/deletes.
- `002_atomic_credit_contract.sql` provides a service-only reservation function with customer row locking, job-price validation, idempotency conflict checks, and insufficient-balance rejection.
- These migrations are **not applied or tested against PostgreSQL here**. The local SQLite tests do not validate Supabase RLS. All remaining financial settlement, verified webhook, administration and account-deletion workflows require tested service functions before activation.

### Authentication and administration

Replace demo identity with a verified Supabase session on every request. Never trust roles from local storage, request payloads, or editable user metadata. Verify suspension and server-owned role. Production administration requires MFA assurance `aal2`; fail closed if unavailable. Privileged changes must atomically write a reasoned audit event. Account deletion must reconcile legal financial retention and anonymization without deleting append-only ledgers. Do not reuse local demo deletion as the production policy.

### R2

Implement `PrivateObjectStore` behind server authorization. Use opaque keys scoped to user and asset IDs, private buckets, narrowly scoped upload MIME/size policies, short-lived signed downloads (proposed five minutes), and no public object URLs. Revalidate completed uploads server-side before marking them usable. Never send original private media to arbitrary URLs. Signed provider inputs must last through verified provider fetch windows; redact tokens from logs. Provider outputs require HTTPS allowlisted hosts, redirect validation, bounded streaming, FFprobe validation and copy into R2 before a job becomes completed. Future support access must be reasoned, authorized, time-limited and audited.

### Production financial flow

Verified payment webhook → deduplicated purchase ledger event. Submission → atomic balance reservation + job creation/outbox. Worker → persist request key → submit once → persist provider ID. Completion → private output validation → zero-delta capture. Technical failure → one restoration. Subjectively disappointing completed AI output does not trigger automatic refunds. Admin adjustment requires MFA, reason and audit. Refunds/reversals are new ledger entries, never edits. All balance-changing functions must use the same customer row lock; the included reservation RPC alone is not a complete financial backend.

### Retention

Proposed: temporary selected audio ~24 hours after terminal processing, generated videos 30 days unless an explicit saved-content policy is accepted, artist originals until deletion. A future scheduled cleanup worker should mark expiration, block new reads, delete R2 objects idempotently, record audit metadata, handle retries, and respect active jobs/legal holds. The local cleanup command expires whole anonymous sessions after 30 days and old orphan files; selected trimmed audio is removed immediately after demo processing. Production scheduling and the saved-content policy are outstanding.

### Deployment

Dockerfile and `scripts/serve.mjs` prepare a Railway-compatible single demo instance. Web and worker share a persistent data directory. Production cannot depend on the lifecycle of a request for processing. Move to PostgreSQL claims/leases and R2 before multiple instances; add worker health metrics, logs without secret/media contents, backpressure, globally enforced spending limits, and operational recovery tests.
