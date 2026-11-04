# Stripe: from private sandbox to verified paid customer orders

**Release decision: NO-GO for real payments until the final operator evidence below.**

## Implemented, safely offline

- The one-off, price-reviewed EUR Checkout flow exists at `POST /api/stripe-checkout`. It does not take browser-supplied amounts or owner data.
- The Stripe event signature is checked using the raw request body, with a bounded body size and timestamp tolerance.
- `customer_orders` binds the Stripe-created Checkout Session ID before a signed paid event can change the order; payment events are idempotent. Paid orders enter a non-auto-dispatched fulfillment queue.
- Delayed payment methods: acknowledge signed `checkout.session.completed` with `payment_status=unpaid` without delivering; only a subsequent signed `checkout.session.async_payment_succeeded` showing `paid` can settle the order. A delayed failure remains unpaid for review.\n- One-off Checkout amounts are represented as inclusive EUR prices; legal tax treatment still needs human verification.\n- Signed refunds/disputes are checked against Stripe's charge and session before changing an order. The worker must not retry an uncertain provider submission.
- `configuredStripePaymentMode` now isolates private staging (`sk_test_`, `cs_test_`, `livemode=false`) from verified production (`sk_live_`, `cs_live_`, `livemode=true`) and requires separate production release flags before selecting live mode.
- **Code still deliberately returns `customerLaunchReadiness().readyForPaidOrders === false`** until a verified paid-worker, private cloud delivery and customer notification/recovery path are actually connected. Setting Stripe flags or inserting keys cannot bypass this.

## The monthly Hobby subscription is separate

The Hobby checkout and webhook under `/api/hobby-*` are currently **staging/test-mode only** with a reviewed EUR 4.99/month inclusive-tax test price. They are **not** a production subscription implementation and must not be enabled by this change or represented as recurring live revenue.

## Read-only technical audit (no charge)

On the actual protected Railway **Production** runtime, after onboarding the
independently verified Stripe Live account, configure the server-only
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and
`STRIPE_HOBBY_LIVE_PRICE_ID` plus `PUBLIC_SITE_ORIGIN` (exact public HTTPS
origin). Then run:

```sh
npm run stripe:live-preflight -- --production
```

This calls only Stripe **GET** operations to validate live account
`charges_enabled` and `details_submitted`, the active inclusive EUR 4.99
monthly price, and a live enabled HTTPS webhook that subscribes to paid
Checkout, delayed paid success, refunds and disputes. It never creates a
payment, returns customer information or prints credentials. It **always
returns a failure exit code while actual paid customer fulfillment and
delivery are not active**: passing Stripe config alone is not enough.

Do not run this read-only live key check in Staging; its code refuses to make
Stripe calls unless the exact Production Railway environment is present.
Passing this audit is not an authorization to charge customers.

## Required external/operator steps before any real charge

1. Connect an eligible, verified **live** Stripe account. This chat currently has **only** a sandbox account (`livemode=false`). Never copy `sk_test_` or test-mode price IDs into live production.
2. Decide which products are actually deliverable: one-off video orders versus Hobby recurring credits, plan duration, tax-inclusive EUR pricing, cancellation, withdrawal/right-of-withdrawal handling, notices and invoice evidence. Approve real prices and tax obligations.
3. Provision the independent Production R2 bucket and server-only keys. Complete real private upload/download, owner denial, backup + restore, retention and notification testing.
4. Approve BytePlus charge ceilings (including tax), host allowlist and cost alerts. Perform a separately authorized real-provider test with an explicit low budget and recovery plan. Do not dispatch a paid order before its inputs and budget are durably verified.
5. Finish and test the paid customer fulfillment worker and actual email/support recovery. Confirm customer-visible failed/unknown orders and refunds are handled with no duplicate provider spend.
6. Install Production Stripe live signing secret and server-side `sk_live_` key via protected Railway variables (never in GitHub or this chat). Configure the real public webhook endpoint and validate `checkout.session.completed`, refund, dispute and delayed payment scenarios, including exactly-once settlement and ownership.
7. Review the production CMS/database migration and restore, legal documents, contracts and customer consent; rehearse rollback. Collect evidence for every gate in `npm run launch:audit -- --production`.
8. ONLY after all those checks pass, authorize a controlled real-cost pilot and later a public launch. `PUBLIC_CUSTOMER_LAUNCH_APPROVED` is a final recorded decision, not a shortcut to skip missing tests.

**This change performs no live Stripe API writes, customer charges, production deploys or provider jobs.**
