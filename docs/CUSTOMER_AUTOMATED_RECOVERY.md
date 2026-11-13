# Customer recovery logic — support-light but billing-safe

## Sources of truth
* A browser timeout, HTTP 500, failed upload, missing output or abandoned checkout **never proves** that a provider request failed or that a payment was refunded.
* Studio video Credits: `credit_video_reservations.state` is authoritative. Only `released` makes an existing reservation spendable again; `review` and `reserved` still reduce available Credits. `settled` is the final charge.
* Stripe-paid customer orders are **not** prepaid Credit reservations. `customer_orders.status='refunded'` can only be shown after a verified external refund is recorded; a failed video is not proof of refund.
* Frontend notices must be derived from persisted, owner-scoped order/project state and allowlisted provider failure codes; never from raw provider messages, task URLs or a querystring.

## Customer-facing decision matrix
| Trigger | Server action | Primary customer guidance | Do **not** do |
| --- | --- | --- | --- |
| File unsupported, corrupt, too large or rejected *before upload* | No video task or Credit reservation | Pick a valid audio/photo in Studio | Call BytePlus or suggest a wallet check |
| Provider confirms task-bound `50510` pre-filter refusal | Existing task transitions to `failed`; `CONTENT_PREFILTER_REJECTED` releases an owned Studio Credit hold idempotently through `reconcileVideoCredit(...,'nonbillable')` | **Edit photo or audio** → owner-checked `/studio?copy=live_<id>`; create an independent draft | Submit the same rejected task, imply acceptance of unchanged inputs, or claim release before wallet is `released` |
| Confirmed `50510`, but wallet read/write not settled | Hold remains `review` or `reserved` | Edit a new draft if desired; no paid resubmission until ledger reconciliation | Claim Credits are available |
| Provider task `failed` or `canceled` without documented zero-charge evidence | Hold remains for billing review | Original task preserved; no payment or resubmission requested | Release based on failure alone or suggest photo is invalid |
| MP4 download/validation, storage or tempo restore failed | Preserve provider task and media evidence; recover the original output where supported | Video output could not be verified; preserve same project | Ask customer to replace a valid photo or buy Credits |
| Submission result unknown after network timeout | Preserve task/hold; do not attempt another submission | Check the saved project only | Repeat a billable request |
| Status polling slow/unavailable | Safe read-only status on original provider task; automated status read while Output page is visible | Saved project remains; hold unchanged | Create new task, refund on timeout, promise exact ETA |
| Insufficient available Credits | Reserve nothing, block generation | **Buy Credits** with shortfall, return to saved Studio draft | Begin production |
| Stripe checkout cancelled or card declined | No verified Credit wallet settlement | Checkout cancelled/failed; user may choose another payment method | Claim paid, credit wallet, or auto-retry |
| Stripe redirect says success, webhook delayed | Keep pending until signed verification | Payment confirmation pending; original checkout checked | Add Credits based on URL or start a new checkout |
| Internet lost during checkout or upload | Keep existing durable state; retry reads rather than writes | Reconnect, check original payment/file | Duplicate the order or upload blindly |
| Signed external Stripe refund **already recorded** | Owner-scoped order says `refunded` | Payment refunded; customer may edit saved draft with a new explicit order | Display `Payment confirmed` or claim Credit wallet adjustment |
| Paid Stripe order `failed` with no verified refund | Preserve original paid order, payment receipt, provider evidence | Paid video not delivered; original payment checked | Claim money refunded or take another payment |
| Stripe dispute/chargeback | Freeze additional fulfillment and preserve records | Payment in review | Retry payment or deliver private video |
| Session expired | Require owner/session re-authentication | Sign in again | Disclose media or financial details to another user |
| Server outage/rate-limit | No duplicate paid action | Wait and check saved task | Charge or dispatch on retry |
| Verified video delivered | Settle one reservation and expose validated private MP4 | View/download video | Apply second Credit charge |

## Deterministic self-service
* An owned `copy=live_<id>` GET returns original media and settings only. Studio creates a **new draft and new request key**. It does not copy a provider task ID or payment authorization. Only a new explicit generation review can incur a charge.
* Output pages periodically read the existing project. While visible, a bounded read-only `poll` is requested approximately every 30 seconds only for `submitted/processing` tasks. A transient error leaves the last confirmed project visible; the caller never invokes a submit action.
* The server's existing recovery worker can read provider tasks when `BYTEPLUS_STUDIO_RECOVERY_ENABLED` is explicitly enabled. It never sends new generation requests.
* A structured, task-bound 50510 rejection already triggers the Studio wallet's release-once logic. The UI checks the **wallet state after reconciliation** to decide whether to display “Credits released.”
* Never hide an unresolved monetary warning with an auto-dismiss timer. Clear or replace it only when the authoritative state changes.
* Only known-safe next steps appear as buttons: editing a verified rejected input, buying insufficient Credits, or signing back in.

## Automation boundary (not yet an unconditional refund promise)
* BytePlus `PROVIDER_JOB_FAILED`, `MISSING_OUTPUT`, transport failures and post-submission errors do not establish zero billing. Fully autonomous release on these codes would risk double spending and inconsistent provider charges. The ledger must remain in review until independent billability evidence is available.
* The separate Stripe **paid-video order** path records verified refunds but does not issue refunds for acknowledged jobs automatically. To eliminate human review on those cases, implement task-bound billability attestation plus a provider-approved automated Stripe refund reconciler with idempotency and real-card testing. Do **not** reclassify a Stripe refund as a Credit return.
* Cloud/provider costs and customer contractual refunds are separate financial obligations. The application cannot assert an external refund merely because the provider stopped generating.

## Verification gates
1. Exactly one released Credit ledger event for confirmed 50510; refresh/repeated polls do not double-release.
2. Uncertain/charged/unknown provider states keep the hold.
3. A failed or invalid output cannot falsely offer “Replace photo” as the fix.
4. The owner-only edit action produces a fresh draft and never resubmits an old provider task.
5. Stripe refund/dispute states must override generic “Payment confirmed.”
6. Desktop/mobile Output previews must cover all cases without network, charges or account mutations.
