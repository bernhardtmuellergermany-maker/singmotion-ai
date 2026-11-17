# Global prepaid Credits / Stripe Managed Payments – guarded public release
Date: 2026-11-16 · Parent release tracker: #176 · Stripe approval tracker: #238 · Backups: #230

## 2026-11-17 — Betreiber meldet Stripe-Bestätigung der Prepaid Credits

Der Betreiber hat am 17. November 2026 erklärt: **„ok ist von stripe jetzt bestätigt, mach weiter“**. Dies wird als **Betreiber-Auskunft über erfolgte Stripe-Bestätigung** des SingMotion-Prepaid-Credit-Geschäftsmodells dokumentiert. Die Grundsatzfrage soll nicht erneut beim Betreiber aufgerollt werden.

**Beleggrenze:** Ein Originalschreiben oder eine direkt einsehbare Stripe-Supportfallnummer liegt im verbundenen Projekt noch nicht vor. Daher ist die genaue schriftliche Aussage zu Steuercode für das vorausbezahlte Guthaben, Einzweck-/Mehrzweckgutschein-Klassifikation, Steuerzeitpunkt bei Kauf/Einlösung, ungenutztem Guthaben, Vertragsbedingungen und geographischer Steuerverantwortung derzeit nicht separat attestiert. Der existierende AIaaS-Code `txcd_10105003` bleibt unverändert, bis seine Verwendung für die **verkaufte Credit-Einheit** anhand tatsächlicher Stripe-Aussage oder Steuerprüfung feststeht.

**Operative Konsequenz:** Die Produktzulässigkeit wird **nicht** als neue Konzeptblockade behandelt, die unabhängigen Zahlungs-, Länder- und öffentlichen Release-Checks bleiben bestehen:
- Die vorhandene konservative Liste von 81 steuerlich abgedeckten Käuferländern (Serbien ausgenommen) nicht auf 195+ ausweiten.
- Die zwei bisher angelegten Managed-Payments-LIVE-Checkouts waren offen/unbezahlt. Die bisherigen drei bezahlten deutschen Credit-Checkouts liefen nicht über Managed Payments. Ein begrenzter, tatsächlich bezahlter internationaler MoR-E2E mit verifiziertem Wallet, MP4, Steuerbeleg und Refund ist weiterhin gesondert nachzuweisen und bedarf der Kosten-/Transaktionsfreigabe.
- Vor jedem öffentlichen Verkauf verbleiben die isolierte vollständige Backup-Rücksicherung (#230), Datenschutz/Verbraucherrecht/Support (#90/#91) und die übrigen verifizierten Produktionsabnahmen (#176) als eigene Freigabegates.
- Keine `STRIPE_MANAGED_PAYMENTS_*_APPROVED`- oder Public-Gate-Werte allein aufgrund einer Checkbox oder einer unbezahlten Checkout-Session setzen. Technische Release-Freigabe ist nicht mit dem Betreiberbericht über Stripe zu verwechseln.

## Current verified facts
- The owner has personally completed the **private** German LIVE Credit purchase,
  wallet reservation, AI video generation, private MP4 download, final Credit
  settlement and transactional email, and has separately tested live refunds.
- Railway Production private owner Studio and ledger integrity run successfully.
- The connected Stripe LIVE account accepted an **OPEN, UNPAID** one-time Managed
  Payments Checkout for the existing Credits product, with both a fixed Price
  and inline product/price amount. Sandbox tests also succeeded.
- Stripe does not infer eligibility of **prepaid, future-redeemable Credits**
  from an accepted unpaid Checkout. Product tax-code classification and voucher
  issue vs redemption timing remain independently reviewable.
- Stripe Managed Payments handles indirect tax filing/remittance for the
  [documented cross-border tax-covered markets](https://docs.stripe.com/payments/managed-payments/tax-compliance#cross-border-sales).
  It accepts customers in more markets than those where it assumes tax liability.
  The current application intentionally fails closed outside that tax-coverage
  list (Serbia excluded pending the special registration test).

## Why public Credits have a separate release gate
The old pay-per-video/Hobby worker is **retired** for new purchases. Its
`CUSTOMER_CHECKOUT_READINESS.ready=false` must not block a reviewed public
Credit-only product. Conversely a single public flag must not bypass actual
reviewed Billing/BytePlus/R2/backup/legal evidence.

The separate `assessPublicCreditRelease()` gate is the public-only authority.
It is wired to:
1. The global website password gate (`lib/staging.ts`);
2. Live Credit purchase and signed Credit webhook settlement;
3. The account-scoped Credit balance/purchase UI;
4. The existing prepaid customer Studio and private MP4 delivery; and
5. Account settings and a privacy-safe production startup diagnostic
   `PUBLIC_CREDIT_RELEASE_READINESS` showing fixed blocked gate names.

This gate does **not** enable the retired video Checkout or its public worker.
It imposes **no daily/monthly/lifetime video count cap**. An individual video
still requires an owned, verified prepaid balance, an idempotent reservation,
and a validated provider output before capture.

## Operator release checklist – do not assert evidence from variable presence
The gate reads the following existing setup/review flags plus the new
`CUSTOMER_PUBLIC_LIVE_CREDIT_VIDEO_ENABLED` and
`CREDIT_PRODUCTION_PAID_E2E_VERIFIED`. **Never set a flag to "true" as a
workaround**; only record independently completed evidence, with dated owner
approval.

- Stripe: exact LIVE Managed Payments account/product/eligible tax code, signed
  Checkout and webhook, appropriate refund/dispute processing; no manual claim
  that Stripe Tax alone files/remits taxes as Merchant of Record.
- Country scope: begin with the Stripe Managed Payments covered markets.
  Outside those markets, separate registration, tax filing and compliance
  require seller review; do not automatically activate the 195+ buyer markets.
- Credit path: one verified account's actual LIVE purchase, signed issue,
  BytePlus submission, R2 owner-only MP4, settled Credits and refund/dispute
  recovery; also verify independent customer accounts cannot access each other.
- Recovery: confirmed isolated restore from **real, consistent, encrypted**
  SQLite and CMS Postgres backups and a private R2 recovery rehearsal; the
  existing synthetic SQLite restore drill alone is insufficient.
- Legal: customer Terms, privacy, consumer cancellation, sales receipt wording,
  support contact, refund/dispute handling and payment-provider contractual
  duties reviewed and dated by the operator.
- Operations: validated BytePlus provider contract and output hosts, cost
  alerts, emergency stop, media retention notices and support recovery.
- Public flags: `PUBLIC_CUSTOMER_LAUNCH_APPROVED=true`,
  `PRODUCTION_PUBLIC_ACCESS_ENABLED=true`, `STAGING_AUTH_ENABLED=false`.
  These are **last** to change, only after all other checks pass.
- Live Credit flags: `STRIPE_CREDIT_TOPUPS_LIVE_ENABLED=true`,
  `STRIPE_LIVE_CHECKOUT_ENABLED=true`,
  `CREDIT_GLOBAL_MERCHANT_OF_RECORD=stripe-managed`,
  `STRIPE_MANAGED_PAYMENTS_ACCOUNT_APPROVED=true`,
  `STRIPE_MANAGED_PAYMENTS_PREPAID_CREDITS_APPROVED=true`,
  `STRIPE_MANAGED_PAYMENTS_LIVE_PRODUCT_REVIEWED=true`, and the verified
  AI/SaaS `STRIPE_CREDIT_TAX_CODE`; no guessed code or legal review status.
- New public Studio flag: `CUSTOMER_PUBLIC_LIVE_CREDIT_VIDEO_ENABLED=true`.
  Keep the existing BytePlus and R2 secrets, per-job cost policy, and recovery
  configuration unchanged. Never copy Staging credentials into Production.
- Retired customer per-video worker / Hobby new purchases stay **off**.
- Use `PUBLIC_CREDIT_RELEASE_READINESS` in Railway startup logs to identify
  any remaining unmet evidence without exposing variable values or customers.

## Rollback without orphaning payments
First disable new Credit Checkout only, without stopping signed refund/dispute
reconciliation or hiding completed owner MP4s. Keep the same mounted databases,
webhook secret, R2 credentials and existing unspent customer wallet. If public
Site access is revoked, issue a customer-access continuity plan before closing
access to already-purchased Credits. Do not roll back accounting schema by
replacing a persistent volume or by restoring a stale backup in-place.

The owner-confirmed private DE Credit flow must remain a known-good
reference until the actual cross-border paid E2E is accepted.
