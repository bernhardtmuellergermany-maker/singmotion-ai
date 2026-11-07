# Shared website and Studio design system

The homepage uses an overlay header with a white logo, Sign in and Open studio, editable HTML headline and CTAs, and the supplied concert concept as its main visual. Informational links previously configured in the header move to the footer without losing their labels or destinations. The header's `/studio` link remains editable in Site navigation. Sign in links to the existing account-information page; customer authentication is not connected.

The supplied concert artwork was adapted to remove the play icon, HD badge and unverified result caption. It is an illustration of the intended product, not a validated SingMotion output. A permanent HTML caption makes that distinction explicit. No video or Watch demo action is added. The hero is a full-width background starting at the top of the viewport behind the transparent homepage header. Desktop uses a right-aligned cinematic crop with a dark gradient under real HTML copy; phones show the complete artwork below the copy in the same dark hero so embedded highlights remain legible. There is no separate rounded artwork card or duplicate overlay. The bundled PNG preserves the reference's resolution; its approximately 2.2 MiB transfer is a remaining performance consideration. Future B-roll and multi-scene features remain labeled unavailable.

Studio begins directly below its existing navigation. Numbered Music, Artist and Performance & camera cards remain visible on every screen size; the introductory headline, progress bar and next/back wizard controls are removed. Uploads collapse to a compact file row. Remove song clears only the current draft selection, not stored media. Precise waveform handles, timestamps, keyboard/touch trimming, playback and preview remain intact. Current performance/camera directions are summarized; all optional presets and custom prompts live in Advanced settings. Custom prompts still replace preset directions.

The desktop summary is sticky. On phones it follows the editor in normal document flow, with duration, simulated price, consent, generation and export, so a floating action cannot cover waveform controls. Demo labeling, existing credit quotes and generation gates are unchanged. No fictional artists are inserted into customer records.

## Replace hero artwork through Payload

No new database fields or migration are required. The existing **Image / homepage hero artwork** block provides the upload relationship and editable caption. Its image's alt text comes from CMS Assets.

1. Upload the bundled `public/artwork/singmotion-concert-concept.png`, or another approved marketing image, to **CMS Assets**. Never upload private customer/provider inputs there.
2. Edit **Pages → Home**. Put the Image block immediately after Hero, or immediately after the secondary CTA that follows Hero. Choose the uploaded asset and enter an optional caption.
3. Use private preview. The image appears in the hero rather than a duplicate section. Review the real HTML headline, CTA and mobile layout, then publish deliberately.
4. Replacing the Image block's relationship replaces the artwork. Versions, drafts, preview and restoration continue to use Payload's existing permission checks.

Published records are never overwritten. Existing Hero + CTA layouts remain supported. If no adjacent Image block exists, the bundled concept is the fallback. `cms:seed` uploads the bundled artwork and references it only when creating a **missing** Home draft; it skips existing Home records. No seed script runs during deployment. The local browser regression uploads an asset to a disposable CMS database and verifies the published hero actually fetches it through the protected CMS asset route.

## Studio HTTPS origin fix

The old API guard used `APP_ORIGIN`, otherwise the internal request protocol plus Host. Behind TLS termination that could compare an HTTPS browser Origin against an HTTP internal origin. A correct `CMS_ORIGIN` did not help Studio because the two checks were separate.

`lib/request-origin.ts` now uses the exact server-configured `APP_ORIGIN`, or `CMS_ORIGIN` when CMS is enabled. It validates the configured origin and never authorizes a request from forwarded headers. Staging without a valid configured public origin fails closed with 503. Missing/mismatched request Origin still returns 403; authentication and ownership checks remain unchanged. Direct non-staging development retains the existing same-host fallback.

An explicit but incorrect `APP_ORIGIN` still takes precedence and must be corrected by the operator; the code does not silently override it. This addresses the internal HTTP fallback, not every possible configuration error. Railway itself was not accessed or modified. Payload login uses its separate strict guard and diagnostics documented in `CMS_LOGIN_TROUBLESHOOTING.md`.

## Manual staging review after a separately authorized deployment

- Review the feature branch / draft PR. This change does not merge or deploy it.
- Confirm `APP_ORIGIN` is the exact external HTTPS origin, without a trailing slash/path. If it is unset and CMS is enabled, the existing exact `CMS_ORIGIN` supplies it. If CMS is disabled, staging needs `APP_ORIGIN`. Do not change these to an internal HTTP host or trust arbitrary request headers.
- Preserve Basic Auth and `DEMO_MODE=true`, `GENERATIONS_ENABLED=false`, `ADMIN_DEMO_ENABLED=false`; leave all provider/live-test gates disabled.
- Publish desired homepage copy and the hero Image block using Payload as above. Existing content will otherwise continue to render unchanged. No database reset/migration is needed.
- In a fresh browser session, authenticate with Basic Auth, open `/studio`, confirm credits/session load and no origin error. Test a permitted song upload, exact selection, artist choice and draft export. Public generation remains disabled on staging.
- Check homepage and Studio at desktop and mobile widths, CMS preview/publishing, protected media and admin login. Never perform a paid generation as a design check.

## Local validation

Use the supported Node version in `package.json`. Run lint, typecheck, `npm test`, production build, `npm run test:e2e`, the separate `playwright.offline.config.ts` suite, and `npm run test:staging`. CMS tests need a disposable **local** PostgreSQL database ending in `_test`: set `CMS_TEST_DATABASE_URL`, then run `npm run test:cms` and `npm run test:cms:browser`. Never use staging data for tests.

Browser checks cover responsive widths 320–1440px, axe WCAG A/AA checks, numeric/mouse/touch/keyboard waveform editing, upload/remove/replace, private demo result and download, offline export, published CMS artwork and HTML content, and real HTTPS → HTTP proxy login/Studio session behavior with Basic Auth and no APP_ORIGIN. Automated accessibility tests supplement manual screenshot inspection; they are not a complete conformance audit.

## Shared layout and page coverage

`SiteHeader` and `SiteFooter` provide the common geometry. `app/(site)/system.css` defines logo size, header height, gutters, surfaces and breakpoints. The application uses one navigation shell for Studio, Projects (including project detail), Artists, Billing and Settings. At widths below 960px the application navigation moves to a second row, while the brand stays at exactly the same coordinates as the public header.

Help, sign-in information (`/signin`), signup information, legal pages and all published CMS pages render through the shared Website component. Pricing, FAQ and About now have honest demo-only fallbacks when no CMS record has been published; published CMS records always take precedence. No migration or automatic publishing occurs. Customer authentication is still not connected; these account-information pages do not pretend to provide a working login. Payload's own admin layout and styles remain separate.

The browser consistency matrix visits 17 pages at 1440, 1024, 768, 390 and 360px. It checks HTTP success, identical brand bounds, horizontal overflow and axe WCAG A/AA rules, and saves actual full-page screenshots. Run:

```sh
npm run build
npx playwright test tests/e2e/consistency.spec.ts --project=desktop
```

Use `DESIGN_SCREENSHOTS_DIR` to choose the screenshot directory. The separate existing mobile tests retain real touch waveform coverage. All screenshots use disposable local demo data; no customer records or paid services are needed. The public site and application no longer use the old sidebar layout. Payload admin intentionally retains its own interface.

## Railway Studio origin verification

The specific `Request origin is not allowed.` response is emitted only when the browser Origin differs from the resolved server origin (or is missing). `APP_ORIGIN` takes precedence over `CMS_ORIGIN`; a stale localhost or other hostname therefore causes 403 even with a correct CMS setting. This configuration scenario is reproduced by the focused regression; the deployed Railway variables have not been inspected or modified.

For this staging service, the operator must verify `APP_ORIGIN=https://singmotion-ai-staging.up.railway.app` (no trailing slash/path). Keep `CMS_ORIGIN` equal to that exact origin. Alternatively, leaving APP_ORIGIN unset uses CMS_ORIGIN when CMS_ENABLED=true. No code accepts arbitrary forwarded headers, a second origin, or missing Origin. After an independently authorized restart/deploy, open that exact HTTPS address, authenticate with Basic Auth, and verify POST /api/session returns 200 and uploads work. A different or missing Origin must still return 403. If the values already match, inspect the failed request's Origin and deployed commit; do not disable CSRF or add an allow-all workaround.
