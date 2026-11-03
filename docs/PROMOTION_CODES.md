# Promotional codes — private Super Admin preview

## Implemented

The new `/promo-admin` page is restricted to authenticated Payload staff with role `super-admin`.
The management API `/api/promo-admin` requires the existing Railway Basic Auth (where configured),
CMS staff session, the exact configured origin for changes, and server-side rate limiting.

Supported offers:
- Percent discount: 1% to 100%, including e.g. `TENOFF` (10%) and `TWENTYOFF` (20%).
- Free-video bundle: **three separate video redemptions per customer**, each video at most 10 seconds.
  A 10.001-second video does not qualify. The system intentionally does not grant provider access.

Administrators choose a code or generate a random one, start and end (UTC instants, shown in
the local browser timezone), maximum total redemption count and per-customer limit. They can
disable or re-enable codes. Code values are normalized to uppercase.

The dashboard shows:
- `reserved` — capacity allocated to an order awaiting settlement;
- `redeemed` — only orders already recorded as paid by the trusted checkout system;
- `released` — reversed or cancelled orders, retained in audit history.

Each reservation belongs to one persistent order ID and one authenticated customer account.
A single order retry cannot spend an allowance twice. Customer/global counts include
reservations, preventing parallel overspending. The ledger and the commerce order database
share one SQLite file, and nested transactions use savepoints. A reviewed original price and
duration are required. Discounts use integer cents (round down the discount), not
client-provided totals.

## Customer order integration (implemented in private staging branch)

The Studio Generate confirmation now has a promotion code input and an explicit
"Apply code" action. The exact selected duration, verified account, existing
included Hobby seconds and VAT-inclusive excess amount are read on the server.
`GET /api/customer-quote?seconds=...&promo=...` is a throttled,
authenticated **estimate**, not a billable quote; it never consumes a code.

The authenticated `POST /api/customer-orders` accepts optional `promoCode`
but never accepts an arbitrary customer price or media owner. After private
media preparation, `prepareCustomerStudioOrder` binds the normalized code,
original excess price and resulting discounted amount into the reviewed quote.
`CommerceStore.preparedVideoOrder` rechecks eligibility and discounts while
holding the same SQLite transaction as the customer order, plan split and
voucher reservation. A retry must match the original code and exact media,
quote and price.

For a nonzero discounted order, only the existing signed sandbox Stripe
payment event can mark the order paid. The same transaction then settles
the voucher exactly once. Verified full refund or safe unstarted-order cancellation
releases capacity; ambiguous payment/provider outcomes remain reserved for
manual reconciliation. The private order page displays the voucher discount
and reservation status only to the authorized owner.

For a **100%-off or three-free-video** promotion, order and coupon reservation
may exist with zero sale price, but the order deliberately stays
`awaiting_payment`, creates **no fulfillment queue entry**, triggers **no
Stripe Checkout** and sends **no BytePlus job**. A separate customer
authorization + budget-controlled zero-price fulfillment workflow is still
required before these offers can actually produce videos.

## Remaining production release gates

- Customer Launch Readiness is still hard-disabled; no public paid checkout
  or live Stripe connection has been activated.
- The only linked Stripe account is sandbox/test mode. Real live payments,
  payout status, taxes/invoices and customer email/recovery require a
  verified production integration and operational review.
- Review final provider price ceilings, consumption budgets, zero-price
  entitlement dispatch, retry/reconciliation and abuse protections.
- Clear existing unrelated repository-wide lint failures; pass all
  unit, TypeScript, security, build, browser, staging and payment tests.
- Verify actual CMS super-admin usage and customer checkout in Railway staging
  with no real provider submissions; back up the persistent volume before
  applying changes to production.
- Do not publish a public checkout or enable a paid provider solely because
  coupon tests pass.

## Test and rollout

`node --experimental-strip-types --test tests/promotions.test.ts` checks validation,
percent rounding, limits, expiry, ownership, repeat requests, three free-video redemptions
and release guards, plus a prepared customer order, signed webhook idempotency,
full-refund release and fail-closed free-video behavior. `npm run typecheck`
also covers the server and UI.

Do not alter existing production data or staff roles. The promotion schema is additive
and created in the existing `commerce.sqlite` after a backup. Keep the current
persistent Railway volume. Codes created in one environment do not appear in another
environment's separate database. The display is a usage counter, not a financial
reconciliation report.
