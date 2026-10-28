# Private sequential Studio tests (4–60 seconds)

This extends only the allowlisted Payload Super Admin pilot. Public generation, Stripe and customer billing remain disabled. No existing plan, singleton operator slot, output, reservation or ledger is reset. There is no test-count quota; each paid generation still needs a separate exact-plan confirmation and an available budget.

## Concurrency and repeat behavior

The existing SQLite reservation transaction now checks for one active generation globally before reserving and again before consuming submission approval. Authorized, submitting, submitted, processing, output-observed and uncertain records block another Studio test, including unresolved original operator tests. A pending Studio test also blocks another operator workflow's approval. Reconcile unknown outcomes; do not mark them free or reset their slots. Failed/completed terminal tasks retain their full reservations.

Identical selection requests still return the same project. After a terminal result, **Review another test of this selection — no paid request** deliberately creates a new independently reviewed plan. Its repeat identity is bound to the prior owned terminal plan: duplicate clicks/retries reuse that new plan. Every repeat still needs cost review and the separate **Generate ONE real video** confirmation. This never automatically retries a failed paid task.

## Fixed EUR 50 cumulative authorization

The Studio now enforces both the configured USD limit and an EUR-50-derived cap. It sums **every existing reservation** in `live-test.sqlite`, including unresolved task 1660608639 and successful tests. Success/failure does not replenish spending capacity. The displayed remainder is a reserved allowance, not a settled balance or invoice guarantee.

Use `eurBudget` in the private `studio-live-policy.json`, or the existing second-test currency review if it is still valid. It contains:

- `eurPerUsdUpperPpm`: reviewed conservative EUR per USD, in millionths.
- `fxFeesMaxMicroEur`: retained total conversion/payment-fee allowance, in microEUR.
- `evidence`, `reviewedBy`, `reviewedAt`, `validUntil`: explicit provenance; maximum validity seven days, no future review date.
- Optional `budgetBasis: "planning-allowance"` preserves the existing disclosed planning assumptions. These are not guaranteed bank fees.

The fixed calculation is `floor((50,000,000 microEUR − fee allowance) × 1,000,000 / EUR-per-USD-millionths)`, narrowed by `BYTEPLUS_STUDIO_MAX_TOTAL_MICRO_USD`. Reservation totals and the prospective new reservation must fit that cap atomically. Expired/missing conversion review blocks new approval, not recovery of an existing task. Do not reset reservations or increase the EUR total. Refresh evidence in the private policy through a separately reviewed server-side edit; an expired immutable second-test authorization is not rewritten.

## Duration-dependent reviews, not extrapolation

Keep the existing short policy as the root. Add **complete separately reviewed StudioPolicy objects** to optional `durationBands: []`. Each band has its own reviewer/dates, `billingEvidence`, `outputEvidence` and contract. Bands may meet at a boundary but must not overlap otherwise; the shorter band owns a shared endpoint. Actual encoded MP3 duration selects the band, not the browser's rounded selection. Missing coverage fails closed. The 60-second cap applies to measured encoded media; MP3 padding may require a slightly shorter selection.

For an aggregate inclusive band, `contract.pilotAdmission` requires:

- `inclusiveMaxMicroUsd`: separately reviewed inclusive ceiling for that entire band; never inferred from pre-tax price or uplift alone.
- `durationEvidence`: evidence establishing the band's input-to-generated-duration bound. Required above five seconds; no universal one-second padding assumption.
- `maxGeneratedSeconds`: reviewed finite output maximum, at most 300; must also equal `contract.output.maxDurationSeconds`.
- `planningUpliftBasisPoints: 1900`: still only a provisional planning uplift, **not verified BytePlus tax**.
- `evidence`: independent ceiling basis. Unknown tax/fee/minimum components in `billing` remain null; rate stays 70,000 microUSD/generated second.

The contract still needs the explicit `generatedDurationBound` range/evidence, approved exact output hosts, verified codec/FPS/dimensions and an explicitly reviewed duration tolerance. Do not copy the five-second example as proof for 10, 30 or 60 seconds. The blank [duration band template](../config/studio-duration-band.example.json) is intentionally invalid until reviewed; it is not an activation policy.

Longer aggregate bands also need `contract.output.transfer`: `maxBytes`, `timeoutMs`, and `evidence`. These are explicit acceptance/resource bounds, not provider promises. Hard implementation ceilings are **256 MiB** and **180 seconds** per download. Defaults for unchanged policies remain 100 MiB / 120 seconds. FFmpeg decoding remains bounded at 120 seconds, private partial files are removed on failure, and the combined transfer/validation remains within the ten-minute lease. No cookies, redirects, alternate DNS connection, unknown host or private IP is accepted. Oversized/slow/unapproved output remains recoverable on the same task and does not justify another submission.

## Activation checklist and remaining evidence

1. Resolve any still-active/uncertain task before another test. Preserve its full reservation regardless of billing uncertainty.
2. Review or renew EUR conversion/fee terms for the existing EUR 50 total; retain all previous USD reservations.
3. Obtain documented or independently reviewed **generated-duration bounds and inclusive cost bounds for each longer input band**, including tax/fees. USD 0.07/second and a provisional 19% uplift alone do not establish an inclusive ceiling.
4. Review longer-result metadata, exact output hosts, bitrate/file-size/transfer envelope and duration tolerance. A short successful MP4 does not verify long-output behavior. Unknown evidence leaves the band disabled.
5. After separate authorization, update the private policy with reviewed bands and set `BYTEPLUS_STUDIO_MAX_DURATION_SECONDS` to at most `60`; retain explicit per-job and total USD caps. Keep staff allowlist, staging auth, recovery worker and all public-generation/payment gates unchanged. No configuration or deployment was changed by this implementation.
6. In Studio select an excerpt, confirm media rights/English prompt, review the measured duration, inclusive ceiling and remaining EUR/USD allowance, then explicitly confirm one generation. After completion use a new selection or the explicit repeat-review button.
