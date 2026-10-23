# Website and Studio design review

The homepage and Studio share the indigo palette, restrained typography, visible keyboard focus and reduced-motion support. Studio uses Music → Artist → Create, with a wide waveform and sticky desktop summary. Mobile shows one step at a time. The selected artist is a compact private reference, never a simulated video. Camera direction and custom prompts are optional advanced controls; choosing Custom opens those controls. Closing the artist picker restores focus to the artist button.

## Payload editing

The website still renders published Payload page blocks and navigation globals. Hero copy, buttons, sections, cards and CMS images remain editable; previews, drafts, revisions and publishing use the existing authorization. On Home, a CTA block immediately following the hero becomes its secondary action. Other CTAs remain standalone sections. `cms/home-page.ts` supplies fallback content and the initial **missing-page** seed; seeding never overwrites existing pages. Existing published home copy therefore requires a deliberate editor update to adopt the new headline and copy. No schema migration is needed.

The hero graphic is explicitly an editorial concept illustration, not a generated example. The comparison section reserves space for validated SingMotion output; it deliberately has no fabricated before/after player. Genuine performance videos and a validated publishing workflow for those examples remain future work. Cinematic B-roll and multi-scene production remain labeled unavailable. Availability and demo warnings are application safety labels, not marketing claims editable through CMS.

## Verification

Use the supported Node version in `package.json`. Run:

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npx playwright test --config=playwright.offline.config.ts
npm run test:staging
```

Browser tests require Chromium (or `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`). The redesign suite checks WCAG A/AA with axe, 320–1440px homepage overflow, exact numeric waveform edits, desktop mouse dragging, mobile touch dragging, compact selected images and optional prompts. Existing browser tests exercise private demo generation, project saving, download, hydration and disabled-generation offline export. Automated accessibility checks supplement visual inspection; they do not establish complete accessibility conformance.

For Payload regressions, set `CMS_TEST_DATABASE_URL` to a **disposable local PostgreSQL database ending in `_test`**, then run `npm run test:cms` and `npm run test:cms:browser`. These cover permissions, publishing, revisions, uploads, login, preview, malicious text escaping and rendering of customized published home blocks. Never point tests at staging or production data.

Set `DESIGN_SCREENSHOTS_DIR` to capture rendered desktop/mobile review images. Screenshots use a generated test tone and an explicitly illustrated test reference, not customer media. Before/after artifacts are attached to the development review rather than stored as production assets.

This change does not alter provider transports, billing gates, database schemas, administrator recovery, private media access or deployment settings. Local demo tests use isolated temporary storage; no BytePlus or R2 requests are needed.
