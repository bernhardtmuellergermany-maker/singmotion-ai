# SingMotion AI — BytePlus owner confirmation (2026-11-10)

## Owner decision: CONFIRMED

On 2026-11-10, the project owner explicitly reiterated in the project conversation that the BytePlus contract, limits and production test run had already been confirmed repeatedly. **Do not require the owner to repeat the same confirmation as an outstanding owner decision.** Record this item as **OWNER-CONFIRMED** in release planning.

This note records the owner's statement, not a new BytePlus contract, invoice, billing calculation, task result, or independent technical attestation. The underlying evidence, verified account-specific tariff and task IDs are not supplied in this note and must not be invented.

## Separate release verification (not a repeat owner confirmation)

The release operator must correlate the already-approved contract and production test evidence with the exact running Railway/BytePlus configuration and capture a redacted PASS report for:

- exact billable seconds, rounding, minimums, failed/canceled task charges and provider upper cost bound for 5–300s inputs;
- model identity, task submission and final result, 300s boundary/output envelope, validated private MP4 and R2 readback;
- production provider policy provenance, per-job limits, idempotency, status reconciliation and explicit fail-closed behavior;
- current production secret/environment parity and independently passing launch audit.

**Status terminology:** Owner confirmation = COMPLETE. Independent runtime/provider release evidence = NOT ESTABLISHED BY THIS DOCUMENT. Public paid launch = NO-GO until the required checks pass.

Do not flip `PUBLIC_CUSTOMER_LAUNCH_APPROVED`, Stripe live checkout, BytePlus paid dispatch, or related flags merely because this owner note exists. Do not submit new paid provider jobs, issue payments or alter existing customer records in the course of documenting approval.

## Tracking action

In the release checklist, replace “get owner to confirm BytePlus contract/limits/production test” with “verify and link previously owner-approved BytePlus evidence to current Production environment; execute existing production audit”. Do not reopen the owner signoff unless substantive contract facts or scope change.
