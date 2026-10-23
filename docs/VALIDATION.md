# Validation record — 22 October 2026

Verified in this cloud machine using Node 24.19.0, FFmpeg 7.1.5, Next.js 16.4.2 and system Chromium. No deployment, paid provider request, or live payment was made.

| Check                                            | Actual result                                                                           |
| ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Frozen dependency installation (`npm ci`)        | Passed                                                                                  |
| ESLint (`npm run lint`)                          | Passed, no warnings                                                                     |
| Strict TypeScript (`npm run typecheck`)          | Passed                                                                                  |
| Node unit/integration tests (`npm test`)         | **13 passed**, 0 failed, 0 skipped                                                      |
| Production build (`npm run build`)               | Passed                                                                                  |
| Playwright (`npm run test:e2e`, system Chromium) | **4 passed**, 0 failed, 0 skipped: full workflow + API boundaries on desktop and mobile |
| Source formatting (`npm run format:check`)       | Passed                                                                                  |
| Current-instance dev startup + separate worker   | Passed                                                                                  |
| Functional startup check (`npm run smoke`)       | Passed: studio HTML, private session, server quote, fresh worker heartbeat, cleanup     |

The automated audio test creates a 12-second WAV with a silent lead-in, selects 3–8.25 seconds, converts it to MP3, checks its codec, measures its duration within encoder-padding tolerance, and checks signal energy at the start to prove the selection offset was applied. Invalid audio and out-of-range selections are rejected.

Unit/integration tests exercise pricing including fractional durations and rounding, selection constraints, file limits, explicit custom-prompt replacement, job state transitions, credential-free paid API isolation, administrator role/MFA requirements, hashed sessions, cross-user ownership, atomic duplicate prevention, insufficient balances, concurrency limits, one-time technical-failure restoration, capture, queued cancellation, and rate limiting.

Browser tests execute real upload, waveform keyboard/numeric editing and selected playback, artist creation, composed-prompt preview, quoted-price consent, demo submission, worker processing, sample video playback, actual download, save and reload, artist renaming, a second reference with a view label, account/data deletion, and starting a fresh session. They assert no page errors and no horizontal overflow. API tests check unauthenticated access, exact-origin protection, invalid media content, private asset ownership, mandatory consent, and production admin denial.

Initial browser tests exposed an internal-bind-address mismatch in the Origin check and CSS width leaking from hidden file inputs. Both were corrected and the complete affected suites passed. A prompt assertion was narrowed to the actual preview because the same text correctly appeared in the textarea too. Deletion also resets the cached demo session promise so a fresh workspace works without a manual browser reload.

The Playwright-managed Chromium download was denied by the network allowlist. The existing `/usr/bin/chromium` was used successfully; TLS verification and network policy were not weakened.

## Not established by these tests

- A live BytePlus or fal.ai API contract, generated singing quality, identity consistency, provider billing or live output retrieval.
- Supabase authentication, actual PostgreSQL migration execution/RLS, R2 storage/signatures, Stripe event processing, or production financial correctness.
- Actual mobile Safari or physical-device behavior; the mobile run emulates an iPhone-sized touch viewport using Chromium.
- Lighthouse/Core Web Vitals under representative production conditions, large-file load testing, security audit or legal compliance.
- Docker image execution, Railway deployment, public operation, published cloud snapshot, or restoration in a fresh cloud task.

The saved environment draft contains installation and startup instructions. Saving does not publish the environment or deploy the application.

## Empty-waveform hydration fix

The 66 placeholder bars now use rounded whole-pixel CSS strings in both server and client renders. SSR remains enabled for the studio and placeholder; no hydration warning suppression was introduced.

A new browser regression test failed against the original unrounded styles, then passed with the fix on desktop and mobile. It compares the server HTML with hydration, checks the CSS values after client-side navigation, and records hydration diagnostics and page errors. Validation passed: ESLint, strict type checking, all 13 unit/integration tests, all 6 browser tests, and the production build.

A separate development-mode Chromium audit visited `/studio`, `/`, `/projects`, `/artists`, `/billing`, `/settings`, and `/admin` at desktop and mobile widths; it reported no hydration warnings or page errors. The source audit found that the logo already uses integer heights, browser preferences and project dates render after mount, and the footer year is server-only. The interactive audio waveform is already client-loaded after upload; its percentage styles do not participate in the initial server hydration. No changes to these other components were required.

## BytePlus offline preparation — 23 October 2026

Passed lint, strict type checking, production build, all **28 unit/integration tests**, and all **6 desktop/mobile browser tests**. The 15 added tests cover default demo isolation, fail-closed unverified contracts, operator secrets, exact confirmation and token expiry, inclusive cost bounds, cross-connection total caps, immutable/idempotent plans, persisted provider IDs and single submission, uncertain outcomes, polling recovery/leases, media hashes and English confirmation, unsupported prompts/stale costs, output URL constraints, streamed download/redirect/size checks, full MP4 decode validation, offline CLI preparation with real FFmpeg, account cleanup, and request timeouts.

All provider responses and billing terms in these tests are **fictional fixtures**. The downloader test replaces `fetch`; no output was downloaded from BytePlus. The preflight CLI was executed against owned synthetic assets. The live-test command was tested with enable flags set and still refused submission. No paid request, actual provider poll, credential provisioning, migration to production storage, deployment or Stripe activation occurred.

Official documentation retrieval was blocked by the environment's egress proxy (HTTP 403). Public BytePlus SDK sources were inspected but did not verify an OmniHuman 2.0 contract. Endpoint/authentication/schema, input delivery, actual price/minimum charges and output hosts remain unverified; the adapter is still disabled. See `docs/PROVIDER_VERIFICATION.md` for the evidence and account checklist.
