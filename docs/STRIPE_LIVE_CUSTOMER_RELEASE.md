# Stripe Live → SingMotion customer video release (5 November 2026)

## Independently checked LIVE account (no secrets stored in Git)

Stripe-connected account: `SingMotion AI` — `acct_1UVzYSBAVolbZIfA`, `livemode=true`.
On 5 November 2026 the Stripe Account API returned `charges_enabled=true`,
`payouts_enabled=true`, `details_submitted=true`, active card payments and
`requirements.currently_due=[]`. `company.vat_id` is listed under
`eventually_due`; confirm account tax and legal details before public launch.

**Existing LIVE Hobby price:** `price_1UYKjSBAVolbZIfAeeyiF1lx`,
EUR 4.99 (499 cents) monthly, `tax_behavior=inclusive`, active.
This price is already in Stripe Live; do not create a duplicate price just
because its historical lookup key ends with `staging`. Set its ID as
`STRIPE_HOBBY_PRICE_ID` in Railway Production when the production code is
actually deployed. The Free/Hobby per-video pricing remains in
`lib/commerce/plans.ts`; Stripe Checkout video line-item totals come only
from immutable, server-reviewed customer orders.

## Verified Production status — 5 November 2026, 11:20 CET

Railway Production app: `singmotion-ai-production.up.railway.app`,
environment `36adc41d-7e54-4396-ad1a-fd432ba0441d`.
The current running protected service is Git commit
`9928dcb657c0874856038c33db2551326adca9e6` on
`feat/production-r2-readonly-preflight-20261105`; app and Postgres are online.

Stripe Live has **two active account webhook endpoints** with the five exactly
required events for each route, and Railway Production contains both distinct
webhook-signing-secret variable names. The existing EUR 4.99 tax-inclusive
monthly Hobby Price remains `price_1UYKjSBAVolbZIfAeeyiF1lx`.
The owner installed a restricted `rk_live_` API key; the application accepts
either restricted `rk_live_` or `sk_live_` keys only under its separate Live
release requirements. The connected Railway integration reveals variable names,
not secret values, so it cannot by itself attest valid secrets or signatures.

Railway Production now contains all six **BytePlus + Cloudflare R2** required
credential variable names. The current Production service printed
`PRODUCTION_R2_READONLY_PREFLIGHT verified` at startup: a private R2
`HeadBucket` succeeded **without writing objects**. This is positive
connectivity evidence, **not** proof of customer input upload, output retrieval,
retention, signed downloads or the first paid BytePlus task. The BytePlus
credentials were not validated by an actual provider task or billing record.

**Customer checkout, public access, Hobby subscription sales, paid worker and
BytePlus dispatch remain disabled.** Two unauthenticated synthetic webhook POST
checks returned HTTP 503 while launch gates were closed; they were NOT positive
Stripe-signature verifications. Do not claim paid delivery end-to-end.

Do not copy Staging database, demo accounts, provider budgets or customer data
into Production. The operator expressly chose a previous code deployment without
a volume backup; this does **not** satisfy the separate
`BACKUP_RESTORE_EXERCISE_VERIFIED` launch proof, which must remain false until
genuinely demonstrated. Confirm real production backup/restore, legal/tax,
bounded BytePlus billing, output hosts, zero-EUR Free/Hobby fulfillment and
the signed live payment/refund/dispute flows before any public launch.

### Production-only server secrets (set directly in Railway's sealed secrets)

- `STRIPE_SECRET_KEY`: actual `rk_live_...` (restricted) or `sk_live_...` for the connected account
- `STRIPE_WEBHOOK_SECRET`: the `whsec_...` for the production single-video
  endpoint `https://singmotion-ai-production.up.railway.app/api/stripe-webhook`
- `STRIPE_HOBBY_WEBHOOK_SECRET`: a separately signed `whsec_...` for
  `https://singmotion-ai-production.up.railway.app/api/hobby-webhook`
- `STRIPE_HOBBY_PRICE_ID=price_1UYKjSBAVolbZIfAeeyiF1lx`
- Production-only BytePlus AK/SK and Cloudflare R2 account/bucket/key/secret
  from the owner, scoped to production private assets. Their variable names are
  installed; never expose the values in browser code or logs.

Single-video endpoint events: `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `refund.created`,
`refund.updated`, `charge.dispute.created`.
Hobby endpoint events: `customer.subscription.created`,
`customer.subscription.updated`, `customer.subscription.deleted`,
`invoice.paid`, `invoice.payment_failed`.

Configure endpoints only when the matching production route is deployed and
able to accept signed events. A failed webhook event must be reconciled before
money is accepted; do not rely on browser redirects as payment proof.

### Actual customer video operational controls

Install `DATA_DIR/customer-byteplus-policy.json` on the **persistent private
production volume**, containing the reviewed model/host/format/duration/billing
contract and explicit daily and lifetime spending ceilings. No staging fallback
or arbitrary default production budget is permitted. The owner-confirmed
0.07 USD/generated second and previous private MP4 evidence can be used as the
basis of this reviewed policy. An unverified or changed provider output host
must be reviewed for exact HTTPS origin before private download.

Required approval/rollback controls include `CUSTOMER_PRODUCTION_PROVIDER_BUDGET_APPROVED`,
`CUSTOMER_PAID_PROVIDER_E2E_VERIFIED`, `CUSTOMER_CLOUD_E2E_VERIFIED`,
`STRIPE_REFUND_DISPUTE_E2E_VERIFIED`, `PRODUCTION_MEDIA_MIGRATION_VERIFIED`,
`BACKUP_RESTORE_EXERCISE_VERIFIED`, `COST_ALERTS_AND_KILL_SWITCH_VERIFIED`,
`LEGAL_REVIEW_APPROVED`, `PUBLIC_CUSTOMER_LAUNCH_APPROVED` and the other
specific approvals in `lib/commerce/customer-live-config.ts`.

For public launch also set `PRODUCTION_PUBLIC_ACCESS_ENABLED=true` only after
all checks and separate Production approval. Until then Railway Production stays
Basic Auth protected. `DEMO_MODE=false` prohibits demo sample jobs while
enabling the separate approved paid worker; `GENERATIONS_ENABLED=false` keeps
the old demo worker inactive. Do not flip the two switches to bypass validation.

Set the `CUSTOMER_PAID_WORKER_ACTIVATED_AT` millisecond Unix timestamp
**at activation**, not at build time. The worker automatically dispatches only
paid orders queued after that cutoff; earlier sandbox/historical orders require
manual review and can never be retroactively charged to BytePlus.

Run `npm run launch-audit` in Production and retain the JSON report before
opening the public website. Each gate must reflect actual independently verified
work: a `true` flag is not itself proof. Test one full account-owned video
with real signed Stripe Live payment and customer-approved provider cost,
including verified refund and dispute behavior, prior to mass onboarding.
No real Stripe charge or new BytePlus paid task was performed while preparing
this code. Stripe is connected but **public Live launch remains disabled**.


## Customer Studio public-mode regression checks

Public Production must not mint a guest/demo media session, add demo credits,
or claim a demo MP4 is generated output. Without login, POST /api/session must
return 401; with an authenticated account, it returns an account-owned media
workspace and `demo=false`. Confirm upload→checked audio duration→prepared
immutable owner-bound order and signed Stripe webhook→single BytePlus task→
private validated MP4. Deny cross-customer access, refund/dispute download and
anonymous demo jobs. Protected Staging retains its own separate demo flows.

The read-only preflight uses the same `STRIPE_HOBBY_PRICE_ID` variable as Hobby
Checkout; **do not use** the former `STRIPE_HOBBY_LIVE_PRICE_ID` mismatch.
Both of these webhook routes and signed secrets must be verified:
`/api/stripe-webhook` and `/api/hobby-webhook`. The preflight does not create
products, customers, charges or webhooks.

Public access additionally requires true CMS migrate/backup/RBAC/publish
proofs, verified free-promotion end-to-end fulfillment, and a real email
address in `SUPPORT_CONTACT_VERIFIED`. These are necessary because simply
connecting Stripe Live does not prove real product delivery.
