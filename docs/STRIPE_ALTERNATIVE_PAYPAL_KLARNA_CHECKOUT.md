# PayPal and Klarna — optional seller-of-record Stripe Checkout

Date: 2026-11-21

## Why this is separate

SingMotion's current LIVE Credit Checkout uses Stripe **Managed Payments**.
That service is merchant of record and owns relevant tax and customer payments
obligations. PayPal is not supported by Managed Payments. Klarna eligibility
is not the same as enabling Klarna for normal Stripe Payments. Do not switch
all customer purchases away from Managed Payments just to display PayPal.

The SingMotion Stripe LIVE account has PayPal and Klarna enabled in its
**regular** payment-method configuration, but Stripe still determines which
payment methods appear at the actual Checkout according to account,
transaction, currency, country, and customer eligibility. No method is
guaranteed just because its Dashboard toggle is on.

## Implemented, but not released to customers yet

An independent optional `paymentRoute: "alternative"` lets a buyer request
**seller-of-record** Stripe Checkout. The default remains the same Managed
Payments path. The alternative uses the existing dynamic payment method
configuration (does not hard-code `payment_method_types`) and requires
country and buyer type before Checkout.

It is intentionally hidden and rejected by the API until **all** of:

- Actual Railway Production environment and existing live-credit purchase gates;
- `CREDIT_ALTERNATIVE_STRIPE_CHECKOUT_APPROVED=true` after documented
  operator sign-off *for this specific change of merchant-of-record*;
- `CREDIT_TAX_WORLDWIDE_REVIEW_APPROVED=true` and a currently valid, actual
  `CREDIT_TAX_COUNTRY_POLICY_JSON` with evidence for each eligible country /
  buyer type, including the prepaid-Credit voucher treatment and tax point;
- Existing current `STRIPE_CREDIT_TOPUPS_LIVE_ENABLED=true` and
  `STRIPE_LIVE_CHECKOUT_ENABLED=true`.

The server checks the country/type against the reviewed policy before
creating the payment. The signed webhook verifies paid status, Stripe's
actual billing country and stored country/type/tax decision *before*
crediting the wallet. Async/unpaid sessions do not credit the wallet.
Existing refund/dispute revocation, idempotency and webhook keys are
unchanged. Do not turn on a gate simply to bypass a missing tax review.

## Release verification

1. Obtain written review for tax responsibility of the German seller (vs
   Stripe MoR), prepaid-credit voucher classification, country scope,
   customer receipts/invoices, refunds, and billing-country verification.
2. Run the new unit tests and full Staging build; leave Staging sandbox
   checkout on the existing test path. Verify payment method display with a
   dedicated eligible **unpaid** LIVE session only after legal approval.
3. Test real paid *approved* method, verified wallet ledger, asynchronous
   settlement, full/partial reversal, and invoice/tax evidence with an
   explicit low-cost authorized canary. Never self-authorize financial spend.
4. Verify PayPal and Klarna separately for DE/EUR. Method availability is
   decided by Stripe, not by the SingMotion UI.
5. Enable the approval flag only after every prior step passes and a
   rollback plan for new sales exists. To roll back, unset the alternative
   approval flag without disabling signed webhook settlement of past paid
   purchases.

No new Stripe charge or account settings change is created by this code.

## Current branch reconciliation — 2026-11-24

Preserve campaign tariff and camera preview changes. Stripe live payment method configuration was checked read-only: regular default PayPal and Klarna are enabled/available; the application-linked default does not support PayPal. Sandbox regular default PayPal is off; enable it through Stripe Dashboard before an end-to-end sandbox PayPal test. No live gate, tax policy or funds were changed. An enabled method is not proof of successful checkout or legal approval.

## Threshold-country expansion (2026-11-24)

Owner-supplied adviser text permits reviewed threshold-based countries only while there is verified headroom. Stripe payment volume is a partial baseline, not evidence of all business turnover. New consumer-only modes distinguish EU origin taxation under the EUR 10,000 rule from local registration thresholds (CH, AU, NZ, NO). Before enabling, obtain all-channel current/prior-period turnover, confirm establishment and no destination-tax election for the EU mode, check each country's threshold and applicable time window/currency, set CREDIT_TAX_THRESHOLD_BASELINE_APPROVED=true and CREDIT_TAX_EU_ORIGIN_THRESHOLD_APPROVED=true as applicable, plus a conservative shared lifetime CREDIT_TAX_THRESHOLD_CHECKOUT_CAP_CENTS no greater than 100000 (EUR 1,000), and add individually reviewed entries to the country policy. This cap reserves all issued/pending/expired/reversed threshold purchases and does not auto-reset. It is a safety pilot, not a substitute for monitoring other sales or for local registrations. Canada (province review), US (state review), UK/Turkey/Mexico (registration) are excluded from these new modes. Existing domestic and Managed Payments flows remain unchanged. No new international approvals or turnover claims are created by deploying the code.

## Owner-directed unified Stripe Checkout (2026-11-24)

The operator explicitly instructed SingMotion to switch to ordinary Stripe Checkout and assume seller tax responsibility. New Production-only flags CREDIT_STANDARD_STRIPE_CHECKOUT_ENABLED and CREDIT_STANDARD_STRIPE_SELLER_TAX_RESPONSIBILITY_ACCEPTED select this path, not an attestation of registration, exemption or completed legal review. Existing global release and identity controls remain in force. Checkout collects the actual billing address and optional business tax ID, enables Stripe Tax and post-payment invoices, uses inclusive EUR prices and dynamic payment methods, disables Managed Payments and adaptive currency pricing. A live unpaid configuration check listed PayPal, card and Klarna; no charge was made. The sandbox standard session also succeeded, but PayPal is off in that sandbox configuration. The signed webhook fetches the paid session, verifies the exact bound purchase and seller-tax mode, and records actual country/buyer type as seller-review-pending, never a fabricated reviewed country policy. Prior Managed Payments sessions continue to reconcile. Existing bound normal sessions can settle after a sales pause. No blanket German VAT exemption invoice footer is applied to foreign invoices. Stripe Tax settings are active, with no registrations currently present; Stripe Tax does not collect tax where registration is missing. The seller must monitor jurisdictional thresholds and register/remit when required (including first-sale obligations), not just at annual tax filing. Verify German small-business invoice wording, local registrations and Stripe successful-payment email settings in Dashboard. To roll back new checkout creation, disable CREDIT_STANDARD_STRIPE_CHECKOUT_ENABLED; keep historical receipt processing intact.
