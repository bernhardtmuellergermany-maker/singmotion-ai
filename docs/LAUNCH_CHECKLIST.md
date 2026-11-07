# SingMotion AI — customer launch release gates (updated 4 November 2026)

## Verified release snapshot (4 November 2026)

- Protected Staging commit `71fcd1a0d2300cbb7fca1ad47ee77212ef6f7594` is deployed SUCCESS. All current staging CI workflows have passed; the modern Payload CMS and private page-publishing inventory exist there.
- Production still runs old `main` commit `d17419d79a01629302eb5d353d8c13a77f45540b`, with the old disabled demo admin; **not** the new CMS.
- The connected Stripe account is **SingMotion AI Sandbox, test mode only**. A live account and verified live customer checkout are missing.
- Production has no R2 bucket/credential variable names configured; do not copy private Staging R2 keys, and do not advertise the 2 GiB customer allowance in live Production until its dedicated R2 has been verified.
- Real BytePlus provider billing/taxes, end-to-end production delivery, restore exercise, published CMS-content reconciliation and qualified legal review remain unverified.
- The standalone offline-synthetic free-MP4 flow and its zero-EUR redemption/owner-bound download are implemented under disabled Staging-only controls. They **do not** authorize real provider submissions, customer billing or Production launch.
- Current tracking issues: #6 for payment/free video, #8 for storage/retention/recovery, and #27 for CMS Production cutover.
- **Release decision: NO-GO.** No public paid checkout or real-provider spending until every `launch:audit -- --production` gate passes with independently verified evidence.



## What is verified vs. still blocked
- Protected Railway **Staging** runs Next.js and worker; the latest verified commit `fb8823074f656b6fe235980a03b7d699c182e59f` deployed successfully.
- **36 of 36 registered Staging test assets, 71,952,319 bytes** were privately migrated and SHA-256 verified in Cloudflare R2. A real private MP4 readback and two Range GETs passed.
- Free and Hobby support **unlimited projects** and per-account uploaded-source quota of **250 MiB Free / 2 GiB Hobby**. Hobby: EUR 4.99 per paid month, 30 included seconds per verified period; Free extra seconds EUR 0.25 and Hobby overage EUR 0.20 per second in the current planned pricing rules.
- The latest changes to guest/demo worker hydration and production launch checks must independently pass CI and Staging deployment before being called verified. Do not confuse test code with live readiness.
- Railway **Production** is still on `main`, with a 500 MB app volume and **no configured R2 credential variable names** at last audit. The Staging PR #5 is a **draft**. No production rollout has been authorized.
- Real paid BytePlus video generation, Stripe live payments and zero-EUR promo fulfillment are not activated. The shipped worker explicitly does **not** submit paid tasks.

## Mandatory ordered go/no-go

1. **Cloud infrastructure:** configure a separate private Cloudflare R2 production bucket and isolated secrets directly in Railway Production. Run real PUT/HEAD/GET/hash/range/DELETE canary; migrate and verify every existing production test asset without deleting original copies. Require explicit R2 production release approval; do not copy Staging keys.
2. **Authoritative video processing:** run a real authenticated customer flow on Staging: account → upload image/song → evict local originals → hydrate for Studio → review immutable snapshots → verified video artifact → customer-only streamed/downloadable MP4. Verify invalid/missing cloud originals, cross-user access denial, replay and stale order handling.
3. **Provider contract and spending:** obtain verified account-specific BytePlus OmniHuman 2.0 billing inclusive of applicable taxes, approved output hosts, capped live-test budget, one-shot signed submission, task-ID recovery, timely download, and confirmed failure-cost rules. No guessing, retries or fallback to another paid provider.
4. **Stripe live:** verify the actual Stripe live account, prices and VAT/invoicing, customer communications, support contacts, 3-D Secure/SCA as applicable, signing secrets, webhook event ownership, refunds and disputes. Live-mode checkout/webhook integration needs a separately reviewed implementation; the existing adapter is sandbox-only.
5. **Zero-EUR vouchers:** finish the audited, budget-capped, idempotent three-video customer fulfillment flow. Reservation of a voucher alone **must never** turn an unpaid order into a fictitious Stripe-paid order or launch a billed AI task.
6. **Operations and legal:** actual human-reviewed Impressum/privacy/terms/rights consents, anti-abuse controls, customer email deliverability, retention notices and recovery, secure account deletion, backup/restore rehearsal, metrics, spending alerts and tested stop switch.
7. **Explicit production decision:** finish and document all acceptance results, run `node --experimental-strip-types scripts/launch-audit.ts --production` in the target environment, investigate every BLOCK, and require explicit operator release approval. This CLI is a non-mutating checklist, not a release switch.

For live gates see GitHub issues #6 and #8. Avoid silent deletion of customer content and never activate live payments or provider spending to make a readiness report green.

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
