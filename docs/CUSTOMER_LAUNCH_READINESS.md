# Customer launch: outstanding work (Stripe integration deliberately excluded)

Current customer commerce foundations: account sessions, guest-order access, order records,
verified-payment adapter interface, credit holds/refunds and private media sessions.
None of these alone authorizes customer BytePlus work.

## Required before enabling production checkout
1. Define and review a customer-facing EUR price including applicable taxes and provider
   cost ceilings for each supported length. Price must be a server-generated immutable quote.
2. Use a signed provider payment webhook and idempotent event storage to mark an order paid.
   Do not take client-supplied status, price or payment objects as proof of payment.
3. Create a customer-only fulfillment workflow keyed by order ID. Require a verified paid order,
   rights consent, validated media ownership, approved provider policy and per-order budget.
   The existing private operator Studio workflow must not become a public endpoint.
4. Persist state transitions (awaiting_payment -> paid -> queued -> processing -> completed/failed),
   provider job ID and retry evidence atomically. Prevent duplicate dispatch, including after restarts.
5. Connect processing to private download URLs with ownership checks, secure retention and
   customer email notifications. Settle refunds explicitly when provider charges are uncertain.
6. Add load, abuse, media-safety, concurrency and failure-recovery tests; verify real provider
   and billing terms. Maintain appropriate rate limits and per-customer quotas.
7. Configure backups, monitoring, alerting, support and a documented incident response.
8. Activate only after a real end-to-end paid test in staging and a reviewed production rollout.

Until these are complete, `customerLaunchReadiness()` must return false. 
Do not treat toggles or this document as a production authorization.
