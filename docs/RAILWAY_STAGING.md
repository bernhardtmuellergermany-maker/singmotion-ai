# Private Railway staging

The staging gate uses HTTP Basic authentication (browser password dialog), with fixed username **staging**. All pages, API methods, public files, private uploads/downloads, image optimization, Next static files and RSC requests require the password. Existing per-session ownership and CSRF checks remain in place. There is no unauthenticated health endpoint. Staging responses are private/no-store and pages are marked noindex. Use HTTPS only; Basic credentials are encoded, not encrypted independently of TLS. A shared staging password is not a replacement for production user accounts.

## Variables to configure manually in Railway

Set these under the existing service's Variables tab, not in source files, Docker build arguments or public (`NEXT_PUBLIC_*`) variables. Use Railway's sealed-secret option for the password if available. Do not paste credentials into issues, PRs or logs.

| Variable                                 | Value                                                                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `STAGING_AUTH_ENABLED`                   | `true`                                                                                                                                 |
| `STAGING_PASSWORD`                       | A newly generated random password, at least 32 characters; use a password manager. No default password exists.                         |
| `NODE_ENV`                               | `production`                                                                                                                           |
| `DEMO_MODE`                              | `true`                                                                                                                                 |
| `GENERATIONS_ENABLED`                    | `false`                                                                                                                                |
| `ADMIN_DEMO_ENABLED`                     | `false`                                                                                                                                |
| `BYTEPLUS_LIVE_TEST_ENABLED`             | `false`                                                                                                                                |
| `BYTEPLUS_LIVE_TEST_MAX_JOB_MICRO_USD`   | `0`                                                                                                                                    |
| `BYTEPLUS_LIVE_TEST_MAX_TOTAL_MICRO_USD` | `0`                                                                                                                                    |
| `DATA_DIR`                               | `/app/.data`                                                                                                                           |
| `APP_ORIGIN`                             | The exact HTTPS origin of your existing Railway preview, e.g. `https://YOUR-SERVICE.up.railway.app`, without a trailing slash or path. |
| `PORT`                                   | Keep Railway's injected value; the launcher reads it (fallback 3000). Match the service's target port if explicitly configured.        |

Leave `ADMIN_DEMO_ACCESS_KEY`, `BYTEPLUS_LIVE_TEST_OPERATOR_SECRET`, all BytePlus/fal.ai credentials and Stripe keys unset. No paid service credentials are necessary. Never prefix secrets with `NEXT_PUBLIC_`. `.env*` files are Git-ignored except the empty example templates and are excluded from the Docker build context.

On Railway (`RAILWAY_ENVIRONMENT_ID` present), authentication cannot be disabled with `STAGING_AUTH_ENABLED=false`. Production also defaults to authentication. Missing/short passwords or unsafe generation/admin/demo flags fail startup, and requests fail closed with 503 if started directly through Next. Rotate the password in Railway to revoke access; browsers may keep Basic credentials until closed. Share the password only with intended reviewers. Use a strong random password; this shared gate does not provide individual accounts or distributed brute-force throttling.

## Service settings

- Build with the repository `Dockerfile`. Keep the start-command override empty so the Docker CMD runs `node scripts/serve.mjs`. Running only `next start` would omit the worker and storage preflight.
- Keep the existing persistent volume mounted at `/app/.data`. Use **one replica** because the demo uses local SQLite and files. Do not add another independent worker service sharing this volume.
- Leave the Railway HTTP health-check path **unset**. An unauthenticated health check receives 401 by design. Verify application health through authenticated requests and the startup logs below. No route is exempted to satisfy a health probe.
- Keep HTTPS enabled on the existing preview domain. Do not add public domains, disable the password, or connect paid services. Avoid additional proxy/CDN caches; never cache authenticated responses publicly.
- Review and merge the feature branch before you manually release it to the existing staging service. These changes do not alter Railway settings or trigger deployment themselves. Check your existing GitHub auto-deploy policy before merging; a main-branch merge can trigger Railway if you have enabled that policy.

## Persistent volume and non-root execution

The image uses `USER node` (UID/GID **1000:1000**). It creates `/app/.data` owned by that user in the image. **A mounted Railway volume replaces that directory's ownership; the Dockerfile's chown cannot fix an existing mounted volume.** The mounted root, `media/`, database files, WAL/SHM files, heartbeat and existing media must be writable by UID 1000. Do not use world-writable permissions or run the web/worker as root to hide permission failures.

The launcher creates, writes, reads back and deletes a private temporary probe in both the volume root and `media/` before starting either child. A failure stops startup with the path and effective UID, without dumping secrets. SQLite subsequently checks access to existing databases when the worker opens them. If the existing volume is root-owned, have an authorized Railway administrator initialize/repair its ownership to 1000:1000 while the application is stopped, preserving all existing data and backups. That one-time storage operation may require elevated privileges; it is not performed by this application. The mounted volume's actual ownership must be checked in your Railway environment before considering deployment verified.

## Startup and acceptance checks

Expected service logs include `Persistent storage ready (UID 1000).`, Next's ready message and `SingMotion demo worker ready. Paid providers are disabled.` The worker updates `/app/.data/worker-heartbeat` even with generation disabled. It does not claim or process queued jobs while `GENERATIONS_ENABLED=false`. Existing completed projects and downloads remain accessible to their owning browser session. New generation requests return 503. Web/worker spawn errors or unexpected exits terminate the launcher; Railway can restart the service using its restart policy.

After you manually release the reviewed change:

1. In a private browser window, open the preview. The browser must ask for credentials before showing any application page. Sign in as `staging` with the configured password.
2. Inspect desktop/mobile layouts, upload a song/image, edit the waveform, and view existing projects. Generation and admin access must remain disabled. Project ownership still depends on the existing `sm_session` cookie; another browser does not automatically own your earlier projects.
3. In a separate unauthenticated client, verify `/studio`, `/api/session`, `/media/demo.mp4`, and a copied Next static asset URL all return 401. POST uploads, HEAD and Range downloads also require credentials. Do not put passwords in URLs.
4. Confirm the logs above and a fresh heartbeat. Confirm persisted data survives a manual service restart. Validate your backup/restore process separately.

## Repository verification

Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:staging`. The staging test starts the production launcher with a random ephemeral password and isolated storage, tests unauthorized methods/routes, real static assets, authenticated MP4 range downloads, sessions, secure cookies, CSRF, generation disabling and the worker heartbeat. It never accesses paid services. The ordinary desktop/mobile Playwright suite explicitly disables the staging gate and enables **demo** generation in isolated local test storage to verify the original workflow.

For trusted local development only, `STAGING_AUTH_ENABLED=false` and `GENERATIONS_ENABLED=true` restore the original demo workflow. Never use those overrides for Railway staging.

Verification in the Codex workspace does not establish the state of your running Railway service. No Railway settings, volume contents, deployment or paid services have been changed by this work.

### Results from this change

- Lint, TypeScript checking, all 31 automated tests, production build, and all six desktop/mobile Playwright tests passed.
- `test:staging` passed in the workspace and inside `node:24-bookworm-slim` as UID 1000, with the built application mounted read-only, a separate writable bind mount at `/app/.data`, and external networking disabled. Both Next and the worker started, and mounted storage supported the database, heartbeat and read/write probes.
- The complete Dockerfile build was attempted but blocked by dependency DNS failures in this Cloud Docker build network (`deb.debian.org` / proxy resolution). The base-image startup test does not verify installation of FFmpeg in the final image. The workspace FFmpeg tests passed.
- The live Railway service, its volume ownership, HTTPS routing, environment variables and restart persistence were not accessed or changed. Confirm them using the acceptance checklist above after your manual release.
