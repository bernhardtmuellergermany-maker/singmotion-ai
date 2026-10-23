# Payload administration: private staging preparation

This branch integrates **Payload 3.92.0**, Next.js **16.4.3**, React 19 and Node **24.22.1–24.x**. These versions satisfy Payload's published peer/engine constraints. Docker pins Node 24.22.1. CMS data uses the official PostgreSQL adapter with schema push disabled and a checked-in initial migration. The existing SQLite demo database and private BytePlus operator ledger are not migrated, reset or exposed to Payload. No Railway setting has been changed and nothing has been deployed.

## What works, and what does not

- `/admin`: Payload login/logout, persisted one-hour sessions, HttpOnly SameSite=Strict cookies (Secure except explicitly opted-in loopback tests), five failed attempts/15-minute account lockout. A persistent SQLite global login throttle also limits 100 attempts/15 minutes. All mutating CMS REST requests require the configured exact Origin. Railway Basic Auth still protects every route and asset.
- No public staff registration. Only a super administrator can create subsequent staff. Initial provisioning is a server-only command, transactionally locked, refusing to run once any staff account exists. Staff deletion is disabled to prevent accidental removal of the last administrator. Editor/Support cannot change roles or create staff. Passwords require 20 characters.
- Super Admin: CMS administration and manual support operations. Editor: website content, navigation and public CMS images only. Support: manual support cases and aggregate demo operational counts; no private media, content publishing or financial actions. Customer sessions are separate and never authenticate as Payload staff.
- Pages: Home, Pricing, FAQ, About, Contact, Help, Privacy, Terms, Legal Notice and Rights. Structured hero/text/cards/image/CTA blocks, SEO title/description, drafts/autosave, explicit publishing, private authenticated preview, 30 saved revisions and Payload restore-version workflow. Header/footer links and copyright are editable. Text is escaped, not interpreted as HTML. Links accept only internal paths or HTTPS URLs; scripts and protocol-relative links are rejected.
- Existing design/classes and customer Studio are preserved. Existing marketing copy stays as fallback until a CMS page is published. The optional seed command copies legacy informational text into **drafts**, provides a home draft using existing copy and creates explicit placeholder drafts for new About/FAQ/Pricing pages. It never overwrites existing pages. Review these drafts; this is not a pixel-identical automated home migration. Publish a page to activate CMS rendering and its editable navigation.
- CMS image uploads are explicitly **public website assets**, separate from customer uploads: decoded single-frame JPEG/PNG/WebP only, 5 MiB, 20 million decoded pixels, converted to WebP. SVG, arbitrary HTML/files and private customer media are not supported. Files persist under `DATA_DIR/cms-public`; staging authentication remains in front of their URLs. Published CMS assets will be public if staging protection is ever deliberately removed.
- Audit events record logins and collection/global mutations using actor/action/resource/record IDs, never field content, credentials or URLs. They cannot be edited/deleted through Payload, including by super admins. This is an application audit trail, not externally immutable security logging.
- Dashboard counts are queried from actual persisted anonymous demo workspaces/jobs. Manual moderation/user-report/refund-request cases persist in PostgreSQL. Updating their status does not suspend a customer, issue money, delete private storage or call a provider. Notification templates are editable draft copy with **delivery disabled**.
- **Not connected:** registered customer accounts, suspensions/reactivation, per-customer project/media access, real credits/subscriptions/payments/refunds, revenue/margin accounting, browser BytePlus approval/submission/poll/retrieval, storage cleanup controls, monitoring/alerts and email delivery. No fabricated financial rows. Sensitive settings remain environment-controlled. The existing CLI BytePlus workflow retains all gates; CMS has no provider execution endpoints.
- **Before production:** MFA is not implemented. Keep Basic Auth and private staging. Choose and verify a supported identity-provider/MFA integration or audited Payload auth extension, including session revocation, step-up authentication and recovery, before public admin activation. Password reset email is intentionally disabled (including Payload console email output); a super administrator must reset another staff member's password through Staff. Test password-change session revocation before relying on emergency recovery. External audit retention, backups, legal content, media retention and malware scanning are further production work.

## Exact Railway preparation (manual; not executed)

1. Back up the existing `/app/.data` volume (including SQLite WAL-consistent backups and private snapshots) and the current application image/commit. Do not delete or recreate the volume. Keep its mount at `/app/.data` and the existing privileged ownership initializer/non-root runtime.
2. Add a dedicated Railway PostgreSQL service/database using a supported PostgreSQL release (the migration was tested against disposable local PostgreSQL 18). Do not point Payload at unrelated application tables. Use Railway's private network database URL. Set `CMS_DATABASE_URL` to that service's connection URL using a Railway secret/reference, e.g. `${{Postgres.DATABASE_URL}}` when the service is named `Postgres`. Do not paste it into Git or logs. For external PostgreSQL require verified TLS through its documented connection string; do not disable certificate verification.
3. Configure, **only when separately approving deployment**:

| Variable                               | Value                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------ |
| `CMS_ENABLED`                          | `false` until migration/provisioning; then `true` for private staging    |
| `CMS_DATABASE_URL`                     | Dedicated PostgreSQL connection secret                                   |
| `PAYLOAD_SECRET`                       | Unique random secret, at least 32 characters; persist across deployments |
| `CMS_ORIGIN`                           | Exact `https://...` staging origin, no trailing slash/path               |
| `CMS_LOCAL_TEST`                       | `false` (never enable on Railway)                                        |
| `DATA_DIR`                             | `/app/.data`                                                             |
| `STAGING_AUTH_ENABLED`                 | `true`                                                                   |
| `STAGING_PASSWORD`                     | Existing strong Railway secret                                           |
| `DEMO_MODE`                            | `true`                                                                   |
| `GENERATIONS_ENABLED`                  | `false`                                                                  |
| `ADMIN_DEMO_ENABLED`                   | `false`                                                                  |
| `BYTEPLUS_LIVE_TEST_ENABLED`           | `false`                                                                  |
| `BYTEPLUS_FIRST_TEST_ENABLED`          | `false`                                                                  |
| `BYTEPLUS_FIRST_TEST_DOWNLOAD_ENABLED` | `false`                                                                  |

Use the existing Dockerfile/startup command and volume. Do not expose PostgreSQL publicly for app traffic. No BytePlus/R2/Stripe credentials are needed for CMS. CMS assets use the existing persistent volume, not the private R2 bucket.

4. From an authorized server-side console or an explicitly approved one-off job using this image and database environment, run `npm run cms -- migrate`. Do not run `migrate:fresh`, reset a database or enable schema push. The initial migration creates CMS tables/enums only. No migration runs automatically at web startup. A later Railway pre-deploy migration command may be configured deliberately after backup/rehearsal; it is not configured by this change.
5. Provision the first administrator with temporary secret variables `CMS_ENABLED=true`, `CMS_PROVISION_CONFIRM=create-first-super-admin`, `CMS_INITIAL_ADMIN_EMAIL=<owner-email>`, `CMS_INITIAL_ADMIN_PASSWORD=<unique-random-password-at-least-20-characters>`, alongside the database/secret/origin variables. Run `npm run cms:provision` in that one-off server context. Never put an actual password in command history or commit it. The command refuses a second bootstrap and does not print the credentials. Remove all three provisioning variables immediately afterward.
6. Optional seed: set `CMS_ENABLED=true`, `CMS_SEED_CONFIRM=create-missing-drafts`, then run `npm run cms:seed`. Remove the seed confirmation afterward. The public website is unchanged until an editor explicitly publishes.
7. When deployment is separately approved, enable `CMS_ENABLED=true`. Open the HTTPS `/admin`, pass Railway Basic Auth, then log in using the provisioned staff email/password. Verify cookies are Secure/HttpOnly/SameSite=Strict, staff role boundaries, anonymous registration denial, private draft access, media upload, publishing, revision restore and logout. Keep Basic Auth in place. Everyday editing and staff management now use the browser.

## Database/media rollback

Before each migration, take a PostgreSQL backup and a matching CMS media/volume backup; test restoration into an isolated database. Keep database access least-privileged to the dedicated database. Run a single application instance with this local volume until shared asset storage and distributed throttling are designed.

To roll back the application: disable CMS, restore the previously tested image/commit and leave the PostgreSQL database and volume intact. The older app ignores CMS tables/files. Do **not** run the initial migration's `down` against real content: it drops CMS tables. Restore a matched database/media backup into a separate environment to rehearse schema rollback before using it. Preserve the SQLite operator ledger independently. Coordinate backups with writes; do not copy a live SQLite file without its WAL/checkpoint procedure.

## Tests

`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:staging` and `npm run test:volume` retain the original application checks.

The additional integration suites require a **disposable local PostgreSQL database whose name ends in `_test`**. They create/delete test CMS records, never connect to R2/BytePlus, and reject non-loopback database hosts. The CMS integration suite runs checked-in migrations. The browser suite expects those migrations to have run and a production build. Node must be >=24.22.1; browser tests require Chromium.

```powershell
$env:CMS_TEST_DATABASE_URL = 'postgresql://LOCAL_TEST_USER:LOCAL_TEST_PASSWORD@127.0.0.1:5432/singmotion_cms_test'
npm.cmd run test:cms
npm.cmd run build
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = 'C:\Path\To\chrome.exe'
npm.cmd run test:cms:browser
```

Use disposable local credentials only. Payload background timers require the integration runner's `--test-force-exit`; database teardown is awaited before completion. The browser suite exercises real Payload login/publish/preview over local HTTP with Basic Auth; local-only insecure cookie mode is not a Railway configuration.
