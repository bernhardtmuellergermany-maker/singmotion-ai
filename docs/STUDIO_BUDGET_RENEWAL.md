# Renew the private Studio EUR 50 authorization

No new Railway variable, SSH command, JSON file or legacy test slot is required.
After the reviewed revision is available on staging:

1. Keep `GENERATIONS_ENABLED=false`, existing private Super Admin allowlist,
   server-side authorization secret, per-job/cumulative USD caps, duration policy,
   `AUDIO_TEMPO_ENABLED` and recovery-worker configuration unchanged.
2. Sign into Payload as the allowlisted Super Admin, then open **Studio** in the
   same browser/session. In the existing private OmniHuman pilot section, click
   **Review / renew EUR 50 budget**.
3. Review the server-fetched public ECB rate/date, all retained USD reservations,
   and calculated remaining allowance. The expected historical USD 8.64 is read
   from SQLite, never hardcoded, refunded or reset by renewal.
4. Explicitly acknowledge the displayed planning assumptions and click
   **Save budget authorization — no generation**. Studio refreshes readiness
   automatically and clears any previous per-video confirmation.
5. If all other requirements pass, confirm rights/English prompt and click
   **Review real video cost — no paid request**. Inspect the measured processed
   duration/ceiling and separately approve that one paid generation.

The conversion allowance reuses existing planning behavior: twice the rounded-up
ECB EUR-per-USD reciprocal plus EUR 10 held for conversion/payment fees, within
EUR 50 TOTAL and the independently configured USD cap. These are operator-accepted
assumptions, not verified settlement rates, taxes or guaranteed inclusive invoices.
Failed/uncertain tasks retain full reservations. Renewal adds no money or credits.
The actual provider/bank invoice can differ; all existing per-video cost review
and acknowledgment requirements remain mandatory.

A reference must be no more than four days old; the authorization expires after
at most 24 hours (sooner if that reference reaches its freshness boundary).
The displayed offer expires in at most ten minutes and is bound to the authenticated
staff member/session, exact assumptions, current reservations and server USD cap.
Changed balances/caps, expired offers or replayed confirmations require a fresh
review. ECB network/format errors have no guessed-rate fallback. Only the fixed
public ECB endpoint is contacted; no provider/R2 request is involved in renewal.

Reviews and their actor, session, date, assumptions and reservation snapshot are
appended to private SQLite tables. Prior reviews, plans, task IDs, operator slots,
media and reservations remain intact. Latest renewal overrides the old policy or
second-test currency review; expiry never falls back to an older approval.
The latest review is rechecked within the reservation/submission transaction,
including concurrent operations, so stale in-memory terms cannot relax caps.

Other blockers remain actionable: disabled pilot, missing credentials, stale worker
heartbeat, expired media/billing policy, exhausted budget, unapproved duration/host,
missing rights confirmation, rejection provenance or an active/uncertain task.
Renewal does not reconcile those tasks, release their locks or auto-submit anything.
If displayed reservations differ from expectations, investigate the retained ledger;
never overwrite it with USD 8.64 or assume unsuccessful tasks were free.

No deployment or Railway configuration change was performed during implementation.
