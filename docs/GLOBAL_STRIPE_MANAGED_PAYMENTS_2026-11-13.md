# Global customer checkout via Stripe Managed Payments (13 November 2026)

**Goal:** Buyers in all Stripe Managed Payments-supported countries can use one-time SingMotion AI video Credit Checkout without maintaining a country-by-country merchant tax rule list.

## Why Managed Payments
Stripe acts as **merchant of record** for approved digital goods and handles indirect sales tax, VAT, GST, fraud and disputes in its supported regions. Unlike Stripe Tax, ordinary merchant tax registrations are not needed in Stripe-managed jurisdictions. It supports customers in **195+ locations**, but explicitly excludes certain countries/territories; do not override payment/geography sanctions. Stripe published AI-as-a-service product tax codes in June 2026. Relevant codes include txcd_10105001 (cloud personal), txcd_10105002 (cloud business), txcd_10105003 (cloud/download personal), txcd_10105004 (cloud/download business).

**Unresolved eligibility:** Stripe’s restricted-business rules explicitly include prepaid cards, virtual credits and stored value; the exact SingMotion product may need special approval. Stripe must independently review whether *prepaid stored-value Credits redeemable later for AI-generated MP4 videos* qualify under Managed Payments. The AIaaS tax-code list alone does not resolve voucher/store-value treatment. Stripe also requires account eligibility and an enabled dashboard setting. Do not falsely attest eligibility.

## Operational controls
- All global country selection is allowed only when `CREDIT_GLOBAL_MERCHANT_OF_RECORD=stripe-managed`, `STRIPE_MANAGED_PAYMENTS_ACCOUNT_APPROVED=true`, `STRIPE_MANAGED_PAYMENTS_PREPAID_CREDITS_APPROVED=true`, `STRIPE_MANAGED_PAYMENTS_LIVE_PRODUCT_REVIEWED=true`, and an actual confirmed eligible `STRIPE_CREDIT_TAX_CODE` is set.
- Actual price, session merchant-of-record status, signed paid webhook, buyer country and customer category must match the bound credit purchase before any wallet credit. Verified disputes and refunds reverse once.
- Country restrictions continue to come from Stripe eligibility and payment/legal availability. Local frontend excludes known Stripe-unsupported locations; Stripe makes the final decision.
- Paid Production checkout and provider generation remain separately gated by their existing human-reviewed wallet, backup, delivery, refund and capital controls. This commit does **not** enable Live flags.
- Business type, prepaid-voucher classification and tax-code correctness: a single fixed tax-code is currently used for both buyer types. Approve that classification with Stripe for both types or implement tax-code selection (and ensure exact Checkout product eligibility) before enabling both. Do not guess.

## Required human evidence
1. Stripe Dashboard > Settings > Managed Payments shows enabled for **Live** account and approved seller.
2. Stripe support explicitly approves prepaid Video Credits / stored-value redemption and selected eligible AIaaS product tax code for all admitted customers.
3. Test an actual Managed Payments Checkout in Sandbox; verify `managed_payments.enabled=true`, destination/currency/line tax behavior, settled amount, paid signed receipt, refund / dispute flow and exact wallet idempotency.
4. Confirm legal invoice/receipt model with Stripe MoR, seller commission, fee, German accounting and return/refund handling. Stripe Managed Payments may charge an additional 3.5% + normal processing fees.
5. Verify real Production backups/restore, provider budget bounds, native video delivery and account access before Public Production launch.

## Official references
- https://docs.stripe.com/payments/managed-payments/eligibility
- https://docs.stripe.com/payments/managed-payments/update-checkout
- https://docs.stripe.com/payments/managed-payments/changelog
- https://stripe.com/managed-payments
- https://stripe.com/legal/restricted-businesses
