# SingMotion AI — Production Go/No-Go Report (2026-11-07)

**Decision: NO-GO for public paid customer launch. GO for protected Production preview and non-billable acceptance testing.** This report records observed system facts and separately names missing human/provider evidence. It neither certifies unperformed tasks nor changes Railway/Stripe/BytePlus release flags.

## Verified or observed now

| Area | Observation | Acceptance state |
|---|---|---|
| Domain and TLS | Railway reports verified CNAME for `www.singmotion.ai`, valid TLS certificate, target port 8080 | PASS, domain only |
| Production HTTP | 24h sample: 225 2xx, 9 3xx, 1686 4xx, **0 5xx**; unauthenticated `GET /` returned HTTP 401 | PASS private-preview behavior; **BLOCK public reachability** |
| Railway release parity | Staging and Production successfully started reviewed commit `1e302b81e2f4bc538af5bda5a29d1b21e4ba2b20` before this report. Future candidate must pass tests and deploy in both environments | PASS for previous baseline; new commit pending until verified |
| Build tests | 100 initial tests; 19 video release tests; 63 customer release tests; full Chromium mock/sandbox browser flow on prior reviewed candidate | PASS as **offline/sandbox tests only** |
| Private video storage | Staging private R2 MP4 range canary PASS; Production R2 read-only preflight PASS | PASS for limited checks; **NOT** Production customer upload/migration/restore E2E |
| Stripe live account | Connected SingMotion AI live account: `charges_enabled=true`, `payouts_enabled=true`, `details_submitted=true`, card capability active | PASS account-level readiness; **NOT** an actual settled test purchase |
| Stripe webhooks | Two enabled live webhooks for video sales/refunds/disputes and subscriptions/invoices, targeting exact `https://singmotion-ai-production.up.railway.app` routes | PASS endpoint config; **NOT** delivery/replay/refund E2E |
| Hobby live offer | The only listed active recurring live price was **€4.99/month, tax inclusive**; Price nickname/lookup key contained `STAGING`, Product metadata environment `staging` and description referred to sandbox testing | **BLOCK**: select a distinct owner-approved, production-specific product/price and reconcile entitlements before customers can pay |
| Stripe live preflight | Previously required webhook URL to be `PUBLIC_SITE_ORIGIN` even though live webhooks use Production Railway. Updated to allow ONLY the exact verified Production Railway host as alternative when public origin is `https://www.singmotion.ai` | Code/test correction; **does not** authorize billing |
| BytePlus model/input | Owner target is OmniHuman 2.0 input 5–300s, planning rate USD 0.07 per generated second, no global operator USD budgets, private validated MP4 | PASS owner target; **NOT** a vendor-issued inclusive tariff, extra output bound or 300s MP4 capacity proof |
| Public release controls | Production remains intentionally Basic-Auth protected; `productionCustomerReleaseApproved` requires independently verified release flags, CMS, owner support contact, billing and actual paid worker | **BLOCK** by design |

## Remaining hard release blockers

1. **BytePlus direct-account contract**: independently verify the exact unit of billable duration, minimum/quantum/rounding, failed/canceled charges, taxes/fees and inclusive maximum cost for customer jobs. Require an authorized real task and invoice/contract evidence; no guessing from resellers.
2. **300s media**: verify actual generated duration with potential +2s padding against the 300s model ceiling, output codec/FPS/dimensions/bitrate, concrete output host allowlist, transfer size/time and independent private R2 readback. Note a 300s input plus an unverified +2s provider extension could exceed the coded 300s output envelope; fail closed rather than claim this is safe.
3. **Customer worker**: verify separately reviewed Production private policy, idempotent submission, durable reservations, cost controls, recovery on ambiguous responses and no unauthorized retries. Target "unlimited" means no global Studio USD quota, **not** an unbounded automatic customer billing authorization.
4. **Stripe live checkout**: replace or explicitly reconcile the STAGING-labeled live Hobby product/price without changing customer entitlements unexpectedly. Verify exact event delivery, signature, original order settlement, refunds, partial refunds, disputes, subscription cancellation and production prices/tax.
5. **Private R2 Production**: independent live production migration reconciliation/restore, cross-user denial, retained source files, and download/access revoke after dispute.
6. **CMS**: actual Production migration, backup/restore, role-and-publish browser tests, reconciliation of existing public/legal pages. `CMS_SCHEMA_INIT_DISABLED` startup is **not** migration evidence.
7. **Legal and customer operations**: German Impressum, GDPR/privacy, AI/music/likeness rights, withdrawal/refunds/taxes, email deliverability, verified support contact, retention/deletion notices, abuse handling and tested budget alarms/kill switch.
8. **Public site**: only after all launch gates pass, deliberately enable public Production using the reviewed gate sequence; independently verify unauthenticated `GET /`=200 and signup/verification/owned gallery via real public domain. Protect private Studio/CMS/Admin and ensure Staging stays private.
9. **GitHub release hygiene**: Source is pinned to an ephemeral release branch; PRs #81–#85 are draft/unmerged. Review/merge the correct dependency chain, require CI, protect the release branch and update Railway source deliberately without triggering uncontrolled deployment.

## Safe final cutover sequence

**A.** Preserve latest green Staging + Production deployment IDs and volume/backups. Complete proofs 1–7 and the actual signed deployment audit; verify no pending or uncertain BytePlus tasks and no unresolved Stripe disputes.

**B.** Independently verify Stripe live Checkout for a specifically approved product/price and webhook reconciliation; verify private MP4 ownership before enabling any money flow. Validate one separately capped production provider E2E only with explicit account terms and budget approval.

**C.** Run `npm run launch:audit -- --production` and `npm run stripe:live-preflight -- --production` **on Production with real server secrets**. Record a redacted PASS report. Do not change proof flags merely to make checks green.

**D.** Apply only individually verified release switches; ensure payment and provider kill switches can immediately stop new work without deleting already-paid orders. Then remove Production Basic Auth intentionally, check `www.singmotion.ai` externally and perform monitored first-customer acceptance tests.

**E.** If errors occur, restore last-good code/flags. Never delete volume data or reissue an ambiguous BytePlus provider POST. Preserve payment records and private customer videos.

## Evidence provenance and limitations

Railway service/proxy telemetry, DNS/TLS and current deploy status were checked 2026-11-07. Stripe live account, webhooks, prices and product metadata were read through the connected **live** Stripe account without writing or initiating charges. Price/product names are operational labels, not contractual proof. No private secrets, customer identities, bank details, unpublished content, video URLs or raw provider outputs are recorded here. These observations cannot certify future compliance or production readiness after further config changes.

## Additional independent release-hardening (7 November 2026)

- Railway private-cookie mutations are now authorized only against an **explicit, canonical, trusted HTTPS** `APP_ORIGIN`/`PUBLIC_SITE_ORIGIN` (or the separate `CMS_ORIGIN` for CMS). An omitted origin no longer falls back to a request-controlled `Host`/internal proxy origin on either Staging or Production. Direct, unprotected local development is still supported. Regression tests cover both Railway environment IDs, cross-origin requests, malformed origins and CMS separation. Existing Railway service variable names include `APP_ORIGIN` and `CMS_ORIGIN` in both environments. This hardening never changes a payment/BytePlus flag.
- The exact-commit / builder-strategy promotion regression suite (`tests/release-parity.test.mjs`) is now included in the normal mandatory `npm run build` pipeline rather than relying on an optional standalone invocation. It does not assert live Railway parity on its own: inspect the actual deployment SHA and SUCCESS status of **both** Railway environments after each deployment.
- The signed-in customer release still requires provider contract, live Stripe fulfillment, production data recovery, CMS/legal approval, and a controlled public cutover. Passing these additional tests does not constitute public launch approval.

## Customer 0.9× playback metadata consistency — offline release fix

For newly fulfilled customer tempo orders, the verified private MP4 already restores the original audio packets and source timeline, but the customer asset record previously copied the *slowed* provider-input `durationSeconds`. This was inconsistent with the restored MP4 and could misreport playback length in owned customer metadata. `deliveredPaidVideoDurationSeconds` now records `tempo.originalDuration` for new restored orders, preserves the legacy no-tempo value, rejects invalid durations, and rechecks the original-to-provider ratio before registering an asset. Server-calculated Checkout pricing still uses the actual slowed provider-input duration. The code does **not** reprice, redispatch, delete, or automatically mutate any previously delivered customer order. Offline regression tests cover normal, boundary, corrupt and unchanged legacy cases. A real account-approved BytePlus request, charge and 300s output remain independently gated.
