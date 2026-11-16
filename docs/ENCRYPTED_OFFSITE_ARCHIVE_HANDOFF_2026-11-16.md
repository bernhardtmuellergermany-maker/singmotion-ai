# Offsite encrypted archive handoff — operator procedure

Prepared 2026-11-16 · SingMotion · Tracking issue #230

**STATUS: CODE + SYNTHETIC TESTS ONLY. NO REAL CUSTOMER-DATA EXPORT, OFFSITE
ARCHIVE OR PRODUCTION RESTORE HAS BEEN PERFORMED.**

## Scope and current evidence

The isolated \`singmotion-backup\` Railway service has successfully completed a
**single encrypted synthetic HiDrive roundtrip**, including private folder
read/write, token refresh, AES-GCM integrity and remote deletion. Its sealed
OAuth state remains on a separate \`/state\` volume and its normal mode remains
\`SETUP_ONLY_NO_DATA_TRANSFER\`, with \`BACKUP_ENABLED=false\`.
**That success does not authorize or prove a real customer-data backup.**

Read-only Railway service metadata confirms:
- App SQLite volume at \`/app/.data\`; 5,000 MB allocated. Actual source
  database names, on-disk sizes, WAL state and data freshness still require
  direct authorized operator read-only inventory.
- CMS PostgreSQL volume at \`/var/lib/postgresql/data\`; 500 MB allocated.
  Connection, major version and real restore evidence remain unverified.
- HiDrive worker private OAuth volume at \`/state\`; 128 MB. **Never put**
  customer database dumps, R2 objects or archive plaintext here.
- Cloudflare private R2 media is **outside Railway**; the current connected
  tools have not verified the bucket name, contents, quota, versions or size.
  Do not assert complete media recovery from a sample MP4 or HTTP preflight.

## What the new archive handoff command actually does

\`npm run backup:archive-offsite\` runs **only on a trusted, non-root,
non-Railway operator host**. It accepts an **already encrypted** bundle:
- \`ENCRYPTED_ARCHIVE_KIND=sqlite\`: *exactly* three
  \`*.sqlite.aes-256-gcm\` files plus their existing \`manifest.json\`.
  Rechecks ciphertext SHA-256 for each encrypted file against the manifest.
- \`ENCRYPTED_ARCHIVE_KIND=postgres\`: *exactly*
  \`cms.dump.age\` plus its \`cms.dump.age.sha256\`, with a matching hash and
  age format header. It does not decrypt or connect to the database.

The tool refuses unexpected files, symlinks, unsafe permissions, a non-private
folder, an unencrypted/non-HiDrive Rclone destination, Railway execution, root
execution or missing explicit privacy/cost approval.

Using a separate owner-managed Rclone \`hidrive\` backend wrapped in a
\`crypt\` remote with standard filename encryption, it:
1. Makes a new, randomized \`sqlite/<run-id>\` or \`postgres/<run-id>\` prefix.
2. Runs **\`rclone copy --immutable\`** (never \`sync\`, \`move\`, \`delete\`).
3. Runs **\`rclone check --download --one-way\`** against the new copy.
4. Checks item count and encrypted-byte totals and rechecks the original
   ciphertext files have not changed while copying.
5. Prints only aggregate counts, the random run ID and
   \`isolatedRestoreVerified:false\`, never account IDs, filenames, URLs,
   archive paths, credentials or business records.

A failed upload may leave an **incomplete** uniquely named remote prefix;
such a prefix must not be treated as a recoverable backup. This tool provides
no retention lock or delete protection; the owner must arrange those
independently with their HiDrive subscription and security process.

## Operator prerequisites — DO NOT skip

1. Explicitly review and approve real transfer, capacity and any additional
   network/storage charges; confirm privacy/data-residency agreements and an
   owner-accessible recovery key escrow. Do not grant approval based on the
   earlier synthetic probe alone.
2. Prepare a hardened, non-root Linux operator host with Rclone and Node 24.
   Do **not** copy Railway live payment/provider keys, the app volume,
   \`/state\`, R2 write credentials, or Postgres root credentials to a public
   or customer-accessible host. Use a dedicated read-only source access path.
3. Follow \`docs/ENCRYPTED_SQLITE_BACKUP_OPERATOR.md\` and
   \`docs/OFFSITE_BACKUP_BOOTSTRAP_2026-11-16.md\` to create the **actual**
   consistent SQLite AES-GCM or Postgres age encrypted output with a
   separately recoverable encryption key. These scripts must not be run
   by the public web app or scheduled Railway backup worker.
4. Configure a separate private \`rclone.conf\` (mode 0600, owner-only) on the
   operator host: \`hidrive_private\` uses its **own** OAuth authorization,
   and \`encrypted_offsite\` uses Rclone \`crypt\` with encrypted filenames
   and a separately vaulted password. Do not try to extract or paste the
   backup worker's sealed refresh token into Rclone; the worker's OAuth
   setup and Rclone's credential storage are independent.
5. Use operator-owned private 0700 archive directories with only the expected
   encrypted files. Paths must be canonical, not symlinks. Before running,
   supply variables through the trusted host's secret facility:

   ~~~
   RCLONE_CONFIG=/private/rclone.conf
   RCLONE_OFFSITE_CRYPT=encrypted_offsite
   ENCRYPTED_ARCHIVE_KIND=sqlite
   ENCRYPTED_ARCHIVE_DIR=/private/encrypted-sqlite/singmotion-sqlite-RUN
   OFFSITE_TRANSFER_PRIVACY_APPROVED=YES
   ~~~

   For a PostgreSQL archive, set \`ENCRYPTED_ARCHIVE_KIND=postgres\` and
   point \`ENCRYPTED_ARCHIVE_DIR\` to the private directory containing
   \`cms.dump.age\` and \`cms.dump.age.sha256\`.

   **Do not paste actual paths, remote credentials or passphrases into
   ChatGPT, GitHub issues, shell history or build logs.** The confirmation
   variable above is approval for a real transfer and must be set only by
   the owner after privacy, cost and legal reviews.

6. Manually invoke \`npm run backup:archive-offsite\` on the trusted host.
   Preserve the privacy-safe result, source snapshot time, offsite quota and
   actual SHA-256 manifest in the operator's private evidence vault.

## Restore proof required after any actual offsite transfer

- Fetch the **offsite ciphertext**, not the original local export, onto a
  **different**, network-isolated host with independent key access.
- SQLite: run \`npm run restore:sqlite-encrypted-offline\` using the copied
  encrypted bundle and isolated scratch; require three checked DBs and
  \`ok:true\` from the Credit-ledger invariant audit. Never restore onto the
  live app volume.
- PostgreSQL: decrypt \`cms.dump.age\` with an independently recovered age
  private key, then run \`pg_restore --exit-on-error\` into a **new empty
  recovery database** with no live Stripe/BytePlus/R2/payment variables.
  Verify CMS schema, staff, migrations and privacy-safe content counts.
- Private R2 media: requires its own full-source inventory, protected
  encrypted offsite copy and separate authorization; test a recovered MP4
  full/range GET and cross-account denial in isolation.
- Record actual archive and recovery times, achieved RPO/RTO, key custody,
  retention/delete protections and independent owner approval.

Do not set \`BACKUP_RESTORE_EXERCISE_VERIFIED\`,
\`PRODUCTION_CMS_BACKUP_RESTORE_VERIFIED\`, or any public release flag
until the **real** SQLite/Postgres/R2 offsite restoration evidence is reviewed.

**Connector limitation:** Current connected Railway/GitHub actions cannot
read the mounted Production SQLite files, run \`pg_dump\` against private
PostgreSQL, inspect a Cloudflare R2 private media bucket, configure an
owner-managed Rclone vault or perform independent filesystem restoration.
Those actions require an explicitly approved private operator host.
