# SingMotion AI — Hobby Stripe sandbox rollout (STAGING only)

STAGING Railway environment: `dfaeabed-03df-43ed-aa71-50f343a75041`. Never configure the production environment.

## Current price
Stripe sandbox product `prod_VXzqC4UQjKUG3q`, recurring price `price_1UWtqVBmv7vOK9juUWe853V3`: EUR 4.99 per month, tax inclusive. Free: five projects; Hobby: ten projects and **30 seconds total per paid Stripe billing period**, minimum five seconds per generated video.

## Activate only after end-to-end validation
1. Configure the Stripe **test mode** secret key (`sk_test_...`) in Railway STAGING as sealed `STRIPE_SECRET_KEY`. Never use a live key.
2. In Stripe Sandbox, create a webhook destination for `https://singmotion-ai-staging.up.railway.app/api/hobby-webhook`, subscribing to `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, and `invoice.payment_failed`.
3. Put its signing secret (`whsec_...`) in Railway STAGING as `STRIPE_HOBBY_WEBHOOK_SECRET`. Set `STRIPE_HOBBY_PRICE_ID=price_1UWtqVBmv7vOK9juUWe853V3`.
4. Set up the Stripe Customer Portal to allow canceling subscriptions. The app's `/api/hobby-portal` verifies the subscription belongs to the logged-in account.
5. Confirm `GET /api/hobby-readiness` reports the needed prerequisites. Keep `HOBBY_SUBSCRIPTIONS_ENABLED=false` until successful tests.
6. Test with a new customer: Stripe Checkout sandbox, signed webhook delivery, receipt of paid invoice, 30-second usage and enforcement, renewal on Stripe billing date, failed payment, cancellation, and re-subscription. Verify no double subscription or second monthly quota.
7. Verify that customer-generated videos can actually be rendered and delivered independently of staff-only Studio routes before allowing charges.
8. Only after all tests pass, change `HOBBY_SUBSCRIPTIONS_ENABLED=true` **on STAGING**.

This project does **not** automatically become production-ready when the deployment is green. Running Next.js and the complete paid customer fulfillment flow are different checks. Do not enable production or real charges without an explicitly approved separate rollout.
