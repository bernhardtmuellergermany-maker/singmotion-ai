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

## Production is still a separate, blocked environment

Railway Production app: `singmotion-ai-production.up.railway.app` —
environment `36adc41d-7e54-4396-ad1a-fd432ba0441d`.
As checked 5 November 2026 it runs historical `main`; **no** Stripe live
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, BytePlus or R2 access credential
names are configured in the application service. The Stripe ChatGPT account
connection does not export credentials into Railway or create any webhook.

Do not copy Staging's database, Basic Auth/password, keys, ledger or live
customer data. Do not start charging clients before new provider fulfillment,
private delivery, migration and backups succeed in Production.

### Production-only server secrets (set directly in Railway's sealed secrets)

- `STRIPE_SECRET_KEY`: actual `sk_live_...` for the connected account
- `STRIPE_WEBHOOK_SECRET`: the `whsec_...` for the production single-video
  endpoint `https://singmotion-ai-production.up.railway.app/api/stripe-webhook`
- `STRIPE_HOBBY_WEBHOOK_SECRET`: a separately signed `whsec_...` for
  `https://singmotion-ai-production.up.railway.app/api/hobby-webhook`
- `STRIPE_HOBBY_PRICE_ID=price_1UYKjSBAVolbZIfAeeyiF1lx`
- Production-only BytePlus AK/SK and Cloudflare R2 account/bucket/key/secret
  from the owner, scoped to the production private assets; never expose these
  in browser code or logs.

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
