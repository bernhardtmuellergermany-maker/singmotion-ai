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
