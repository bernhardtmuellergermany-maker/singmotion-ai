# Worldwide Credit/Voucher Tax – guarded release policy (13 Nov 2026)

**Scope:** Signed-in customers and Super Admins buy prepaid SingMotion Credits redeemable exclusively for AI videos. Merchant is a German Kleinunternehmer under § 19 UStG by owner's statement. This is an engineering framework and **not** an automatically certified tax position for all countries.

## Jurisdiction and voucher event
- The global website can display prices everywhere. A **real payment** is admitted only if a human-reviewed, dated jurisdiction and buyer-type entry exists.
- Each entry declares a legal voucher classification, the applicable tax mode and non-empty evidence. Unknown countries, changed classifications, invalid dates, contradictory entries and unapproved seller status fail closed.
- German domestic § 19 treatment is permitted only for an explicitly reviewed DE policy entry and CREDIT_TAX_DE_KLEINUNTERNEHMER_APPROVED. It is never copied to another country.
- EU cross-border SME exemptions require independent validated EX registration and covered-country eligibility; merely having German Kleinunternehmer status is not sufficient.
- Outside EU, any local digital-service / sales-tax / GST registration and invoicing obligation needs separate review; Stripe Tax alone does not supply legal classification.
- A single-purpose voucher is only approved if place of supply and tax due are known at issue. **Multi-purpose vouchers are blocked from paid Checkout** until an independently reviewed redemption-time tax ledger and provider event evidence are operational. Do not bypass this with a zero VAT line.
- Stripe Checkout collects billing address and optional tax IDs; credit wallet binds the reviewed policy and Stripe event verification compares the **paid session** with the stored buyer country, buyer type and voucher decision. Disagreement prevents credit settlement and requires operator-led refund / reconciliation.

## Configuration (no default foreign jurisdiction allowances)
`CREDIT_TAX_WORLDWIDE_REVIEW_APPROVED=true` only after country-specific accountant or qualified tax review.
`CREDIT_TAX_DE_KLEINUNTERNEHMER_APPROVED=true` only while valid §19 status and turnover thresholds are monitored.
`CREDIT_TAX_COUNTRY_POLICY_JSON` is server-only JSON:
```json
{
  "revision": "reviewed-YYYY-MM-DD",
  "reviewedAt": "YYYY-MM-DD",
  "entries": [
    {
      "country": "DE",
      "buyerType": "consumer",
      "voucherKind": "single-purpose",
      "mode": "de-small-business",
      "evidence": "DOCUMENTED LEGAL REVIEW REQUIRED -- THIS PLACEHOLDER MUST NOT BE ACTIVATED"
    }
  ]
}
```
These are **illustrative fields, not evidence**. `buyerType` is `consumer` or `business`; `voucherKind` is `single-purpose` or `multi-purpose`. Tax `mode` is `de-small-business`, `eu-sme-exempt`, `stripe-tax` or `reviewed-no-tax`. For EU SME exemption provide the verified EX number; for Stripe Tax provide `taxRegistrationEvidence`, reviewed `STRIPE_CREDIT_TAX_CODE` and `STRIPE_CREDIT_TAX_REVIEW_APPROVED=true`. Maintain a separate entry per country and buyer type.

## Before any live sale
1. Validate exact merchant legal owner, German §19 status/current and preceding fiscal turnovers, taxable supply place, single/multi-purpose treatment and countries for which a real exemption or registration is held. Note the EU cross-border scheme requires notification and confirmation; no fallback to DE §19.
2. Test Stripe Tax location and customer classification in test mode, including countries without registrations, business ID behavior, tax inclusion, refunds and failed async events. Verify seller is the merchant of record (Managed Payments settings).
3. Run a signed webhook / paid checkout and full refund with a test account; confirm same-session idempotency and immutable buyer tax record. Mismatched address charges must be reconciled/refunded by an operator; withholding credits alone does not reverse a charge.
4. Verify credit-wallet SQLite backup and independent restore, private customer asset restore, provider billing contract, prices and live operational kill switch. Do not set proof flags based on unit tests.
5. Verify legal consumer documentation and invoice/receipt requirements. World-wide tax law evolves; refresh country policies at least every 93 days and on threshold / legal-status changes.

## Primary sources
- German § 19 UStG: https://www.gesetze-im-internet.de/ustg_1980/__19.html
- EU SME scheme: https://sme-vat-rules.ec.europa.eu/index_en
- EU vouchers: https://eur-lex.europa.eu/legal-content/en/TXT/?uri=CELEX:32016L1065
- Stripe Tax: https://docs.stripe.com/tax/set-up
