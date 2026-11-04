# SingMotion AI — Production release and rollback runbook
**Status: NOT APPROVED FOR CUSTOMERS.** This is an operator procedure, not proof of a completed step.

## Current baselines
- Railway project: `96ab3402-f974-4cdf-b9a3-408443b17025`.
- Production environment: `36adc41d-7e54-4396-ad1a-fd432ba0441d`; service `2c6bca77-61e6-4ab5-9447-fa23767622aa`; currently deployed from `main`.
- Private Staging: `dfaeabed-03df-43ed-aa71-50f343a75041`; 36/36 registered test media, 71,952,319 bytes were verified in R2. This does NOT prove Production migrated.
- Production app volume currently 500 MB. Do not promise 2 GiB uploads to paying customers until private Production R2 is connected and verified.

## Phase A — external prerequisites, no payment/provider charges
1. Create a **dedicated private Cloudflare R2 Production bucket** with no anonymous access, in the operator's own Cloudflare account.
2. Create separate least-privileged bucket-scoped R2 API token for object GET/PUT/HEAD/DELETE. Store `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` as private Production Railway variables. Do NOT paste values in GitHub, chat or logs, and do not reuse Staging credentials.
3. Confirm the BytePlus OmniHuman 2.0 account contract: USD duration/rounding, applicable taxes, paid/failed task charging, approved output hosts, private R2 presigned input validity and support escalation. Record actual evidence. Without it, retain every paid provider kill switch.
4. Complete Stripe live business onboarding and verify invoice/VAT, refund/dispute and consumer support obligations. The **current single-video webhook and Checkout adapter are sandbox-only** and MUST NOT be used with live Stripe keys. Do not switch `sk_test_` to `sk_live_` and assume it works.
5. Have qualified legal review of Impressum, privacy, AI/musical rights, pricing/withdrawal terms, retention and customer-support/contact points; demonstrate actual email deliverability.

## Phase B — private R2 production audit and migration (operator only)
1. Keep `PUBLIC_CUSTOMER_LAUNCH_APPROVED=false` and all paid/provider flags off.
2. Take and test an encrypted, operator-controlled backup of all existing Production SQLite databases and the mounted volume; verify restoration separately. Preserve existing volumes and audit logs.
3. Deploy the reviewed code to Production only after CI and a rollback review. Do not expose it to customers.
4. For an explicit, separately approved private Production R2 canary, set `CUSTOMER_R2_STORAGE_ENABLED=true`, `CUSTOMER_R2_PRODUCTION_RELEASE_APPROVED=true` and run:
   `node --experimental-strip-types scripts/r2-storage-canary.ts --confirm-production-private-r2-canary`
   Verify the `R2_PRIVATE_MP4_CANARY_VERIFIED` message and cleanup results. Restore safety flags if verification fails.
5. After verifying database backups and R2 canary, separately set `PRODUCTION_R2_MIGRATION_APPROVED=true` and `R2_MIGRATE_TEST_DATA=true`, then on the **running Production volume** invoke `npm run r2:migrate`. The job aborts at any missing, unsafe, changed, unowned or mismatched file. Require `R2_MIGRATION_VERIFIED` with exact counts and bytes; reconcile each owner, manifest and byte-for-byte SHA-256.
6. Set `R2_MIGRATE_TEST_DATA=false` and `PRODUCTION_R2_MIGRATION_APPROVED=false` immediately after a fully verified run. Do not delete legacy local files until independently tested full R2 recovery, missing-file regeneration, and restored databases prove safe.
7. Use `npm run launch:audit -- --production`. A BLOCK is a hard release blocker, not a recommendation to turn a flag on without evidence.

## Phase B2 — modern Payload CMS production gate (no implicit release)

Private Staging runs the modern Payload CMS, while current Production `main`
still contains the old disabled demo admin. These are **different applications**;
a cosmetic sidebar change or successful Staging CI does not migrate Production.

1. Export the **actual** current Production Postgres CMS schema/data and volume
   to an encrypted operator-controlled backup. Rehearse a restore separately.
   Record the restored schema/version checksum and a rollback command.
2. Run `npm run cms:prune-drafts -- --dry-run` **only** on private Staging
   after the explicit operator switch; inspect which CMS pages were ever
   published, and retain all historically published/legal content.
   Do not delete a CMS page based only on whether a separate React route exists.
3. Diff Production `main` against reviewed Staging release. Identify all
   customer/worker/payment/BytePlus flags; never merge unfinished public
   generation or billing into Production merely to install the CMS.
4. Provision secure and isolated Production Payload DB config, `PAYLOAD_SECRET`,
   admin identity/MFA, trusted origin, cookies, editor/support/super-admin
   role checks, migration plan, legal-content review and an isolated browser
   E2E using the **Production candidate**.
5. Rehearse login, draft preview, publish/rollback, assets, cross-role denial,
   backup recovery and live homepage compatibility without exposing unfinished
   payments. Record independent operator evidence before setting
   `PRODUCTION_CMS_MIGRATION_VERIFIED`,
   `PRODUCTION_CMS_BACKUP_RESTORE_VERIFIED`,
   `PRODUCTION_CMS_RBAC_AND_PUBLISH_E2E_VERIFIED`, and
   `CMS_PUBLISHED_CONTENT_RECONCILED`.
6. The production launch audit now blocks when the CMS or any of those human
   proof markers is missing. Do **not** set these variables to bypass a BLOCK.

## Phase C — customer journey and no-go checks
- Two distinct real test logins, private upload and quota enforcement (250 MiB Free, 2 GiB Hobby), Studio snapshot review, eviction/recovery, cross-account denial, zero-storage overquota and re-login.
- Signed Stripe **sandbox** checkout plus refunds/chargebacks, real private MP4 delivery, range downloads and canceled subscriptions. Never confuse a sandbox receipt with live payment evidence.
- Verify **one** explicitly cost-capped provider test on the approved model only after the contract and spending limit are independently confirmed; no automatic provider submission retries.
- Zero-EUR three-video promotion requires distinct verified free fulfillment; a reserved voucher must never invent a Stripe-paid event.
- Confirm backups and restore, email/retention notices, customer deletion semantics, monitoring/kill switches, human legal approval and full CI.

## Rollback and incident response
- **Before** changing Production source or R2 flags, preserve exact current deployment ID and mounted volume snapshot/backup. Never wipe/recreate an existing volume to roll back code.
- A failed migration does **not** authorize deleting originals or manually forging R2 manifest records. Roll back the code to the previous known-good deployment and keep both cloud and local copies for reconciliation.
- If paid-provider/Stripe state is ambiguous, disable new submission and checkout without altering existing paid order history. Read-only recovery and operator reconciliation only; never retry a billable provider POST.
- If cloud readback, SHA-256, owner authorization or egress metrics fail, stop new uploads, preserve all assets, investigate privately and notify affected users if legally required.
- Do not mark public launch complete before every required audit has PASS and the operator signs off.

See GitHub issues #6 (zero-EUR/provider/payment) and #8 (R2/retention), `docs/LAUNCH_CHECKLIST.md` and `docs/PROVIDER_VERIFICATION.md`.
