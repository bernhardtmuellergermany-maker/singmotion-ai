## V1 scope freeze — 2 November 2026

**No new product features or tariffs before launch.** Finish and verify the existing paths only:
1. Pay-as-you-go: up to 3 customer projects, EUR 0.25 per generated second including VAT.
2. Hobby: EUR 4.99 per paid month including VAT, up to 10 projects, 30 included seconds per billing period; overage EUR 0.20 per second including VAT.
3. Existing Studio, authenticated price confirmation, one authorized job, customer-safe Output status, private MP4 delivery, shared account menu.
4. Stripe sandbox end-to-end: signed paid webhook, order/allowance reservation, duplicate/reordered events, refunds/chargebacks and uncertain provider outcomes; no live payment until completed and explicitly approved.
5. Go/no-go: one reproducible customer journey plus failure paths; tests, security/privacy/legal and operations readiness. Do not create additional infrastructure or broaden scope to solve unrelated issues.

Treat a fresh discovery as either a defect blocking this scoped journey (fix with a regression test) or a post-launch backlog item. Do not flip production payment or generation flags under this checklist.

# Before any public launch

This repository is a local v0.1 demo, not a publicly launchable paid service. No deployment, service purchase, paid render, Stripe activation or public exposure is authorized by this build.

- Verify the direct BytePlus OmniHuman 2.0 contract and usage rules; get explicit approval for a capped live test. Record results. No automatic paid fallback.
- Connect Supabase verified identity, recovery, account lifecycle and server-owned roles. Require MFA for admin. Apply migrations in an isolated database and test RLS/cross-user associations and all service functions.
- Implement and test private R2 signed access and bounded ingestion/output copying, deletion, scheduled cleanup, and saved-content retention.
- Complete atomic outbox/job/provider reconciliation, duplicate webhooks, concurrency, interruption recovery, spending caps and idempotent credit settlement under the production database.
- Validate Stripe in test mode first: signature verification over raw payloads, event deduplication, price/offer ownership, reconciliation, purchase credits, refunds and reversals. Live charges remain a separate approval.
- Review security with adversarial uploads, global storage/rate quotas, malware/decompression/resource exhaustion, session fixation, CSRF/proxy-origin configuration, signed URL handling, account deletion and logs. Anonymous session creation needs stronger public abuse controls.
- Supply real operator, support and abuse-reporting contacts. Have legal professionals review privacy, Impressum, terms, music/likeness consent, consumer payment terms and AI disclosures. Do not claim completed GDPR compliance.
- Validate accessibility with keyboard/screen reader and actual touch devices. Test large files and browser codec differences. Measure LCP ≤2.5s, INP ≤200ms, CLS ≤0.1 and Lighthouse mobile ≥90 under representative production conditions. Current functional viewport tests do not establish these metrics.
- Test Docker/Railway, persistent volumes, restart/recovery, backup/restore, TLS, secrets, retention schedules and monitored worker health before approved deployment.
