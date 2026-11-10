# P0 release audit — 2026-11-10 (read-only observations)

**Decision: NO-GO public paid launch.** Verified through connected Railway and Stripe accounts on 2026-11-10. This file is an evidence snapshot and should be updated after each actual remediation. Never substitute an owner's statement for a runtime PASS. The owner has explicitly confirmed the BytePlus contract, limits and production test run previously; do not re-request that sign-off.

## 1. BytePlus / paid customer dispatch

- Production Railway service `singmotion-ai` is online, deployed from `fix/customer-tempo-delivery-duration-20261107`, SHA `a5834336df433530054303ffce7ab332edbf3db2` (deployment `b5b6993a-861b-4b03-b7dd-ff666a725558`).
- Production Railway variable **names** exist for `BYTEPLUS_ACCESS_KEY_ID`, `BYTEPLUS_SECRET_ACCESS_KEY`, `CUSTOMER_BYTEPLUS_OWNER_CONFIRMED_PRICING`, `CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED`, `CUSTOMER_PAID_WORKER_ENABLED`. This OAuth connection only shows names: **do not infer values/true status.**
- Live runtime log reports `PRIVATE_STUDIO_CHECK studio-policy BOOTSTRAP_READY` and explicitly states paid customer dispatch requires independent reviewed policy. No latest production customer provider success or actual 300s private MP4 was established by this audit.
- PR #97 implements controlled, server-only Railway JSON policy delivery if the authoritative policy file is absent. Before integration, review its precedence, bounds, provenance and regression coverage against current deployed SHA. The variable is *not* currently listed in production.
- **Next executable check:** correlate owner's existing approved vendor evidence and task receipt with exact runtime policy; verify approved host allowlist, maximum inclusive billed seconds, charge/refund handling and private video delivery; run offline release tests and production audit **before** enabling dispatch.

## 2. Stripe live billing

- Read-only connected **live** Stripe account `SingMotion AI` (`acct_1UVzYSBAVolbZIfA`) returned exactly one active Price: `price_1UYKjSBAVolbZIfAeeyiF1lx`, EUR 4.99/month, tax inclusive, nickname `Hobby 4.99 EUR/month STAGING`, lookup `singmotion_hobby_monthly_staging`.
- The Price refers to `prod_VXzqC4UQjKUG3q`, active live Product with `metadata.environment=staging`, sandbox testing description and missing tax code. **This is not a production-approved Hobby offer.**
- Use an independently approved production-specific product/tax classification and price; do **not** simply relabel the staging/sandbox Product, as existing test/reconciliation state and entitlements may depend on it.
- Integration candidates: PR #92/#93 enforce production-only Hobby Product validation; #95 ensures valid refund/dispute reconciliation while checkout is paused; #96 preserves subscription cancellation/revocation while paused. Review/test/merge the relevant chain with full green CI and verified Stripe metadata.
- **Next executable check:** review approved pricing, tax/legal configuration and distinct production product; run mode-matched read-only `stripe:live-preflight`; then controlled signed webhook and refund/revocation E2E before any public paid acceptance.

## 3. Production private R2

- Railway production variable names include `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `PRODUCTION_R2_READONLY_PREFLIGHT_ENABLED`, `PRODUCTION_R2_WRITE_PREFLIGHT_ENABLED`. Values are redacted by OAuth; existence is not proof of correct scoped credentials.
- Latest production deployment on 2026-11-10 03:52 UTC is SUCCESS; startup emitted `PRODUCTION_R2_READONLY_PREFLIGHT verified` at 03:53 UTC. No explicit write/read/delete canary PASS was found in that deployment's logs. Railway environment currently has a mounted application volume (500 MB) and separate Postgres volume. Railway's own bucket inventory is empty; **Cloudflare R2 is external** so this does not establish absence of R2.
- **Next executable check:** record a separately authorized private production R2 canary's exact-key write/read/hash/delete result, confirm object ownership, cross-customer denial, range-download and revocation. Then snapshot and independently restore the active production volume/database, reconcile R2 migration manifests, and preserve originals until checks pass. Never delete/migrate user files as part of a speculative audit.

## 4. Source parity / release gate

- Production and Staging use the same branch `fix/customer-tempo-delivery-duration-20261107`; production successful deployment SHA `a5834336df433530054303ffce7ab332edbf3db2`. Staging current deployed SHA must be independently recorded for an exact parity check.
- Main is still a different older commit; the newest green GitHub Actions customer-launch verification `42620202464` on 2026-11-09 ran at SHA `46d6b3ffe6fe3a44743ef0ade7997c37c3bcd993`. Green CI on that branch **does not validate the currently deployed production SHA or unmerged PRs.**
- Prepare one reviewed integration branch, run complete offline/customer/Chromium release tests and staged acceptance, promote identical reviewed SHA to Production, run actual production audits, then require explicit Go/No-Go human approval.
- Current production service health: online, no recent service failures reported. This is operational health only, not a launch authorization.

## Non-actions / safety

No Stripe resources were created or changed. No purchases, refunds, provider jobs, R2 writes/deletes/migrations, Railway variable changes, launch flags or public exposure were triggered by this audit.
