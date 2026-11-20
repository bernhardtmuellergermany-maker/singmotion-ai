# Marketing campaigns, dynamic video prices & manual Credit gifts

**Status: development branch only. Not approved for deployment.**
The existing Payload CMS, credit wallet, verified Stripe Checkout and BytePlus provider gate remain the authoritative systems. Feature flags default to off in both environments.

## Rollout safety

1. Start from the isolated feature branch. Run `npm ci`, `npm run typecheck`, `npm run test:release-parity`, the full `npm test` and relevant Payload/Playwright/browser tests. Run the new targeted tests: `node --experimental-strip-types --test tests/manual-credit-gifts.test.ts tests/campaign-pricing.test.ts`.
2. Review the existing Staging deployment, separate SQLite and CMS databases and volumes. Verify backups and restore drill first. Use **Stripe TEST only** and block any paid BytePlus submission with the existing provider gates.
3. After review and migration validation, deploy **only** to Railway Staging, enable flags in Staging explicitly, and exercise the real admin workflows on an approved test account.
4. Do not deploy or enable anything in Production until a separate explicit owner approval. Back up Production data, inspect the schema migrations, and deploy with both features disabled. A later separate approval is required for `*_PRODUCTION_APPROVED`.

### Server-side feature flags

| Variable | Staging | Production |
| --- | --- | --- |
| `CMS_ENABLED` | existing CMS auth must be enabled | existing CMS auth must be enabled |
| `ADMIN_CAMPAIGNS_ENABLED` | `true` only after staging review | remains `false` |
| `ADMIN_MANUAL_CREDITS_ENABLED` | `true` only after staging review | remains `false` |
| `ADMIN_CAMPAIGNS_PRODUCTION_APPROVED` | not used | remains `false` until separate explicit approval |
| `ADMIN_MANUAL_CREDITS_PRODUCTION_APPROVED` | not used | remains `false` until separate explicit approval |
| `ADMIN_MANUAL_CREDITS_MAX_GRANT` | defaults to 5000 | separate approval required |
| `ADMIN_MANUAL_CREDITS_ACTOR_DAILY_LIMIT` | defaults to 10000 | separate approval required |
| `ADMIN_MANUAL_CREDITS_GLOBAL_DAILY_LIMIT` | defaults to 25000 | separate approval required |

Flags are also bound to the exact Railway environment IDs known to this deployment. Do **not** clone Production databases or credit ledger events into Staging, or copy staging ledger gifts back into Production.

## CMS

- **Marketing & Aktionen** is a custom protected Payload administration view at `/admin/marketing-actions`, backed by `/api/admin-campaigns`. No separate app or public write route.
- **Kunden & Credits** remains the existing `/admin/customer-insights` view. A selected account now has **Credits gutschreiben** and a separate documented **Korrektur prüfen** action. All writes are authorized server-side to Payload `super-admin` principals only.
- Customer lookup still uses the original read-only account view. Manual gift attempts must identify a unique existing customer UUID; the gift API never looks up an account by untrusted email.
- CMS text fields are plain UTF-8 text without markup. Choose only validated palette colors. Berlin time inputs are converted to UTC; ambiguous or nonexistent DST times are rejected.

## Pricing & finance invariants

- Fixed purchase value: 1 Credit = €0.01. The first preset purchases exactly 500 Credits for €5. Existing Stripe TEST/LIVE gates, tax handling, verification and idempotency are unmodified.
- The default video price is `regular-v1`: 25 Credits per **started** source audio second.
- Only an active scheduled campaign can override it. Campaign prices are 1–25 credits per started second; a published campaign cannot overlap another published campaign. Every campaign update increments an immutable version snapshot.
- `/api/credit-tariff` provides the same rate to the homepage, credits page and Studio. Studio submits the exact shown `priceVersion`. A mismatch blocks submission. The existing wallet's `reserveVideo` atomically binds the version and cost to the project ID and rejects stale campaign versions; an existing reservation and completed generation retain their original credit count.
- Campaign usage limits and global **credit** budgets are enforced inside the same Wallet transaction. They are not provider billing budgets; existing provider cost/approval gates remain independently required.
- The CMS includes two independent switches, **Rabatt-Prozent anzeigen** and **Regulären Preis durchgestrichen anzeigen**, each versioned with the campaign. Both default to visible for new and existing campaigns; disabling them never changes the campaign tariff or wallet. Legacy SQLite databases receive two additive columns with defaults `1` on first campaign access.
- The regular tariff is 25 Credits (= €0.25) per started second, confirmed by the owner. An active reduced campaign shows a green percentage computed against this regular tariff and strikes out the regular tariff. This **does not claim a historically lowest or previous charged price**. The optional evidence note remains for audit, but is not a UI calculation switch. Legal/marketing must still substantiate price-reduction claims and check applicable 30-day-lowest or historical-pricing requirements before activating public advertising.
- A gifted credit has **no Stripe session**, invoice, purchase revenue or payment. `admin_credit_gifts` stores who, when, why, customer, campaign, unique idempotency key; `credit_wallet_ledger` is still the only source of balance, with `manual-gift` as an additional immutable kind. The internal note is admin-only. Exports contain no customer emails or notes.
- The optional administrative correction inserts a second immutable negative ledger row. It blocks if available balance is insufficient because of spending or reservations. Never delete the original gift and never attempt to undo a completed BytePlus generation.
- The transaction-level `commerce_audit` row is written atomically with gifts, corrections, and campaign revisions. A secondary Payload `audit-events` entry is best-effort; investigate any secondary audit failure.

## Staging checklist

- Create, duplicate, pause, archive and schedule campaigns at safe future UTC boundaries. Verify UTC–Berlin conversion across DST. Reject overlapping published offers and stale revisions.
- Check badge/text/theme/banner at 360px, 390px, 768px and 1440px without modifying existing hero video or layout.
- Check dynamic seconds for 500 Credits: at rates 25/9/12/18, show 20/55/41/27 full seconds.
- Compare the rate, version and amount in homepage, Credits and Studio. Change or expire a tariff between Studio review and submission: reject before billable provider request. Confirm that settled reservations retain the original rate and that budgets cannot be bypassed concurrently.
- Locate test customer by exact UUID and email search; grant 100, 500 and 1000 Credits and an arbitrary integer. Verify wallet total, available/reserved, both history views, repeated network request with original idempotency key, duplicate and missing-customer rejection, negative/fractional input rejection, actor/global limits, CSRF and role denials.
- Check correction while a video hold exists; require a blocked outcome and no ledger mutation. Release the hold and confirm one documented correction.
- Test €5 Stripe TEST Checkout and signed paid webhook: exactly 500 purchased Credits, no extra top-up or double settlement. Do not enable Stripe LIVE or submit real BytePlus requests.
- Inspect accounting: manual gifts have a calculated equivalent only; never count them as payment revenue.
- Run the existing checkout, customer accounts, CMS roles, privacy/erasure, credit wallet, studio and release test suites. Record results with the staging deployment SHA before any production change.

## Known boundaries

Provider-cost statistics are shown only if verified supplier billing data exists. Credit source-of-funds attribution after different kinds of credits have been mixed and spent is not inferred. Campaign-associated purchases cannot be attributed unless a verifiable campaign reference is recorded on their original paid transaction. No bulk gifts, public voucher redemption, automatic welcome credit signup or Stripe LIVE activation are introduced here.
