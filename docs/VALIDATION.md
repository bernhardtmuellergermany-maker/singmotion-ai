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
