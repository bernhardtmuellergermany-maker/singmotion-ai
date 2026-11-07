# Private Studio review recovery

The Studio compares explicit selection fields, independent of JSON property order.
Its per-tab review receipt binds the plan ID, exact selection, policy digest,
spending ceiling, experimental admission, measured duration, prompt and Terms
version. It is a UI receipt, not a server authorization or reservation.

Returning from a saved project fetches that same project through the authenticated
API. An unchanged receipt restores the English-prompt and paid-cost checkboxes;
rights still require the existing server-confirmed receipt/current Terms. Changed
review terms invalidate paid approval. No request is submitted automatically.
Each disabled Generate condition is listed beside the control. Submission errors
retain the project and revoke the local paid confirmation; server idempotency,
current policy/budget checks and recovery remain authoritative.

## Staging verification after the owner deploys the fix

No new environment variables, migration, budget renewal or ledger reset is
required by this fix. Keep public GENERATIONS_ENABLED=false.

1. Sign in with the existing allowlisted Payload Super Admin; open Studio in the
   same browser/media session.
2. Retain the current inputs. If this is the first visit after updating, click
   **Review real video cost — no paid request** to reload the existing idempotent
   prepared project. Old lost browser confirmations cannot be reconstructed;
   confirm the unchanged review once if necessary.
3. Confirm current rights, English prompt and the displayed cost approval. Open
   **Saved private project**, then return. The plan ID stays the same and Generate
   becomes available if no genuine blockers remain.
4. Inspect **Generate is unavailable** for any remaining readiness, rights,
   selection, budget or approval blocker. Never reset a reservation to resolve it.
5. Click **Generate ONE real video** only when intentionally authorizing a paid
   request. This verification does not require clicking it.

The receipt is limited to the browser tab/session. If browser storage is disabled
or cleared, reload the existing review and explicitly confirm again. Credentials,
media bytes and provider URLs are not stored in the receipt.

Offline regression coverage intercepts every HTTP request: reordered selection
fields, navigation away/back without another prepare, changed ceiling with an
unchanged policy digest, policy-change rejection, and desktop/mobile behavior.
