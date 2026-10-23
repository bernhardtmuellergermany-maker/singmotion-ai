# Direct BytePlus OmniHuman 2.0 — documented protocol, blocked live transport

Checked 23 October 2026 against the user-supplied **BytePlus API.txt**, titled **OmniHuman 2.0 API Document**, last updated **October 15, 2026 05:29:58**. This is the model-specific source, not a 1.5 API example. The source supplies no original page URL. No real credentials, provider calls, media uploads to external storage, payments, Railway changes or deployments were used.

Source attachment SHA-256: `7e19bfdf0d852b6c050dbe3af2d8e0422c9e082e1f74a349d37f4e85d85a69c2`.

## Implemented and mock-tested

`lib/live/byteplus.ts` adds the documented protocol to the existing `lib/live/` lifecycle without replacing it. `DocumentedBytePlusProvider` implements the existing `ReviewedProvider` interface. Its default transport is blocked; only tests inject a mock transport. There is no default `fetch`, credential reader, incomplete signer, new public route or public authorization endpoint.

| Item              | Documented behavior implemented                                                                                                                                                                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint/method   | POST `https://cv.byteplusapi.com/`, JSON                                                                                                                                                                                                                                                  |
| Scope identifiers | Service `cv`, region `ap-singapore-1`, version `2024-06-06`                                                                                                                                                                                                                               |
| Model             | `realman_avatar_picture_omni20_cv`                                                                                                                                                                                                                                                        |
| Submission        | Action `CVSync2AsyncSubmitTask`; `req_key`, `audio_url`, `image_urls`, optional `prompt`                                                                                                                                                                                                  |
| Image count       | Exactly one selected reference. An array field alone does not establish multi-reference support.                                                                                                                                                                                          |
| Prompt            | Existing composed English performance/camera prompt passes unchanged. Document also lists Chinese, Japanese, Korean, Mexican Spanish and Indonesian; the existing workflow continues requiring English confirmation.                                                                      |
| Watermark         | Omit `enable_watermark`, preserving the documented enabled default.                                                                                                                                                                                                                       |
| Success           | Check outer numeric `code === 10000` before reading `data`; outer `status` is ignored. Persist `data.task_id` as a string.                                                                                                                                                                |
| Poll              | Action `CVSync2AsyncGetResult`; body `req_key` and `task_id`. `in_queue`/`generating` remain pending; successful `done` requires `video_url`.                                                                                                                                             |
| Terminal states   | `not_found`, `expired`, `canceled` become failed locally. Never follow the source's suggestion to resubmit expired tasks automatically.                                                                                                                                                   |
| Cancellation      | `CVCancelTask` is documented. Explicit protocol method checks `in_queue` first; provider may still reject a race with code 50217. No automatic cancellation or assumed refund. Not exposed to the web UI or live CLI.                                                                     |
| Read failures     | Codes 50429, 50430, 50500 and 50501 are retryable reads. A later explicit `pollOnce` uses the stored task ID; there is no automatic submission retry. Other provider errors fail locally; raw provider messages/URLs are not persisted.                                                   |
| Output            | URL valid for one hour. Existing runner immediately downloads into private storage when polling observes success and validates the MP4 before completion. Expired/invalid downloads fail without resubmission. Task lookup may expire after 12 hours; operators must not defer retrieval. |

Existing one-time approval, immutable media snapshots, atomic spending reservations, task-ID persistence, polling leases, 60-second request timeout, download size/timeout checks and FFmpeg validation remain in place. A submission crash/timeout remains **uncertain**, requiring manual reconciliation; even a documented retryable submission response does not trigger another request. Polling errors retain the task ID. No server-side idempotency field is documented, so none is sent.

## Model limits and application limits

The document allows images in JPEG, PNG, WebP, BMP, TIFF, GIF, HEIC and HEIF; size strictly below 30 MB; dimensions 300–6000 px; width/height ratio 0.4–2.5 inclusive. Audio is WAV or MP3, strictly below 15 MB, duration 4–300 seconds inclusive. `lib/live/limits.ts` tests the model boundaries. Decimal MB is a conservative local interpretation because the document does not define the unit precisely.

The existing application/preflight remains a narrower supported subset: one still JPEG/PNG at most 4096×4096, and an actually encoded MP3 excerpt. It now also checks minimum dimensions/aspect ratio, strict decimal byte limits and actual encoded duration against model limits, including after approval. No UI format support was silently expanded. Codec padding can make a nominal ten-second clip exceed a strict ten-second test cap; select a shorter clip rather than relaxing the cap. The existing 1,500-character prompt limit is an application limit, not a documented BytePlus maximum. Animation/frame selection behavior is not specified by this document.

## Critical missing documentation — live calls remain blocked

1. **Complete signing:** the model page gives the Authorization header shape `HMAC-SHA256 Credential={AccessKeyId}/{ShortDate}/{Region}/{Service}/request, SignedHeaders={SignedHeaders}, Signature={Signature}`. It does **not** define canonical URI/query encoding, header normalization/selection, timestamp headers/format, payload hash, string-to-sign, signing-key derivation, clock skew or official signature test vectors. Supply the linked **Common Parameters → Authentication Parameters → in header** and **HTTP Request Sample** (or the linked official SDK signing implementation/examples). No AWS-style algorithm or key prefix has been guessed.
2. **Billing:** the attachment contains no price, minimum billable duration, rounding quantum, minimum charge, tax, fees, or failed/canceled/timeout-task charging rules. The four-second input minimum is **not** a billing minimum. The earlier reported USD 0.07/s is not a verified account quote. Obtain account-specific terms and a conservative inclusive upper bound before authorization. No charge estimate is currently produced.
3. **Input delivery:** URL fields are documented, but allowed origins, redirects, fetch timing/retries, maximum queue delay and required URL lifetime are not. `PrivateInputDelivery` is an interface, not a deployed storage implementation. Its adapter checks owner/hash binding, HTTPS exact-host allowlisting and expiry before submission; it cannot prove that an arbitrary URL represents a private signed object. A reviewed private object-storage implementation must upload the approved snapshots and issue short-lived, object-scoped GET capabilities, with cleanup/revocation and sufficient lifetime. No upload is made publicly readable, and no staging/session gate is bypassed. Do not pass a Basic-auth or cookie-protected application asset URL, and never send the staging password to BytePlus.
4. **Output constraints:** actual output domains, resolution, frame rate, codec/duration guarantees and whether re-polling refreshes an expired URL are absent. Keep the existing downloader's host allowlist closed and its contract unset until verified. Existing 720p/25 FPS fixture validation is not new evidence of a model guarantee. Do not wildcard-allow arbitrary provider URL hosts.
5. **Common errors and permissions:** the linked Common Responses and Error Codes page and exact least-privilege IAM permissions are not included. Account activation is user-reported; mocks cannot verify entitlement, signatures or live behavior. Callback fields appear only in commented examples; no webhook endpoint is added.

`bytePlusVerification.verified` remains false and its blockers now reflect these specific gaps. `assertBytePlusVerified()` still blocks the live-test command regardless of environment settings. The customer demo worker does not import the new adapter. Stripe and fal.ai remain untouched/disabled.

## Configuration and a future explicitly approved single test

Use the existing `.env.byteplus.example` for a **separate server-side operator process**, never the Railway web process. Keep real values only in ignored local configuration or a secret manager. No AK/SK is needed for tests.

| Variable                                  | Safe default / purpose                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `DEMO_MODE`                               | `true`; a future reviewed isolated operator process would require `false`, while the web app remains `true` |
| `DATA_DIR`                                | Same persistent private store holding owned media and spending reservations                                 |
| `BYTEPLUS_LIVE_TEST_ENABLED`              | `false`                                                                                                     |
| `BYTEPLUS_LIVE_TEST_OPERATOR_SECRET`      | Empty; future independent operator authorization secret, at least 32 random characters                      |
| `BYTEPLUS_LIVE_TEST_MAX_JOB_MICRO_USD`    | `0`; future explicitly approved inclusive per-job cap                                                       |
| `BYTEPLUS_LIVE_TEST_MAX_TOTAL_MICRO_USD`  | `0`; cumulative reservation cap, including uncertain/failed attempts                                        |
| `BYTEPLUS_LIVE_TEST_MAX_DURATION_SECONDS` | `10`; choose one excerpt at least 4 seconds and below this cap after MP3 encoding                           |
| `BYTEPLUS_ACCESS_KEY_ID`                  | Reserved server-side AK configuration name; blank, not read by any transport yet                            |
| `BYTEPLUS_SECRET_ACCESS_KEY`              | Reserved server-side SK configuration name; blank, not read by any transport yet                            |

These credential names are application choices, not claims about SDK environment conventions. There is no complete runnable live-test configuration yet: input-storage settings and a verified signing transport cannot be invented from this attachment. Model endpoint/scope constants are fixed in source; no endpoint override is exposed. Railway keeps `DEMO_MODE=true`, `GENERATIONS_ENABLED=false`, `ADMIN_DEMO_ENABLED=false`, `BYTEPLUS_LIVE_TEST_ENABLED=false` and all staging authentication settings unchanged.

Safe future procedure (not executable or authorized in this change):

1. Obtain the missing signing, billing, URL-delivery and output documents. Implement/review those adapters with official signature fixtures and mocked storage. Keep the live gate closed until all checks pass.
2. Prepare an existing owned project's chosen image and trimmed excerpt using `npm run byteplus:preflight -- --job <id> --owner <owner-id> --confirm-english`. This remains offline. Review immutable hashes, measured duration and exact composed prompt.
3. Calculate a verified inclusive duration-based upper bound. Set both caps to no more than the separately approved amount; one USD is 1,000,000 micro-USD. Do not delete the persistent spending database to reset reservations.
4. Obtain explicit approval for that one plan. The future operator command must authenticate server-side and require the existing exact confirmation phrase `AUTHORIZE ONE PAID BYTEPLUS TEST <plan-id> UP TO <amount> MICROUSD`. It consumes the short-lived one-time token once and atomically reserves spend before submission.
5. Submit once, persist the task ID, then poll that ID only. On uncertainty, stop and reconcile through BytePlus; do not resubmit. Download promptly, validate and save privately. Retain reservations until actual billing is reconciled; cancellation is not a refund promise.
6. Turn the isolated operator switch off afterward. Never change staging flags or enable Stripe to run this test.

## Verification scope

All BytePlus protocol responses, input URL leases and provider output HTTP responses in tests are mocked. Tests include successful completion through the existing durable runner, provider error redaction, all documented task statuses, queued cancellation/races, single submission, cross-owner/expired/changed input leases, expired output URLs, model boundaries and default transport denial. Existing tests cover cost limits, unauthorized operators, output validation, polling leases/timeouts, failed jobs, session ownership and staging authentication. Local FFmpeg operates only on synthetic fixtures.

This change implements the documented model protocol, **not a completed or live-verified paid integration**. Missing prerequisites are deliberately visible rather than replaced with guessed behavior.

Validation for this branch: lint, typecheck, all 39 automated tests, production build, production staging security checks and all six desktop/mobile Playwright tests passed. Provider traffic was mocked; staging checks used isolated local storage. No live signature or account validation was performed.
