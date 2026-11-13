# Private Production LIVE pilot — implementation, never automatic approval

**Current operational decision: DISABLED.** This runbook documents a separately reviewable **password-protected Production LIVE** mode without marking public launch complete. It does not permit turning on real charges from a green CI result alone.

## Environment separation

- Staging: Stripe **TEST** only, no live Checkout even with a mistakenly copied `sk_live_` key; existing independently authorised BytePlus Studio operator tools remain separate.
- Production: Stripe **LIVE** can be classified for a *private* pilot only when `assessProtectedProductionLivePilot` passes. Private Basic Auth remains mandatory; public release is always `false`. A public Production launch remains subject to `auditSingMotionLaunch` and `productionCustomerReleaseApproved` independently.
- Existing Production `PRODUCTION_PRIVATE_CUSTOMER_PREVIEW_ENABLED` is a **non-billing preview** and does not approve a paid pilot. Keep the paid-pilot flag OFF until every item below is actually verified. Do not set fake attestation flags.
- Existing Stripe LIVE Hobby product/price is labeled **STAGING / sandbox**; live Hobby subscriptions MUST stay disabled until a separate legitimate offer, tax, webhook and cancellation review.

## Mandatory private pilot admission (all must be independently substantiated)

1. `PRODUCTION_PRIVATE_LIVE_PILOT_ENABLED=true` plus `PRODUCTION_PRIVATE_LIVE_PILOT_APPROVED=true` **only following** actual owner signoff and a completed acceptance report. This is a deliberate admission switch, not a substitute for evidence.
2. Production environment ID, `STAGING_AUTH_ENABLED=true`, a strong `STAGING_PASSWORD`, `PRODUCTION_PUBLIC_ACCESS_ENABLED=false`, `PUBLIC_CUSTOMER_LAUNCH_APPROVED=false`, `DEMO_MODE=true`, `GENERATIONS_ENABLED=false`, `ADMIN_DEMO_ENABLED=false`, `BYTEPLUS_LIVE_TEST_ENABLED!=true`; Production sandbox pilot and unreviewed Hobby subscriptions disabled.
3. Both `APP_ORIGIN` and `PUBLIC_SITE_ORIGIN` exactly `https://www.singmotion.ai`. Real `sk_live_` or `rk_live_` API key and its exact live-account signed `whsec_` webhook; `STRIPE_LIVE_CHECKOUT_ENABLED=true` is necessary but insufficient.
4. `PRODUCTION_PRIVATE_LIVE_WEBHOOK_VERIFIED` (signature, reachability through Basic Auth's *webhook-only* exception and durable settlement/replay), `STRIPE_ACCOUNT_LIVE_REVIEW_APPROVED` and `PRODUCTION_PRIVATE_LIVE_PRICE_TAX_APPROVED` (actual amount, inclusive VAT and consumer disclosure); separately verify refunds/disputes. Live credit top-up additionally requires `STRIPE_CREDIT_TOPUPS_LIVE_ENABLED`, `STRIPE_CREDIT_TAX_REVIEW_APPROVED`, and real reviewed `STRIPE_CREDIT_TAX_CODE`.
5. Independent provider/operational evidence: `BYTEPLUS_BILLING_AND_TAX_APPROVED`, `BYTEPLUS_OUTPUT_HOSTS_APPROVED`, `CUSTOMER_PRODUCTION_PROVIDER_BUDGET_APPROVED`, `CUSTOMER_BYTEPLUS_OWNER_CONFIRMED_PRICING`, `CUSTOMER_CLOUD_E2E_VERIFIED`, `CUSTOMER_R2_PRODUCTION_RELEASE_APPROVED`, `PRODUCTION_MEDIA_MIGRATION_VERIFIED`, `BACKUP_RESTORE_EXERCISE_VERIFIED`, `COST_ALERTS_AND_KILL_SWITCH_VERIFIED`, `LEGAL_REVIEW_APPROVED`, `PRODUCTION_CMS_BACKUP_RESTORE_VERIFIED`, `PRODUCTION_CMS_RBAC_AND_PUBLISH_E2E_VERIFIED`, real `SUPPORT_CONTACT_VERIFIED`.
6. Verify CMS production database + secret; enable only reviewed `CUSTOMER_ACCOUNTS_ENABLED`, `CUSTOMER_GENERATION_ENABLED`, `CUSTOMER_FULFILLMENT_ENABLED`, `CUSTOMER_DELIVERY_ENABLED`, `CUSTOMER_R2_STORAGE_ENABLED`, `CUSTOMER_PAID_WORKER_ENABLED`, `CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED`, and `CMS_ENABLED`.
7. Confirm an **independently reviewed production-only, non-staging** `customer-byteplus-policy.json` on the persistent volume or `CUSTOMER_BYTEPLUS_POLICY_JSON`, with validated billable duration, all-in taxes/fees, exact output hosts and finite daily/lifetime caps. Set `PRODUCTION_PRIVATE_LIVE_PROVIDER_MICRO_USD_CAP` to a reviewed integer between `1000000` and `100000000` micro-USD (USD 1–100); the *lower* of this cap and signed provider policy is enforced. This is a **cost** limit, not a video-count limit. The operator may choose a finite policy for the admission phase, never an unlimited automatic vendor billing authorization.
8. Set `CUSTOMER_PAID_WORKER_ACTIVATED_AT` to the actual reviewed activation timestamp in **milliseconds since epoch, no more than 24 hours old**; older paid orders remain out of automatic submission. Never set it to `1` or backdate it to sweep a backlog.

## Acceptance before taking any real money

- Verify TEST payment and owner-only output on Staging; a successful Super Admin video alone is **not** a verified customer payment/entitlement.
- Rehearse real Production private R2 upload/download, missing-file restoration, cross-user denial, byte-range MP4, backup restore, provider task-ID reconciliation, worker crash restart and customer mail delivery without actually charging anybody.
- Verify live Stripe tax/price/receipt/consumer notices and live signed webhook routing to Production. A successful provider read-only probe and a configured webhook are insufficient alone.
- Before the very first live purchase, inspect readiness: `customerLaunchReadiness(...).readyForPaidOrders === true` and `assessProtectedProductionLivePilot(...).ready === true`. Both are necessary; `auditSingMotionLaunch(...,"production")` may remain NO-GO for the separate **public** launch.
- On explicitly approved first low-value charge, verify **once-only** Stripe settlement, private owned MP4 delivery, verified receipt, refund/dispute reconciliation and operational budget reservation, then decide whether to admit additional customers. Never reissue an ambiguous BytePlus POST.
- Shut down *new* purchases/provider dispatch by disabling the private pilot flag or worker/checkout flags; retain signed live reversal reconciliation and existing financial records. Roll back code without removing attached Railway volumes, customer records or private media.

**As delivered in this PR:** code paths + tests only; no Railway secrets, flags, provider submissions, charges, webhook registrations or public DNS changes.
