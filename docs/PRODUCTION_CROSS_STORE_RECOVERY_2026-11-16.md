# Production disaster recovery — operator execution and evidence
Updated 2026-11-16 · Tracking #230 · Public launch #238

**Current state: NOT VERIFIED.** The new offline CLI and fixture tests are
tools, not proof that actual Production customer data was ever recovered.

## Read-only inventory

| Store | Source | Actual offsite restore evidence |
| --- | --- | --- |
| SQLite | singmotion-ai-volume, 5,000 MB, /app/.data | None |
| PostgreSQL CMS | postgres-volume, 500 MB, /var/lib/postgresql/data | None |
| Cloudflare R2 private media | Outside Railway project | None |

Railway Production environment ID:
36adc41d-7e54-4396-ad1a-fd432ba0441d

The working private German Credit studio and wallet must remain available.

## 2026-11-17 evidence — native backup schedules already present

The owner inspected Railway Production Backups tabs directly and shared
screenshots. **Both volumes already have automatic daily backup schedules.**

- `singmotion-ai-volume`: a visible latest `Daily Schedule` backup of
  **774 MB**, shown as ~10 hours old; next backup ~13 hours later; two
  earlier entries visible, including a dated backup. Backup data was not
  downloaded or restored.
- `postgres-volume`: a visible latest `Daily Schedule` backup of
  **116 MB**, shown as ~8 hours old; next backup ~15 hours later; another
  earlier entry visible. PostgreSQL PITR is explicitly **off**. Do not enable
  PITR as part of this work: it causes a database redeployment.

The connected Railway OAuth integration independently confirmed the exact
Production mounts and healthy deployments. It cannot retrieve the native
backup IDs, historical restore contents or Railway volume backup bytes.
**These snapshots are a useful Railway-local recovery layer, not an
independent encrypted offsite or tested restore.** Do not create duplicate
on-demand snapshots merely to satisfy a schedule checkbox, and never restore
onto the live Production service.

The app's existing `scripts/backup-source-inventory.ts` still requires an
app-container execution context. PR #284 adds a normally disabled short-lived
internal trigger with no public route or real-data upload. It is a precursor
to actual encrypted offsite backup, not a substitute for one.

## A. Railway snapshots (recovery layer, not offsite)

Railway supports manual/scheduled daily/weekly/monthly Backups in each
volume-attached service's Backups tab. The connected ChatGPT Railway OAuth
connector cannot list or create existing-volume snapshots and exposes no
Production shell or Cloudflare-R2 object access.

Using a trusted operator account, inspect **singmotion-ai → Backups** and
**Postgres → Backups**, create a manual snapshot for each and choose a
documented schedule. Record the actual snapshot IDs/time/retention privately.
Do not click Restore or Deploy on the Production volumes to test a snapshot:
it stages a mounted volume swap and redeploys the LIVE service. Railway volume
backups can only restore to the same project/environment. They are NOT a
separate offsite disaster-recovery copy. Also confirm the manual snapshot
50%-volume-size limitation.
See https://docs.railway.com/volumes/backups

## B. SQLite encrypted export and independent restore

As a trusted non-root operator with read-only access to mounted Production
DATA_DIR and two separate, precreated private 0700 output/scratch folders,
run npm run backup:sqlite-encrypted. Use a separately recoverable, 32+
character BACKUP_PASSPHRASE injected by a private secret manager, not
shell history or this repository.

The existing command uses WAL-aware native SQLite online backups of
commerce.sqlite, live-test.sqlite and demo.sqlite, AES-256-GCM encryption
and in-process authenticated decrypt/checks. Transfer only the encrypted
archive directory and its non-PII manifest to a protected independent
offsite location, verify SHA-256, key custody and retention.

On a distinct, locked-down offline non-root host, with NO Railway environment
variables, public routes or live Stripe/BytePlus/R2 credentials, configure:

- RESTORE_ENCRYPTED_ARCHIVE_DIR — copied encrypted archive folder
- RESTORE_PRIVATE_SCRATCH_DIR — separate private 0700 scratch parent
- BACKUP_PASSPHRASE — recovered key from independent trusted secret manager

Run npm run restore:sqlite-encrypted-offline. The verifier checks exact
archive version/file names, ciphertext SHA-256, AES-GCM authentication,
decrypted SHA-256, three SQLite quick_checks and full Credit-ledger
invariants, then removes temporary plaintext. An operating-system crash
may leave scratch plaintext; secure-wipe abandoned scratch files.

Required PASS report has ok:true, verified entries for exactly
commerce.sqlite, live-test.sqlite and demo.sqlite, and failed:[].
The independent operator must confirm the archive really originated from
Production and was protected offsite; test fixtures do not establish that.

## C. Independent PostgreSQL logical backup and restore

From a restricted, authorized client with verified TLS, dedicated read
permissions and pg_dump matching server PostgreSQL major version, run a
transaction-consistent pg_dump custom archive against LIVE source without
schema modifications, e.g. (credentials injected through protected PGPASSFILE
and PGHOST/PGUSER/PGDATABASE environment, never inline in commands):

~~~
umask 077
pg_dump -Fc --no-owner --no-acl --file "$PRIVATE_SCRATCH/cms.dump"
pg_restore --list "$PRIVATE_SCRATCH/cms.dump" > "$PRIVATE_SCRATCH/pg-archive-list.txt"
~~~

Encrypt the dump with operator-controlled authenticated encryption
(e.g. age to an independently protected recipient) before uploading to an
offsite archive. Copy only ciphertext and a privacy-safe manifest.

On an isolated recovery host with an empty, separately created PostgreSQL
database, no LIVE payment/provider/email/Cloudflare credentials, and
restricted egress, decrypt into private scratch and run:

~~~
pg_restore --exit-on-error --no-owner --no-acl \
  --dbname "$ISOLATED_RECOVERY_DATABASE" "$PRIVATE_SCRATCH/cms.dump"
~~~

Never point the restore at the LIVE database. Check CMS staff and published
content counts, migration state, schema, read-only CMS functionality and
privacy-safe aggregate parity. Capture elapsed recovery time, achieved
RPO and key access evidence; delete plaintext scratch.

Railway PostgreSQL point-in-time recovery (PITR) can additionally be enabled
from the Backups tab when compatible. It writes WAL/base backups to a Railway
bucket and restores into a NEW sibling service, leaving the source untouched.
PITR can redeploy/configure the database and is not a substitute for an
encrypted independent logical dump. Check current image compatibility before
any operation. See https://docs.railway.com/volumes/point-in-time-recovery

## D. Cloudflare R2 independent media recovery

1. Use a dedicated source-read-only R2 API credential and fully paginated
   S3 ListObjectsV2 to inventory every private object, size and timestamps.
   Do not infer total contents from the first page.
2. Copy every object (NOT destructive sync/delete) to an independent private
   encrypted and version-protected recovery bucket with a separate
   destination credential. Configure retention, bucket locks if available,
   and explicit safeguards against accidental deletion.
3. Record privacy-safe total objects/bytes, snapshot start/end, failed-copy
   retries and SHA-256 checks. An ETag is NOT always a whole-file SHA-256.
4. On a locked-down recovery environment, verify private full GetObject,
   byte Range GetObject, content hashes and metadata against source.
   Confirm cross-customer denial using **synthetic accounts** and separately
   isolated API/media, without reusing LIVE Stripe or provider keys.
5. Check how missing/corrupt media is identified and how orphaned
   provider tasks are reconciled without duplicate charges.

S3 ListObjectsV2, HeadObject, GetObject and Range are supported in R2:
https://developers.cloudflare.com/r2/api/s3/api/

## E. Evidence and approval — all still OPEN

- [x] Both Railway native daily **schedules and recent entries visually verified** (2026-11-17 screenshots). Backup IDs, restorability and independent recovery **remain unverified**.
- [ ] Real Production encrypted SQLite archive stored independently offsite
- [ ] Independent offline SQLite restore from that real copy PASS 3/3
- [ ] Encrypted Postgres logical dump offsite, isolated restore and CMS checks PASS
- [ ] Complete private R2 offsite copy, item/count/hash and safe Range checks PASS
- [ ] Proven nonpublic access, cross-owner denial, no LIVE credentials in test
- [ ] Key recovery, retention, deletion protection, monitoring and alerts tested
- [ ] Achieved RPO/RTO with timestamps, owner audit and safe rollback steps recorded
- [ ] Operator signs #230, then evaluates explicit production release approval

Do not set BACKUP_RESTORE_EXERCISE_VERIFIED,
PRODUCTION_CMS_BACKUP_RESTORE_VERIFIED or public checkout flags from
synthetic CI tests, backups that cannot be accessed, or paperwork alone.
