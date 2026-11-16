# HiDrive Railway cloud-only OAuth bootstrap — 2026-11-16

**Status:** new dedicated `singmotion-backup` service preparation. This provides Native/OOB authentication, encrypted persistent refresh-token state and an optional tiny synthetic ciphertext roundtrip. **It does NOT yet copy SQLite, Postgres, R2 or any real media.** A good OAuth result is NOT proof of a disaster recovery backup/restore.

## Security architecture

- Railway Production: service `singmotion-backup` (ID `4dfb0406-e0a0-48b1-aa6b-0e36cd89190a`) is isolated from `singmotion-ai` and `Postgres`.
- Build ONLY `Dockerfile.backup`, not the web app Dockerfile. Runtime image contains only Node 24 and the HiDrive bootstrap code. No web listener, public domain, R2, Stripe or BytePlus credentials.
- Dedicated private writable Railway persistent volume mounted at `/state`; **do not mount or share the Production SQLite volume `/app/.data`**. The entrypoint verifies files and drops privileges to UID/GID 1000 before network activity.
- OAuth refresh state `/state/hidrive-oauth.v1.json.enc`: JSON envelope with 32-byte random salt, 12-byte random IV, AES-256-GCM authenticated encryption. Its key is derived from the sealed HiDrive **client_secret** via HKDF-SHA256, domain separated from the synthetic-file encryption key. The state is not printed. **If the client_secret is rotated, reauthorization will be necessary.**
- All OAuth network exchange via https://my.hidrive.com. Requests use URL-encoded POST body, 18-second timeouts, no redirects. Log only predefined error codes, never tokens, codes, secrets, signed URLs, customer data or raw HTTP error messages.
- Authentication requests `scope=user,rw`, NOT `admin` or `owner`.
- The authorization-code exchange checks `/oauth2/tokeninfo` first: this independently verifies the *actual granted role and access* before any refresh token is saved, and safely supplies the scope if the token exchange response omitted it. Contradictory explicit token scopes are rejected. Fixed errors distinguish `OAUTH_GRANT_SCOPE_READ_ONLY`, `OAUTH_GRANT_SCOPE_ELEVATED_ROLE`, `OAUTH_GRANT_SCOPE_MISSING`, `OAUTH_TOKENINFO_SCOPE_READ_ONLY` and `OAUTH_TOKENINFO_SCOPE_ELEVATED_ROLE` without ever printing raw provider responses. If the user selected read-write, do not assume they selected the wrong option without this evidence.
- The registered Native app's default redirect must be OOB; **omit the optional `redirect_uri` parameter in the browser URL** because HiDrive rejected an explicit `redirect_uri=oob` as `invalid redirect_uri (format)` during the operator's first attempt. The OOB code is short-lived (STRATO says use within five minutes), and must be entered **directly into Railway**, not ChatGPT or a GitHub issue.
- HiDrive target is always private `root/users/<verified OAuth alias>/SingMotion-DR`. The worker refuses a `public` folder, arbitrary path and wrong Railway service.

## Current environment names

Already set: `HIDRIVE_CLIENT_ID`, `HIDRIVE_CLIENT_SECRET`, `BACKUP_ENABLED=false`, `BACKUP_PROVIDER=STRATO_HIDRIVE`, `HIDRIVE_BACKUP_FOLDER=SingMotion-DR`, `BACKUP_MODE=SETUP_ONLY_NO_DATA_TRANSFER`.

**Never** place HiDrive secrets in `singmotion-ai`. The Railway UI should display the sensitive variables as **Sealed**. The connected automation API can read variable *names only*, not the credential values.

### Steps, after worker is deployed and the owner sees the safe setup log

1. In the STRATO approval email, copy the **client_id** locally and construct the authorization URL in your browser without pasting it into the chat:

   `https://my.hidrive.com/client/authorize?client_id=YOUR_CLIENT_ID&response_type=code&scope=user%2Crw&lang=de`

2. Sign into HiDrive and explicitly choose the **normal user role with read/write** (`user,rw`), not the default read-only (`user,ro`) and not admin/owner. The worker refuses all other granted scopes. Do not continue if the approval screen indicates a different permission. STRATO displays an OOB code. **Within five minutes**, in Railway Production → `singmotion-backup` → Variables, add `HIDRIVE_AUTH_CODE` with that one-time value. Do **not** post this code to ChatGPT, support, issues or logs. Change `BACKUP_MODE` to `AUTH_EXCHANGE_ONLY`. Apply/Deploy those variables **together**.
3. Verify the worker printed `HIDRIVE_OAUTH_AUTHORIZED_ENCRYPTED_STATE_SAVED`, and never any token content. If the worker fails, its fixed error codes distinguish `OAUTH_GRANT_SCOPE_NOT_USER_RW` (permission mismatch) from `OAUTH_GRANT_ACCESS_TOKEN_INVALID` or `OAUTH_GRANT_REFRESH_TOKEN_INVALID` (malformed/missing grant fields). Never print raw responses or paste values into chat/issues. This proves token exchange and encrypted state persisted on the attached volume. Do not run reauthorization over an existing state without an explicit operator-approved recovery procedure.
4. Remove the consumed `HIDRIVE_AUTH_CODE` variable in the Railway UI (even if sealed), set `BACKUP_MODE=PROBE_ONLY` and deploy. The job refreshes its OAuth token **and persists the rotated refresh token**; it requests the exact private folder's metadata and prints `HIDRIVE_PRIVATE_FOLDER_READWRITE_VERIFIED` on success.
5. For the optional **encrypted synthetic test only** set `HIDRIVE_SYNTHETIC_TEST_APPROVED=YES` and run `PROBE_ONLY` again. The job creates one UUID-named tiny AES-256-GCM ciphertext file under the exact private folder, reads it back and validates integrity, deletes its own test object and verifies absence. It prints `HIDRIVE_SYNTHETIC_ENCRYPTED_ROUNDTRIP_VERIFIED`. If a network call is uncertain, manual reconciliation may be needed. **Never copy private customer media during this test.**
6. Set `HIDRIVE_SYNTHETIC_TEST_APPROVED=false` and `BACKUP_MODE=SETUP_ONLY_NO_DATA_TRANSFER` after the probe. `BACKUP_ENABLED=false` stays fixed.
7. Keep the private backup service without a cron or public domain until a separate, tested real backup implementation is approved. STRATO Native refresh tokens expire after ~60 days of *inactivity*; a working production Cron and alerting must use/refresh them before that, otherwise the operator must authorize again.

## Independent disaster recovery work still required

- **SQLite:** The website's original volume is mounted exclusively to `singmotion-ai`; the backup service cannot read it directly. Securely export a consistent encrypted snapshot using the existing app-side WAL-safe backup implementation, then transfer ciphertext out without exposing a public data route or modifying the original store.
- **Postgres:** Use private Railway network with verified TLS and a read-only dump, encrypt before transferring to independent HiDrive.
- **Cloudflare R2:** Read-only bucket-scoped source key, approved transfer/costs, client-side encryption and complete immutable manifest/checksum verification.
- **Restore:** Isolated verification of all three SQLite databases, PostgreSQL CMS, R2 media/MP4 and exactly-once Credit ledger. Set release attestation variables only after actual evidence.
- **Alerting and retention:** recurring job, failure alerts, operator offline key custody, deletion/expiry rules and monthly restore drills.

No production volumes, existing checkout/media runtime, public access, provider configuration or credit gates are touched by this authentication worker.

**Sources:** https://developer.hidrive.com/basics-flows/ · https://developer.hidrive.com/oauth2-endpoints/ · https://developer.hidrive.com/http-api-reference/ · https://docs.railway.com/volumes · https://docs.railway.com/variables .
