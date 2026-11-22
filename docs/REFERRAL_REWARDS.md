# Referral / Refer & Earn — owner-controlled rollout

Added as an opt-in feature. Production and staging default to disabled in the durable commerce database. A CMS **super-admin** can change the live feature switch, reward sizes, minimum first purchase, delay, total credit budget, and per-referrer cap in Marketing & Aktionen. No new Railway public-release flag, Stripe checkout mode or BytePlus task is enabled by this change. **Do not turn it on until a reviewed customer-facing launch.**

## Flow
- Signed-in verified customer sees a personal opaque invitation link on /credits **only if active**.
- /r/[code] validates the active referral and sets a 14-day HttpOnly Secure SameSite=Lax cookie, then redirects to /login. No click data goes to third parties.
- Password and Google OAuth signup bind the referral in the *same SQLite transaction* as a **new** account. Existing account sign-in never binds it, even if a link is visited.
- The existing private worker checks the verified immutable Stripe-paid Credit topups (never a browser redirect) every minute. The **first paid** topup for the invited customer must meet the configurable minimum. Both accounts must be verified and available.
- Pending bonuses snapshot the amounts and delay. Once the hold period is over, the worker books both wallet bonuses atomically in the immutable credit ledger with unique payment-derived references and an audit entry. Automatic retries/worker restarts are idempotent. Disabling a campaign stops *new* rewards but honors already committed pending awards.
- Refunded/disputed purchases before payout are cancelled. Chargebacks after an award move to admin **financial review**; the system does **not** silently debit already spent credit or invent cash refunds.
- Admin dashboard only shows aggregate statistics. Referrer dashboard shows its code and aggregate counters; no friend's identity, email or purchase details.
- Existing customer public welcome gifts, if separately enabled, remain independent. Review promotion stacking and marketing budgets before activation.

## Default stored settings
- OFF
- Referrer 125 Credits; friend 100 Credits
- Verified first purchase at least 500 Credits (€5 at current preset)
- 14-day refund/chargeback hold
- Global pending+awarded budget 25,000 Credits
- Maximum 10 referral rewards per referrer
- Config revisions and immutable commerce_audit rows protect against silent changes.

## Acceptance / pending
Review provider margins, consumer terms, promotion stacking, tax/accounting, campaign fraud rules, erasure/financial retention and frontend responsive appearance. Run the offline regression tests and stage a synthetic first Stripe-paid topup and refund without charging LIVE cards or calling BytePlus. **Do not promise reversal after bonus was already spent without manual finance review.**
