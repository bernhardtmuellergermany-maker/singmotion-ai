# Payload staging login investigation

## Confirmed findings

The Payload route-group layout was missing `import "@payloadcms/next/css"`. Payload's `RootLayout` does not add this import for the host application. The login HTML could therefore return 200 while the admin had no Payload stylesheet. The layout now imports the package's supported CSS entry point; this remains behind staging Basic Auth and separate from the customer site's styles.

The reported Railway login 403 has **not been uniquely identified** from the status code alone. No Railway requests, configuration changes or database resets were performed. A production-build browser test now reproduces HTTPS termination in front of Next's HTTP listener, with Basic Auth, an exact HTTPS `CMS_ORIGIN`, and Secure/HttpOnly/SameSite=Strict Payload cookies. Valid login, publishing and logout pass in this setup. There is no evidence that bypassing Basic Auth or relaxing CSRF is necessary.

Inspection of the installed Payload version and application hooks establishes:

- The application explicitly returns 403 for a missing or nonmatching Origin on mutations, before invoking Payload. Previously that branch had no server log, explaining why lack of a CSRF log did not rule it out.
- A missing or invalid staging Basic credential returns 401 with `WWW-Authenticate: Basic`. It does not produce the application's origin 403.
- Incorrect Payload credentials and locked accounts return 401 in this Payload version. The normal role/read hooks do not prevent an unauthenticated user from attempting the supported login operation. Roles still control access after authentication. Public provisioning and reset endpoints remain denied.
- Payload's disabled-local-strategy path can return 403, but this application does not enable that option. A downstream 403 must be distinguished from the application's own origin guard before selecting a fix.

The change fixes CSS delivery and the diagnostic gap. It does **not** claim to fix an unobserved Railway-specific origin/account condition. The existing 403 response body (without request headers or credentials), or the new fixed diagnostic code after a separately authorized deployment, is needed to close that investigation.

## Safe diagnostics

Login failures now carry `X-SingMotion-CMS-Code`; application-origin failures also include the code in the JSON response. The application emits a structured `cms_request_rejected` warning containing only the fixed code and numeric status. No emails, passwords, tokens, cookies, URLs, forwarded headers or Origin values are logged.

| Code                  | Meaning / next check                                                                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CMS_ORIGIN_MISSING`  | The mutation reached the app without Origin. Check the browser's actual request and any gateway that removes it. Do not substitute Referer or forwarded headers.             |
| `CMS_ORIGIN_REJECTED` | Origin did not exactly match the runtime `CMS_ORIGIN`. Check scheme, hostname, port and alternate-domain redirects. No trailing slash is permitted in the configured origin. |
| `CMS_AUTH_REJECTED`   | Payload returned 401. Inspect its normal error message for incorrect credentials or lockout; do not repeatedly reset the password or hammer login.                           |
| `CMS_ACCESS_DENIED`   | Payload itself returned 403, after the application's Origin check passed. Inspect the sanitized Payload error and deployed collection configuration.                         |
| `CMS_RATE_LIMITED`    | Login throttling returned 429. Honor Retry-After; do not disable limits.                                                                                                     |

A 401 with a Basic challenge occurs before these codes and requires the staging gate. A 403 without a code can indicate an older build, another explicitly disabled operation, or an upstream response; do not label all 403s as CSRF.

## Exact operator verification (no settings changes required)

1. Confirm the application build/revision under test. Open a fresh private browser window at the exact staging HTTPS domain, `/admin/login`. Do not put passwords in the URL. Complete Railway staging Basic Auth through the browser prompt.
2. Open Developer Tools → Network and disable cache while the panel is open. Reload. `/admin/login` should return 200; its `/_next/static/...css` stylesheet requests should return 200 with `Content-Type: text/css`. The Payload logo, form spacing, fields and button should be styled.
3. Sign in with the existing staff account. Inspect `POST /api/cms/staff/login`: success is 200, then the operations dashboard. The browser should store a `payload-token` cookie with Secure, HttpOnly and SameSite=Strict. Never copy or share its value.
4. If login fails, record **only** the HTTP status, `X-SingMotion-CMS-Code` (if present), and non-sensitive error message. For origin issues, compare the request's Origin locally with the configured exact HTTPS origin; do not share Authorization, Cookie, Set-Cookie, POST body, a HAR export or an unredacted screenshot. Existing builds may only return `{"error":"Invalid origin."}`.
5. After successful login, open an existing page in Payload and confirm the editor works. Logout, then verify the dashboard requires Payload login again. In another fresh browser session without Basic Auth, the admin and its CSS must still require staging authentication.

No deployment is included in this change. Verification of new CSS/diagnostics on Railway requires the owner to separately authorize deployment; the old running build cannot expose the new diagnostics.

## Local regression commands

Use the supported Node version in `package.json`, Chromium, OpenSSL and a **disposable local PostgreSQL database ending in `_test`**. Never set the test URL to staging or production.

```sh
npm run lint
npm run typecheck
npm test
npm run build
# Set CMS_TEST_DATABASE_URL to the disposable local PostgreSQL database.
npm run test:cms
npm run test:cms:browser
npm run test:staging
npm run test:e2e
```

The browser test creates a one-day self-signed loopback certificate and terminates TLS at `https://127.0.0.1:3199`, forwarding to Next on port 3198. Certificate verification is relaxed **only in this loopback test client**, never in application transports. The temporary certificate and test storage are removed afterwards. It checks CSS delivery/application, Basic Auth (including CSS and login), missing/mismatched Origin, wrong passwords, actual browser login, secure session cookies, CMS editing/publishing, previews, logout and isolation from customer media/admin endpoints. `test-results/cms-login-https.png` captures the styled login without credentials.
