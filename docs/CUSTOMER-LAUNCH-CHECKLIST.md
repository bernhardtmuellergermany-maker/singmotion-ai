# Customer launch checklist

Current decision: **private preview only**. A successful CI build is not proof that paid customer generation, refunds and private delivery work with real providers.

## Implemented in this release
- Build-time regression tests for production public access, customer account readiness, Stripe webhook integrity, customer worker admission, provider idempotency, and private delivery permissions.
- A failed test blocks the Railway Docker build. Synthetic tests do not charge money or submit videos.
- Continue promoting the same tested commit from Staging to Production.

## Human-reviewed prerequisites for public access
1. Verify Stripe live account onboarding, verified webhook destinations, real refund/dispute handling and subscription cancellation.
2. Verify BytePlus inclusive billing, strict cost ceilings, provider recovery and single-submission behavior.
3. Verify R2 private storage, owner-specific download access, media migration and backup restore.
4. Verify CMS publishing permissions, legal pages, customer consent, support and data retention.
5. Verify free entitlements, cost alerts, kill switches and the actual paid checkout-to-video journey.

Run the existing production-only read-only launch and Stripe preflights with appropriately configured production credentials. Record independent review evidence before changing any paid-generation or public-release switches. Never set review flags merely to make tests pass. Never charge a real customer through a CI pipeline.

Production must remain privately accessible until all independent launch checks pass.
