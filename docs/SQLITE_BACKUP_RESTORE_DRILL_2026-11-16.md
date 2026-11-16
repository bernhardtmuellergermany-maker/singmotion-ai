# 2026-11-16 — Production backup and restore: evidence and next gates

**Status: PARTIAL / PUBLIC RELEASE STILL BLOCKED.** The owner successfully exercised private Production Stripe-LIVE prepaid Credits → BytePlus → private MP4 → wallet settlement. The Production readonly Credit ledger integrity audit returned `ok:true` on 16 Nov. Neither success replaces a recoverable offsite backup.

## Verified Railway inventory (read-only)

- Project `96ab3402-f974-4cdf-b9a3-408443b17025`, Production `36adc41d-7e54-4396-ad1a-fd432ba0441d`.
- `singmotion-ai` uses a 5,000-MB persistent volume `singmotion-ai-volume` at `/app/.data`.
- PostgreSQL / Payload uses a separate 500-MB persistent `postgres-volume` at `/var/lib/postgresql/data`.
- Customer media uses private Cloudflare R2 outside Railway; no Railway-managed bucket exists in this project.
- The installed Railway OAuth connector exposes inventory and volume changes but **does not** expose a non-destructive existing-volume snapshot/restore action. Do not use `create_volume`, `update_volume` or `delete_volume` as backup methods, and never detach or replace the live mount.
- As of this report, an encrypted offsite backup, an actual restore and RPO/RTO **have not been independently verified**.

## SQLite disaster-recovery rehearsal (new)

The `npm run restore:sqlite-drill` command is an **explicit operator-only** tool. On the already trusted host as nonroot with `DATA_DIR` set to an absolute private source directory, it:

1. Opens the existing `commerce.sqlite`, `live-test.sqlite` and `demo.sqlite` read-only (refuses nonregular or symlinked files).
2. Uses Node's native SQLite **online backup** API to create consistent independent temporary snapshots including committed WAL data. Never copy a live `.sqlite` file with `cp` without its WAL state.
3. Opens each restored snapshot read-only, runs SQLite `quick_check`; on `commerce.sqlite` also runs the existing exactly-once Credit integrity audit.
4. Cleans temporary snapshots even on validation failures and returns only fixed diagnostic codes. It never reads out passwords, names, purchased amounts, checkout sessions or provider URLs.

**Operational usage:** From a trusted private command session on an isolated machine or service, with sufficient trusted ephemeral storage and no public file-serving path, set `DATA_DIR` and execute `npm run restore:sqlite-drill`. The command refuses root and requires `--confirm-ephemeral-private-copy` through the npm script. Review `SQLITE_RESTORE_DRILL` `ok:true` plus the three checked database names.

**Important limitations:** This routine is intentionally **not** executed automatically on Production and **does not persist an offsite archive**. Its temporary snapshots contain private records until cleanup. Do not run on shared/untrusted `/tmp` hosts, and do not use its PASS result as proof of offsite recoverability, Postgres restore, R2 recovery or authorization for public sales. Automated Docker tests use only generated synthetic SQLite fixture data.

## Remaining work before claiming backup and restore READY

- Create an operator-owned, encrypted **offsite** backup of all three Production SQLite DBs using WAL-safe snapshots, with restricted access, integrity manifest, date, retention and tested key recovery.
- Back up PostgreSQL using a transaction-consistent `pg_dump` or managed snapshot into an independent encrypted destination. Verify CMS migration state, staff access, content and a recovery against an **isolated** Postgres database, not the live instance.
- Prove private Cloudflare R2 media and metadata can be restored (or recovered from independent versioned copies), including authenticated range playback and cross-customer access denial. Don't create public buckets.
- Run an isolated cross-store restore exercise on copies with no LIVE Stripe keys, provider billing or emails, document tested RPO/RTO and rollback instructions.
- Only after recorded evidence should `BACKUP_RESTORE_EXERCISE_VERIFIED`, `PRODUCTION_CMS_BACKUP_RESTORE_VERIFIED` or related public-release approvals be set. Existing working private Production Credit and video generation must remain unchanged.

Tracking: #176 and #230.
