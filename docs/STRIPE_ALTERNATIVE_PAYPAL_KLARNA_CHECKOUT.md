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
