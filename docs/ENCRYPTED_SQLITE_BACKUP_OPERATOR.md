# Operator-only encrypted Production SQLite backup evidence

Created 2026-11-16 · Issue #230 · Public credits release #238

## What changed

The manual `npm run backup:sqlite-encrypted` command snapshots the three known
SQLite stores using Node's WAL-aware online backup API, checks the source copies,
encrypts each copy with AES-256-GCM using **per-file** random salt and IV, then
**decrypts each archive back into a separate disposable private scratch file**
and reruns SQLite quick-check plus the Credit-ledger invariant audit.

It creates an exclusive `singmotion-sqlite-<timestamp>-<uuid>` subdirectory
in `BACKUP_OUTPUT_DIR`. It holds `manifest.json` with per-file SHA-256 hashes,
encryption IV, salt, authentication tag, KDF parameters and successful round-trip
checks, but never includes payment identifiers, email addresses, API secrets or
the passphrase. Data files are `.aes-256-gcm`, with private 0600 permissions;
directories require 0700 permissions and current-user ownership.

**Does not run from startup or any public endpoint.** No LIVE Stripe calls, no
paid provider jobs, no cron, no changing Railway variables, no Production writes.
The script refuses root, a short/missing passphrase, missing directories,
overlapping source/destination/scratch paths, unsafe SQLite links and weak
directory permissions. On errors it removes incomplete private backups and
scratch copies, and only prints fixed diagnostic codes. After abrupt OS-level
termination the trusted operator must still check/secure/erase abandoned
plaintext scratch copies (they can survive SIGKILL/power loss).

## Operator execution (requires private host access)

**Not executable through the current Railway OAuth connector.** A trusted
operator must arrange an encrypted independent backup destination and
restricted private scratch directory, ensure sufficient space, verify the
backups have a tested and access-controlled offsite copy, and arrange long-term
key recovery. The Railway Production source volume currently mounts at
`/app/.data`; verify live paths before use, and **never detach or replace it**.
Do not run from public shells or shared scratch storage.

1. From a trusted **non-root** process with the actual Production `DATA_DIR`
   available read-only, create two separate preexisting **0700** directories:
   private scratch and the externally protected backup destination. They must
   not be nested within the source nor within one another. Merely naming a
   directory “offsite” does not make it an offsite backup.
2. Pass these absolute paths as `BACKUP_SCRATCH_DIR` and `BACKUP_OUTPUT_DIR`.
   Supply a unique >=32-character `BACKUP_PASSPHRASE` via a private secret
   facility (never a command-line argument, shell history, chat, issue,
   checked-in `.env` file or job logs). Keep the key separately recoverable.
3. Run `npm run backup:sqlite-encrypted` manually. Read
   `ENCRYPTED_SQLITE_BACKUP` for `ok:true` and three verified database names,
   and keep the generated opaque archive folder and manifest secured.
4. Check physical offsite durability, access policy, retention, ciphertext
   SHA-256 and passphrase/key recovery. On an **isolated locked-down machine**,
   manually restore/decrypt archives and run the ledger/CMS/media recovery
   acceptance checks with no LIVE production credentials or provider calls.

Never put the `BACKUP_PASSPHRASE` into the permanent Railway app environment
as a substitute for a backup key management process. A command result saying
`ok:true` only means this SQLite snapshot roundtrip passed locally; it does
**not** prove independent offsite retention or isolated full recovery.

## Remaining hard gates (still NO-GO)

- A real encrypted, operator-owned **offsite** copy plus independently restored
  Production SQLite data; record actual manifest, time, RPO/RTO and isolation.
- Independent PostgreSQL CMS consistent dump + restore into a locked-down
  database with staff/content/migration verification.
- Independent private Cloudflare R2 output recovery and account-only MP4 access,
  byte-range GET, cross-customer denial, privacy and refund/dispute handling.
- Paid cross-border Managed Payments end-to-end account -> Credits -> BytePlus ->
  verified private MP4 -> ledger settlement and refund/dispute acceptance.
- Legal/support, costs, retention, risk alerts, explicit production approvals
  documented in #176/#230/#238.

**Do not** set `BACKUP_RESTORE_EXERCISE_VERIFIED`,
`PRODUCTION_CMS_BACKUP_RESTORE_VERIFIED`, `LEGAL_REVIEW_APPROVED`, or public
launch flags solely because this script exists or passes synthetic CI tests.
The currently working private German owner-paid video path remains unchanged.
