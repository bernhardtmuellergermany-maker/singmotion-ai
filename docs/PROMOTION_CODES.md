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

## Important remaining release gate

The *public* customer Checkout is currently deliberately disabled in
`lib/commerce/readiness.ts`. The code-entry field on `/checkout` therefore
remains disabled. Management is available in the preview, but **voucher redemption is not
connected to the live order/payment dispatcher**. No voucher may activate real BytePlus
generation, Stripe charges, or bypass verified customer ownership and rights checks.

Before enabling public redemption, the checkout owner must integrate the following in the
same existing `CommerceStore.preparedVideoOrder` transaction:

1. Authenticate customer and validate owned input media/rights.
2. Obtain the immutable server-side full price and duration; preview the promotion.
3. Persist an exact discounted quote and order, and atomically reserve the promo for that order.
4. For payment > 0, bind the Stripe Checkout session and settle the promo only after the
   correctly signed, idempotent payment webhook marks the order paid.
5. For payment = 0, require an authenticated qualifying customer, an approved capped
   provider budget and verified fulfillment gate; never manufacture a paid Stripe event.
6. On verified refund or safe pre-checkout cancellation, release the reservation; keep
   audit history for reporting.
7. Reconcile lost/unknown checkout and provider outcomes before making allowances reusable.
8. Exercise real staging end-to-end browser, payment-test and recovery cases, then seek
   production approval. Do not disable the customer launch gate merely to demo promo codes.

## Test and rollout

`node --experimental-strip-types --test tests/promotions.test.ts` checks validation,
percent rounding, limits, expiry, ownership, repeat requests, three free-video redemptions
and release guards. `npm run typecheck` also covers the server and UI.

Do not alter existing production data or staff roles. The promotion schema is additive
and created in the existing `commerce.sqlite` after a backup. Keep the current
persistent Railway volume. Codes created in one environment do not appear in another
environment's separate database. The display is a usage counter, not a financial
reconciliation report.
