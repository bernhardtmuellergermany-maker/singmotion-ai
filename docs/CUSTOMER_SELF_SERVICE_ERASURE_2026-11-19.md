# Customer self-service erasure — safe first release (2026-11-19)

## Scope and user promise
- `Account Settings → Privacy & deletion` provides server-side eligibility check and a password-confirmed account deletion for a customer with **no associated media, orders, provider evidence, paid Credits or other business records**.
- This release does **not** implement automatic multi-store customer-media deletion, Cloudflare R2 purging, provider erasure, tax retention reconciliation or proportional Stripe refunds. Do not represent it as complete GDPR erasure for every account.
- An eligible deletion removes the customer account row, password hash, login sessions (all devices), media sessions, inactivity policy, verification/password reset data, email preferences, any bound OAuth identity and the single verified **beta-welcome** promotional ledger entry. It does not touch CMS admin/staff, unrelated customers, Stripe, legacy paid invoices or any monetary ledger.
- Only customers with an established password can use this version. OAuth-only accounts cannot prove their password and need a verified fresh Google authentication flow before self-service erasure is enabled.
- Accounts with financial or media references are **not changed** by a blocked attempt and receive a clear way to exercise privacy rights and arrange outstanding credit/payment resolution with support. A privacy request itself must not require discretionary administrator approval.
- Stripe invoices in Dashboard are useful but not independent evidence of complete tax retention, availability, export, refund/dispute audit or provider-generated project cleanup. Preserve necessary financial evidence until legal and accounting sign-off.

## Safety properties
1. Authenticated `sm_customer` session checked server side; POST demands exact same-origin `Origin`, rate limits attempts, caps request body, verifies password with the existing salted hash, and demands `DELETE MY ACCOUNT` plus a browser confirmation.
2. Never sends a Stripe refund, cancels a subscription, calls BytePlus or deletes an R2 object. A record with a matching account identity or email in any unknown commerce/demo/live SQLite table is a **hard blocker**. Serialized JSON containing the identity is also checked.
3. The account and session cleanup executes only after a second guard under `BEGIN IMMEDIATE` locks. Failure rolls back incomplete SQL work. Media sessions are invalidated before committing the account deletion.
4. Paid, pending or disputed credit top-ups and any video reservation **block** erasure even if net balance appears zero. The only wallet row that can be removed is the exact, verified one-time bonus `beta-welcome:v1:<id>`.
5. Other account and media owners remain intact. Missing `demo.sqlite` is a blocker, not an assumption of no files.
6. Local volume snapshots and offsite backups follow their own verified retention/recovery lifecycles; this endpoint does **not** synchronously erase backup generations. If data is restored, previously deleted users must not be reactivated.
7. This is not a replacement for verified GDPR request handling where required; support remains an alternate way to submit such requests.

## Explicit outstanding work before full self-service launch
- Design a durable cross-store owner-erasure job across `demo.sqlite`, `live-test.sqlite`, `commerce.sqlite`, Railway media volume, Cloudflare R2 source/input/output manifests, providers and emails, with exact-key deletion confirmation and idempotent retries.
- Safely conclude or resolve active/uncertain video generation and credit reservations before erasure.
- Determine actual refundable **purchased** credit portions (not total including free grants or previously settled video consumption), perform verified Stripe refund in the correct live/test merchant account, and reconcile signed webhook, tax credit notes and disputes. Never implement a blanket credit forfeiture.
- Preserve legally retained transaction evidence with access restrictions; document retention periods and legal bases. Confirm Stripe invoice archival/export and accounting obligations separately.
- Add an OAuth-only fresh sign-in proof mechanism, abuse prevention for repeated promotional signups, backup expiry reconciliation, R2 and provider-side deletion certification and representative restore tests.
- Exercise staging on synthetic customers and realistic owner data, test cross-account isolation, then obtain privacy/accounting review before enabling more destructive paths.

## Regression
`node --experimental-strip-types --test tests/customer-account-erasure.test.ts` is included in the production build gate.
