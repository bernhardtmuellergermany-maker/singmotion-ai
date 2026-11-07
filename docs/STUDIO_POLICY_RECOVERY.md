# Repair missing private Studio policy on Railway

This runbook applies to the private Super Admin Studio only. It does **not**
activate paid customer processing or public access.

## Confirm the problem

Check the SingMotion application deployment logs for
`PRIVATE_STUDIO_CHECK studio-policy POLICY_MISSING`. A healthy worker or
`studio-gate READY` does **not** mean that paid provider submissions are ready.

## Restore a previously reviewed policy

The Studio service needs a currently reviewed, provider-specific policy with
real output-host, accepted media, generated-duration and inclusive billing
evidence. The existing secure file source is
`/app/.data/studio-live-policy.json`.

Where volume access is unavailable, this patch also supports a Railway
service variable **`STUDIO_LIVE_POLICY_JSON`** whose value is the *complete*
JSON of that already-reviewed policy. Configure it in the existing
`singmotion-ai` service in the intended Railway environment; do not prefix
the variable with `NEXT_PUBLIC_`, do not commit its contents, and do not
paste provider credentials into the policy. Use a sealed Railway variable if
appropriate. A missing file is the **only** situation that permits the
environment fallback. A readable but invalid file still blocks submissions.

The same policy validation and expiry checks apply to the environment value
as to the file. Its UTF-8 size must not exceed 65,536 bytes.

If no reviewed policy exists, **do not fabricate one from a five-second
sample, expected duration, unreviewed rates or assumed output hosts**.
The existing activation flow (`prepareActivationPolicy`) requires a
validated historical provider output and an operator-reviewed, inclusive
billing ceiling. Get the actual BytePlus account terms and evidence before
generating new paid requests.

## Owner-confirmed price information (5 November 2026)

The owner confirms that their BytePlus OmniHuman 2.0 account is billed at
**USD 0.07 per second of generated video**, with **no separately charged
taxes**. This matches the existing internal base-rate constant
`70000` micro-USD/second; no price-rate code change is necessary.

Illustrative base amounts if exactly the listed duration is billed:
5 s = USD 0.35, 10 s = USD 0.70, 30 s = USD 2.10,
60 s = USD 4.20, 300 s = USD 21.00.

**Do not mistake this price confirmation for a complete approval of live
billing.** It does not establish fractional-second rounding, minimum
billable duration or charges, failed-request charges, extra processing
fees (if any), or the generated-duration upper bound. Nor does it supply
the approved output hostname and media properties. The server policy
must still be based on the actual contract/output evidence. Do not
silently substitute `taxBasisPointsUpperBound: 0` into a production
contract unless zero applicable tax is explicitly supported by the
relevant account billing evidence. The app's existing Super Admin
planning allowance is not an invoice promise.

## Verify before rendering

1. Deploy the reviewed change to staging before production. Keep customer
   dispatch and public release switches disabled.
2. Supply the reviewed policy through the protected variable or restored
   file. Confirm startup reads `PRIVATE_STUDIO_CHECK studio-policy READY`.
3. Confirm `studio-gate READY` and `studio-recovery READY` separately.
4. Open a private, authenticated Super Admin Studio session and review one
   short clip. Confirm the server quote, content rights and the exact
   provider task approval before any charge.
5. Verify one approved output through the existing task-ID recovery, output
   validation and private download flow. Do not retry uncertain submissions.
6. Keep account-level caps and customer billing independent from Super Admin.
   Uncapped *app entitlements* do not mean free, infinite or unreviewed
   provider spending.

Do not delete, rewrite or reset the existing `live-test.sqlite` ledger,
unknown provider tasks, persistent volumes or stored policy evidence.
