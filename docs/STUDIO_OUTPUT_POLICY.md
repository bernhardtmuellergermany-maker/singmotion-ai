# SingMotion AI — Private Super Admin Output Policy (draft)

**Status:** DRAFT / NOT AUTHORIZED FOR LIVE PAID SUBMISSIONS. Prepared 5 November 2026.

This policy deliberately separates operator-confirmed facts from unverified provider properties. The adjacent JSON file (`studio-output-policy.draft.json`) is **not** a production policy and **must not** be pasted into `STUDIO_LIVE_POLICY_JSON` or renamed to `studio-live-policy.json`. Nulls and empty hosts are explicit blockers. The server's existing `validateStudioPolicy` should reject it.

## Confirmed and configured

- Provider: BytePlus OmniHuman 2.0.
- Account holder reports USD **0.07 per second of generated video** and **no separately charged tax** (5 November 2026); it is owner-provided evidence, not independently obtained vendor billing documentation.
- In application logic, authenticated Super Admin is not subject to customer credit, subscription or video-count entitlements. Financial accounting and provider task authorization remain separate.
- Private video outputs must be downloaded through an exact HTTPS host allowlist, never following redirects or forwarding credentials. Generated MP4 must have audio/video streams, pass FFprobe and FFmpeg decode, satisfy approved dimensions/codec/FPS/duration and be stored with owner-scoped access.
- A newly submitted provider task must have durable task-ID tracking, one-time authorization, uncertainty-safe recovery, and no automatic resubmission after an ambiguous result.
- Intended per-video media cap is up to 300 seconds; that does not establish the generated-duration and billing envelope for every submitted input.

## Blockers before the draft can become an approved production policy

1. **Output URL host:** recover the hostname from the already authenticated, approved historical BytePlus task output evidence or official provider documentation. Add only that exact host to `contract.outputHosts`. Do not add arbitrary domains or broad wildcards.
2. **Actual MP4 characteristics:** use the validated completed output and recorded review to establish resolution/orientation, video codec, AAC audio codec, and FPS. Never fill these with guessed defaults.
3. **Duration envelope:** establish maximum generated duration for every admitted audio/input duration. The current planned 4–300-second interval is not a verified bound; if only 4–5 seconds is evidenced, authorize only that range.
4. **Billing semantics:** confirm the billable rounding quantum, minimum billable time/charge, separately billed fees (if any), charges for failed jobs, and the no-tax statement for the account. The base rate alone is not a fully bounded per-task charge.
5. **Review provenance:** fill truthful `reviewedBy`, `reviewedAt`, `expiresAt`, `billingEvidence`, `outputEvidence`, and a versioned `revision`. The reviewed contract must satisfy `validateStudioPolicy`. Do not set a distant expiry to skip regular review.
6. **Deployment verification:** after code review/CI, configure the real approved JSON as the server-only variable in Railway or restore the secured volume file. Verify `PRIVATE_STUDIO_CHECK studio-policy READY` and test a single explicitly approved small video through task recovery and download.

## Operator-confirmed example base charges

| Generated video | Base USD |
| --- | ---: |
| 5 seconds | $0.35 |
| 10 seconds | $0.70 |
| 30 seconds | $2.10 |
| 60 seconds | $4.20 |
| 300 seconds | $21.00 |

These examples are not guaranteed invoices until the actual provider's billable duration/rounding rules have been confirmed. This policy changes no Railway credentials, production variables, existing policy file, active jobs or customer billing flags.
