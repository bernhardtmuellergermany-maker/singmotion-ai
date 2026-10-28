# Rest-work validation — 27 October 2026

Base: `c2a13a4ce7ad61f20ecaa41d7ccf4d947617124b`, the verified head of existing draft PR #2. Implementation details and all 19 requirement sections are reconciled in [PRODUCT_REBUILD.md](PRODUCT_REBUILD.md).

Implementation commit: `2c83234` (`feat(studio): complete private four-step workflow and independent generation recovery`).

## Environment and results

Tests used Node 24.22.1, installed dependencies from the unchanged lockfile, system Chromium, FFmpeg and an isolated local PostgreSQL instance. All uploaded media, accounts, databases and test financial records were synthetic and disposable. No production database, Railway configuration, paid BytePlus request or payment was used.

| Command                    | Result                                                                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`        | Passed                                                                                                                                                           |
| `npm run lint`             | Passed                                                                                                                                                           |
| `npm test`                 | 233 passed, 0 failed, 0 skipped                                                                                                                                  |
| `npm run build`            | Passed production Next.js build                                                                                                                                  |
| `npm run test:e2e`         | 7 passed: product flow across five widths plus desktop/mobile API security                                                                                       |
| `npm run test:cms`         | 9 passed with real local PostgreSQL, including additive migrations, roles and Studio settings                                                                    |
| `npm run test:cms:browser` | Passed real HTTPS Payload login, editor operator login, customer/operator separation, origin/CSRF, secure cookies, publishing/preview and legacy admin isolation |
| `npm run test:staging`     | Passed auth, static/media/range, API, secure cookies, CSRF, disabled generation and worker heartbeat                                                             |

The CMS browser harness supplies the trusted Origin when making non-browser cookie requests, as required by Payload's CSRF validation. An initial missing-Origin test call was corrected; server security was not weakened. Stale tests asserting removed cumulative caps and obsolete three-step selectors were replaced with assertions for independent private jobs and the current four-step flow. Provider calls remain mocked/intercepted, including the Generate confirmation test.

Coverage includes exact-request idempotency, separate requests for identical media, atomic submission/recovery leases, known rejected-recording evidence versus unknown historical identity, historical financial records, incomplete saved drafts, private draft ownership, EXIF orientation and manual/automatic format persistence. Existing offline media tests retain 0.9× audio processing, original-speed restoration, synchronization, MP4 validation, private downloads and provider-task recovery coverage.

## Browser evidence

The product suite captures `home`, `audio`, `format`, `review` and `confirmation` screenshots at 1440, 1024, 768, 390 and 360 pixels. Artifacts are saved outside the repository at `/workspace/singmotion-artifacts/screenshots/`. Synthetic images appear as plain colored rectangles; they are not missing production artwork. Axe checks in the product suite report no detected violations; this does not replace a full manual accessibility audit.

The confirmation screenshots show an intercepted offline plan. Its reservation and durations are test data, not a new provider quotation or invoice. No paid submit was sent.

## Performance evidence and limits

A reproducible esbuild minified comparison of the Studio wizard with external packages yielded 24,608 bytes / 8,727 gzip at the base versus 28,588 bytes / 9,941 gzip after the new features: **+1,214 gzip bytes**. This is a module comparison, not the full Next.js route payload. Waveform peak rendering is memoized and bounded (160 × zoom, maximum 2,048 decoded peaks), the waveform stays lazy-loaded, and project polling is non-overlapping and pauses in hidden tabs. No Lighthouse score or production latency claim is made.

## Database and deployment limits

The only new PostgreSQL migration adds `studio_settings` for introductory copy and validated prompt/camera templates. It ran only against the disposable local test database. Generated Payload types and the additive Drizzle snapshot are included. Existing SQLite schemas, historical projects, costs, reservations and media are retained. The admin ledger view opens the existing database read-only.

Live Railway connectivity/configuration, live provider availability, real generated output and final invoices were not tested. Paid generation and production deployment were explicitly prohibited. Task `752756881` and the Schiller video were not touched. Customer paid dispatch and real payment/email/invoice/refund integrations remain disabled future work; full German localization is not complete. Follow the later-rollout configuration notes in PRODUCT_REBUILD.md; no deployment or migration has been performed on Railway.
