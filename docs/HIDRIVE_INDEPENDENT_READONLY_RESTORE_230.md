# Issue #230 — independent HiDrive READ-ONLY recovery gate (2026-11-17)

**NO real recovery verified.** These are operator-run tools only; this branch
must not be merged or automatically deployed as a Production source activation.

## Verified inputs (Production sender logs, NOT independent remote GET)

- Run: `267e5c70-7bdd-4157-ba40-5a757bdc07d9`
- Encrypted signed manifest ID: `a05306b2-6e93-4d41-bc32-82c175caa422`
- Sender-reported manifest: 381,510 bytes, SHA-256
  `78e4ca1d7f445116329c919c74240f74f17c6ecab1f769f541b820a5809d379e`
- 689 encrypted segments + 1 encrypted manifest = **690 receipt-listed objects**,
  533 source files (3 SQLite, 1 PostgreSQL, 398 R2, 131 local).
- Original source bytes: 1,298,458,814. The encrypted readback byte total is
  different because it includes per-segment encryption envelopes.
- `remoteReceiptCommitted:true`, `independentRestoreVerified:false`.

## Proposed independent encrypted-object verification — NO private RSA key

1. Keep Production and Staging completely untouched. The new private Railway
   project `277416f6-c5bc-4f93-95cf-040fe551875b` (`restore-only`) has
   **staged-only**, not deployed, independent PostgreSQL, 8 GiB recovery
   scratch and a private media bucket. The pending patch must not be accepted
   until cost control and secure OAuth access are confirmed.
2. On an **operator-controlled separate cloud runner**, obtain a fresh HiDrive
   OAuth grant restricted to **user,ro**. Do **not** copy Production worker's
   `/state` OAuth volume, token, credentials, or the Production `user,rw`
   grant. STRATO supports access level `ro`; rclone's HiDrive backend uses
   `--hidrive-scope-access ro` and `--hidrive-scope-role user`.
   The CLI verifies the *actual granted scope* with HiDrive's tokeninfo endpoint
   directly from the trusted runtime and refuses anything other than exactly
   `user,ro`. It returns no token or alias. Passing `ro` to rclone after an
   existing `rw` grant does NOT downgrade an already granted token.
3. Configure rclone directly in that trusted runner, using its own private
   mode-0600 configuration file. No OAuth token, client secret, config file or
   recovery key may be pasted into chat, issues, GitHub or CI.
   The runner must be nonroot, nonpublic, short-lived, free of Source Stripe,
   Credits, provider jobs and R2 credentials, and should have restricted
   egress. No public admin console or HTTP recovery endpoint.
4. With the **separately authenticated** HiDrive remote exposing the
   `SingMotion-DR` directory, configure only the following non-secret local
   variables in that operator-run shell (not in the repository):

   ```sh
   export RESTORE_HIDRIVE_RO_RCLONE_CONFIG=/private/rclone.conf
   export RESTORE_HIDRIVE_RO_REMOTE=hidrive-ro:SingMotion-DR
   node scripts/hidrive-readonly-commit-preflight.mjs --manifest-only
   ```

   The path and remote string are examples; they must point to a private
   operator-created read-only grant. The rclone `[hidrive-ro]` section must
   explicitly set `type = hidrive`, `scope_access = ro`, `scope_role = user`
   and contain a freshly authorized OAuth token; an RW token fails closed.
   Configure an appropriate private `root_prefix` for the existing HiDrive
   backup folder without exposing the user alias in logs or GitHub. `--manifest-only` checks the exact
   remote `sm-<run>-COMMITTED.enc` receipt, enforces 690 authorized entries,
   pins the manifest ID, length and SHA-256, and **GETs only** the encrypted
   manifest. It performs no upload, deletion, data restore or decryption.
5. After the manifest-only gate passes, enable the separate, time-bounded
   full ciphertext readback and budget review:

   ```sh
   export RESTORE_FULL_READ_APPROVED=YES
   node scripts/hidrive-readonly-commit-preflight.mjs --all-ciphertext
   ```

   This GETs and SHA-256 checks **all 690** receipt-listed objects with a
   bounded streaming buffer. The CLI prints only aggregate results and never
   the confidential object names or OAuth tokens. It does **not** persist the
   downloaded ciphertext; a separate isolated restore/download procedure is
   still required.

## RSA private key custody — NEVER upload it here

- The real archive uses RSA-3072 OAEP-SHA256 to wrap per-segment AES-256-GCM
  keys. The owner holds the only private recovery key.
- **Neither this script nor the Railway project receives any RSA key.** The
  owner's key must not be a GitHub secret, Railway variable, public endpoint
  upload or ChatGPT attachment.
- The later decrypt/restore step requires a separately audited,
  operator-controlled secret-use facility (e.g. hardware-/vault-backed RSA
  unwrap initiated directly by owner, or ephemeral trusted runner key access
  not surfaced to ChatGPT). Secure key usage and key-to-public-key pairing
  must be proved before any real decrypt. Merely using a synthetic key is
  not evidence.
- The repository already has `restoreMultiStoreArchive`, which checks the
  Ed25519-signed manifest, GCM authentication and source hashes. It does not
  by itself validate restored SQLite/CMS/media/credit semantics.

## Billing and acceptance

- The operator's **EUR 10 is a project-specific spending authorization, not
  a Railway-enforced spending cap**. Railway compute usage hard limits are
  workspace-wide and must **never** be set for this purpose because they may
  take the existing Production offline.
- Keep the staged restore patch unapplied until approved private session,
  nonroot runner, independent key custody, cost/cleanup procedure and
  bounded resource availability can be verified.
- First gate: independent HiDrive receipt + pinned manifest GET PASS.
- Second gate: independent full ciphertext 690/690 remote hash PASS.
- Final gate: actual 533-file restore, full SQLite credit audit, empty
  isolated PostgreSQL CMS import/schema/migrations, recovered private R2/MP4
  full+Range and cross-customer denial using synthetic identities; record
  independently measured RPO/RTO and operator rollback/retention.
- **Keep #230 OPEN and verification flags false until final gate passes.**

References:
- https://developer.hidrive.com/oauth2-endpoints/
- https://rclone.org/hidrive/
- https://docs.railway.com/pricing/cost-control


## Browser-only Railway operator console (no local PC)

Railway announced a browser-based `Console` tab for running service instances:
https://railway.com/changelog/2026-05-29-cli-volumes . Availability for the
specific account must be checked by the operator; it is not exposed through
this ChatGPT Railway connector. Do not assume shell access before a service
has deployed.

- The **separate** `restore-worker-private` service is prepared as
  STAGED ONLY in `singmotion-restore-230-isolated`, with nonroot UID 10001,
  no public hostname, an EU recovery scratch volume and one pinned source
  revision using `Dockerfile.restore-readonly`.
- Its default command is only `sleep 1800` (30 minutes, restart NEVER).
  It has **no automatic HiDrive GET** and no public API. A brief activation
  window can provide the owner a private browser Console to do the HiDrive
  authorization independently, without using a personal computer.
- The staged reader's rclone config path is now `/tmp/rclone.conf`, **inside
  the disposable nonroot container filesystem**. No persistent OAuth secret
  file is put on the 8 GiB `/recovery` volume. The private config does not
  exist yet; it must be created in a trusted owner-controlled session (mode
  0600, UID 10001). The owner needs to
  authorize a fresh read-only HiDrive grant in an owner-controlled **trusted
  browser/cloud environment** and place a 0600 config directly on that
  private host/volume. Do not send any OAuth token, config or code to this
  chat or GitHub. The default rclone localhost OAuth callback may not work
  from a remote browser Console; use an approved owner-controlled cloud
  browser with correct OAuth redirection, rather than exposing a public
  callback or quietly using the Production token.
- Only after a real `user,ro` tokeninfo proof, run explicitly in the
  private Console (not automatically on startup):

  ```sh
  node /opt/singmotion/scripts/hidrive-readonly-commit-preflight.mjs --manifest-only
  ```

- This worker is **NOT DEPLOYED**. The existing staged patch also includes
  PostgreSQL, a database volume and a recovery object bucket. Committing it
  starts additional resources and could create recurring costs. Do not
  commit the patch simply to obtain a Console: schedule a supervised,
  time-bounded operator activation after OAuth/key handling and budget
  controls are ready. The EUR 10 target is not automatically enforced by
  the Railway connector.
- The temporary browser Console host is a *ciphertext readback host only*.
  **NEVER** place the owner's RSA recovery private key on this Railway
  service, in its mounted volume, its variables or logs. The later RSA
  decrypt/import procedure remains a separate, independently approved
  operation under owner key custody.


## Faster browser-only first proof, no new OAuth client (owner action)

Before spending any money, the account owner can open the official **HiDrive
web UI** at `https://my.hidrive.com/` in an owner-controlled cloud browser
or on a mobile browser. **Do not supply login credentials to ChatGPT, GitHub,
Railway environment variables or a public file-sharing link.**

Inside their existing private `SingMotion-DR` folder, download exactly these
two **encrypted** objects into a private workspace, keeping their names:

1. `sm-267e5c70-7bdd-4157-ba40-5a757bdc07d9-COMMITTED.enc`
2. `sm-267e5c70-7bdd-4157-ba40-5a757bdc07d9-a05306b2-6e93-4d41-bc32-82c175caa422.enc`

The second file must be **381,510 encrypted bytes** and match the pinned
SHA-256. The first file is a small, plaintext *ciphertext-only* receipt.
Do not download unrelated files, restore plaintext, retrieve private RSA keys,
or create a new backup.

A new `scripts/hidrive-local-receipt-preflight.mjs` runs entirely **offline**
on the operator's private Linux workspace, as nonroot, with Node 24. It can
also run inside the dedicated nonpublic Railway Console once an appropriately
time-bounded single worker is active. The two files must be stored in mode
0600 (or at least not group/other writable) under the same user. Invoke:

```sh
node /opt/singmotion/scripts/hidrive-local-receipt-preflight.mjs /tmp/COMMITTED.enc /tmp/MANIFEST.enc
```

Pass exact private paths used when uploading the two encrypted downloads.
It checks receipt schema, run/manifest pin, **690 remote object IDs** in the
receipt and local manifest bytes + SHA-256. Its report intentionally says
`independentlyAuthenticatedHiDriveGetVerified:false` because an operator-
provided local file cannot prove its own download provenance.
This is a preliminary **local ciphertext consistency** gate only, not an
authenticated remote API GET, Ed25519 signature check, decryption or real
restore. Record the owner-controlled HiDrive download source and date
separately if evidence is needed.

**Do not accept the old staged Railway patch solely to use the Console.**
At this point it still contains unused draft storage/database/bucket resources,
and the Railway connector cannot remove all staged-only objects via its
regular delete APIs. An isolated minimal single worker / trusted cloud workspace
must be used for the initial two-file check instead. Avoid uncontrolled
activation or costs.

The later complete independent HiDrive readback still needs a genuine
separately authenticated read-only API/session with correct OAuth callback
(e.g. a trusted cloud browser co-located with rclone), or a demonstrably
read-only equivalent. Railway's browser Console by itself does **not**
complete a default rclone localhost redirect (`127.0.0.1:53682`) from
the owner's separate browser.
