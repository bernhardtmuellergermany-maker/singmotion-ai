# All-account real video generation: release criteria

**Status: BLOCKED.** This is a work plan, not authorization to submit paid BytePlus jobs or enable Stripe live. Railway Production and its volumes must remain unchanged until acceptance evidence exists.

## Required journey for each account tier

Both **Free** and **Hobby** users must be able to use their own authenticated media and project, without using a staff ID, admin session, operator secret or shared demo identity. Test an ordinary non-admin account of each tier.

1. Authenticate account and bind media owner to `customer-<accountId>`. Never accept caller-selected account, price, voucher discount, owner, job ID or authorization status.
2. Validate uploaded image and encoded audio, content rights, immutable hashes, measured clip duration and private provider input lease. Quote VAT-inclusive customer price server-side.
3. Atomically reserve one per-order entitlement: verified Stripe payment, available prepaid plan seconds, or independently authorized zero-EUR promotion with bounded provider spend. A voucher reservation by itself is not a paid order.
4. Exactly one claimable provider submission per order. Before the external request, durably persist an immutable order/media commitment and an **uncertain submission** barrier. A transport timeout must not trigger automatic duplicate paid submission.
5. Require reviewed, dated BytePlus billing policy and inclusive per-order/daily/cumulative cost ceilings, approved output hosts and formats, worker recovery heartbeat and kill switches. Record actual provider task ID before polling.
6. Recover the same task on restart, validate and privately archive MP4 to R2 with checksum, deliver only to its authenticated owner, including HTTP byte ranges. Never expose public object URLs or cross-account media.
7. Reconcile payment, fulfillment, refund/cancellation and provider charges independently. Never imply technical failure means an automatic BytePlus refund. Provide user-visible status and support recovery.

## Mandatory verification matrix

- Free account: genuine purchased video and a separately approved free-promotion video; both delivered to the same owner.
- Hobby account: included plan seconds and paid overage; verify atomic allowance and charge semantics.
- Two different accounts: concurrent uploads/orders; prove no read, download, cancellation or alteration of each other's video.
- Duplicate requests and lost provider response: no second provider charge; operator reconciliation resumes stored task.
- Provider delay/failure, invalid MP4, expired output URL, R2 eviction and worker restart: durable state, no lost purchased delivery, no public URL.
- Signed Stripe test payment, refund and webhook replays: no duplicate entitlement and no fabricated paid status.
- Genuine authorized BytePlus test: measured actual charge (including taxes/fees), real result hostname/codec/duration and verified MP4 archive.
- Production R2 credentials, backup/restore, retention notice, customer support and final explicit production approval.

## Deployment order

1. Develop and verify in protected Staging. Run integration, browser and security tests against isolated stores; use synthetic/provider mocks until a bounded paid test is separately authorized.
2. Connect order-to-worker dispatch and delivery for **both** tiers. Review and test every actual runtime gate, not just environment-variable names.
3. Run a limited, explicit budget-capped provider acceptance test with a non-admin test customer account. Inspect charges and private delivery.
4. Review production migrations, R2 and CMS data backups/restore, legal, Stripe live and monitoring. Roll out only after a passing production launch audit and separate release approval.

`all-customer-generation` in `lib/launch-audit.ts` intentionally cannot be satisfied by enabling `BYTEPLUS_STUDIO_ENABLED`, adding staff allowlist IDs or setting human signoff flags. The current `customerLaunchReadiness` implementation reports the commercial customer pipeline as disconnected until it is actually implemented and independently tested.
