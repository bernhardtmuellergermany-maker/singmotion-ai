# Independent offsite recovery storage — operator bootstrap

Updated 2026-11-16 · SingMotion Production · #230

**Status: TOOLS PREPARED; NO OFFSITE BUCKET OR REAL BACKUP CREATED.**

Railway Pro volume backups were confirmed by the owner via screenshots on
2026-11-16: SQLite app 12:59 / 790 MB and Postgres 12:58 / 115 MB, both
scheduled and healthy. These existing in-place Railway snapshots stay untouched.
Offsite recovery is an additional **independent** layer, not another Railway
snapshot. Do not mark either Production restore evidence flag true yet.

## Storage provider selection and custody

Suggested provider for the independent archive: a **private Backblaze B2
bucket** in an operator-controlled account, physically and administratively
separate from the Production Railway account and Cloudflare R2 media bucket.
An independent private AWS S3 bucket is also acceptable. Do not reuse the
source Cloudflare account/bucket as the only recovery destination.

**Before any data transfer:**

1. Create the independent recovery storage account with MFA and a private
   bucket. Review data residency and customer-data/processor agreements.
   Enable bucket versioning and object retention/Object Lock if supported;
   choose and record actual retention (e.g. 30 days, subject to legal review).
   Never make the backup bucket public.
2. Create least-privilege application credentials for writing **only**
   to the private backup prefix; use separate, protected read credentials
   for isolated disaster recovery. Lock down who can delete old versions.
3. Store credentials, the Rclone crypt secrets and the age private key
   **only in an operator-controlled secrets manager**, never in GitHub,
   ChatGPT, screenshots, Railway public variables, command history or
   customer-accessible endpoints.
4. Prepare a dedicated trusted Linux recovery/export host (non-root OS
   user; no public web server, audit logging without private object names).
   The host must have Node 24, Rclone, age, PostgreSQL client pg_dump
   compatible with the source database, and enough **private** temporary
   storage. A bare Railway OAuth connector is not a runtime shell and
   cannot run these commands for you.
5. Keep the recovery host separate from the running Production volume
   and ensure it has no unnecessary payment/provider secrets. Prevent
   public web access to exported data.

## R2: encrypted immutable offsite object copy (new operator CLI)

Configure one owner-only Rclone configuration file (file mode 0600) on
the private recovery host with three named remotes:

- \`r2_source\`: Cloudflare R2 source with **read-only List/Get/Head**,
  configured via Rclone S3 provider Cloudflare; remote path includes the
  actual private bucket or prefix.
- \`b2_private\`: destination Backblaze B2 S3-compatible remote, authenticated
  with dedicated least-privilege upload credentials.
- \`encrypted_offsite\`: Rclone \`crypt\` overlay over
  \`b2_private:singmotion-recovery\`, with **standard filename encryption**
  and independently recoverable generated passphrases.

The exact bucket names/endpoints are **not** checked into source control.
Configure through \`rclone config\`; it supports S3/Cloudflare/B2 and
encryption overlay. \`rclone.conf\` only lightly obscures the crypt keys:
0600 permissions and vault-protected recovery of its contents matter.

The script requires those specific aliases only as an example; another
safe alias works if correctly configured. Example environment-variable
**names** (not real credentials):

~~~
RCLONE_CONFIG=/private/conf/rclone.conf
RCLONE_R2_SOURCE=r2_source:YOUR_PRIVATE_R2_BUCKET
RCLONE_OFFSITE_CRYPT=encrypted_offsite
OFFSITE_COPY_COST_AND_PRIVACY_APPROVED=YES
~~~

With the operator's explicit approval and verified separate storage,
invoke on the **private host** (not in Railway Production):

~~~
npm run backup:r2-offsite
~~~

The CLI rejects absent confirmation, root, Railway runtime, insecure
configuration permissions, unencrypted destination, a source/destination
that are the same remote or Cloudflare as destination, unsafe paths and
empty source. It creates a unique \`r2/<timestamp>-<nonce>\` prefix, uses
\`rclone copy --immutable\` (NEVER \`sync\` or \`delete\`), performs
\`rclone check --download --one-way\` for full content parity, and
compares source and destination item/byte totals. Only aggregated counts
and random run ID are printed; no object names/customer files/passwords.

**Caveats:** This is a *live read*, not a frozen R2 point-in-time
transaction. Changes during upload can fail verification; rerun into
a fresh prefix and document start/end timestamps. Full download
verification can incur substantial R2 data egress and storage cost;
never enable automated schedules until capacity, costs and protection
are explicitly approved. A partial failed run is kept (not silently
deleted) and must not be treated as a completed recovery set.

Do not use production write credentials in the backup host.
Rclone official crypt documentation: https://rclone.org/crypt/
Rclone content check: https://rclone.org/commands/rclone_check/

## PostgreSQL: encrypt while dumping; no plaintext disk

On the trusted non-root operator host, establish a **TLS-verified**
read-only connection to the Railway Postgres database through an approved
operator connection path. Don't expose the database publicly merely to
enable backup. Use \`PGSSLMODE=verify-full\` and the proper CA via
\`PGSSLROOTCERT\`; store a mode-0600 \`PGPASSFILE\` in the host's secrets
facility. Never place a password inside command-line arguments.

Use a dedicated mode-0700 output directory outside the app/DB volumes.
Generate a private \`age-keygen\` identity pair, store the **private**
identity in the separate vault and put only its **public** \`age1...\`
recipient in \`AGE_RECIPIENT\`. Actual connection variables remain private:

~~~
PGHOST=... PGDATABASE=... PGUSER=... PGPASSFILE=/private/pgpass
PGSSLMODE=verify-full PGSSLROOTCERT=/private/ca.pem
PG_EXPORT_PRIVATE_DIR=/private/pg-ciphertext
AGE_RECIPIENT=age1...
PG_EXPORT_PRIVACY_AND_STORAGE_APPROVED=YES
~~~

Run locally:

~~~
npm run backup:postgres-encrypted
~~~

The CLI pipes a transaction-consistent \`pg_dump --format=custom\` directly
into \`age\` encryption, without writing plaintext to a disk. It emits an
encrypted \`cms.dump.age\` and SHA-256 checksum in a unique private folder.
**This is only a local export, not yet offsite retention or a restore.**
Copy ciphertext alone to the destination \`encrypted_offsite:postgres/<run>\`
using \`rclone copy --immutable\`, then \`rclone check --download\`.
Record counts and result in a private, PII-free log.

For true recovery, independently retrieve and decrypt the file on a
separate isolated host and \`pg_restore --exit-on-error\` into an empty
**non-Production** DB. Audit CMS staff/migrations/published-content counts
and egress isolation, then erase scratch plaintext. Never run pg_restore
against the source PostgreSQL service.

age specification: https://github.com/FiloSottile/age

## SQLite: already shipped end-to-end encryption and offline verification

With read-only Production app-volume access from the authorized operator
host, use the existing \`npm run backup:sqlite-encrypted\` to create a
WAL-safe encrypted set of the 3 critical SQLite databases. Place the
archive in the independent storage using an immutable unique prefix
(\`encrypted_offsite:sqlite/<run>\`), and verify checksum and object count
with a full-content \`rclone check --download\`.

Recover it from that **separate stored ciphertext**, not from a
different local copy; invoke \`npm run restore:sqlite-encrypted-offline\`
on a separate isolated host with the independently recovered secret.
Require report \`ok:true\` for the three SQLite databases and Credit
ledger integrity. Record private source identity and actual times.

## Acceptance checklist, not inferred from fixtures

- [x] Railway manual snapshots and daily schedules visible for app/Postgres
      in operator screenshots (2026-11-16).
- [ ] Actual provider-owned **external** private recovery bucket created,
      versioning/retention/permissions/key custody verified.
- [ ] Real encrypted SQLite archive offsite + **independent** 3/3 restore.
- [ ] Real PostgreSQL age-encrypted dump offsite + isolated CMS restore.
- [ ] Complete Cloudflare R2 media copy to independent encrypted store,
      full-content parity checked + isolated sample MP4 full/Range retrieval.
- [ ] Retention/access-deletion safeguards + restore key recovery tested.
- [ ] Measured real RPO/RTO and operator-owned, PII-safe recovery evidence.
- [ ] Only then sign off #230 and consider backup release flags.

**Current ChatGPT connection limitation:** It cannot open an external
Backblaze B2/AWS account or configure the user's private vault; it also
cannot read Railway Production volume files or copy Cloudflare R2 objects
using the connected Railway OAuth app. Scripts and fixture tests are
not production recovery evidence. No app, Stripe, BytePlus or media-store
settings have been changed.
