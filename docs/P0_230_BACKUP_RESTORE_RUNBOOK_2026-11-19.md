# P0 #230 – Backup / Restore: verified state and operator runbook
Date: 2026-11-19. Source of previous evidence: issue #230 owner-reported offline tests. This document is not an independent DR certification.

## Confirmed from existing owner reports
- Offsite HiDrive encrypted snapshot: 690/690 ciphertext objects, signed receipt / authenticated manifest / 689 AEAD segments and 533/533 recovered private files verified against recorded hashes.
- Native SQLite integrity/foreign keys: 3/3 databases, plus Commerce Credit Ledger invariants PASS.
- Native isolated PostgreSQL 18.7 restore: pg_restore exit 0, 34/34 tables, 47 aggregate rows, 0 invalidated constraints.
- Media: signed 398 R2 objects and 131 local files re-read SHA and range checks; 527/527 recognized media decoded with ffprobe/ffmpeg, two other content signatures not yet categorized.
- These are **owner-reported results** from an offline private Windows workstation, not a public Railway application restore.

## Observed state verified 2026-11-19
- **Independent offsite HiDrive readback: PASS.** Isolated restore-worker-private deployment 074e7f7f-2287-4459-9dd0-1d9c5a0cb6a4 logged RESTORE_RO_FULL_CIPHERTEXT_READBACK_PASS: exact encrypted COMMITTED receipt, pinned manifest and all 689 encrypted segments verified by authenticated read-only API fetch and SHA-256, totaling 690/690 objects. Details: #230 issue comment 7020136339. No source data decrypted in Railway.
- **Railway daily volume backups:** owner reports these already run; the connected Railway app cannot independently attest their daily schedule and successful volume snapshots. Do not modify them for weekly HiDrive.
- **Production HiDrive:** singmotion-backup is a one-shot private ciphertext receiver, not a scheduled source-data producer. Its Railway service configuration has no cronSchedule; app service singmotion-ai has no cronSchedule. A cron on the receiver alone does not create a new snapshot.
- **Owner-approved weekly objective:** new independent encrypted HiDrive snapshot every 7 days, <=EUR 10/month additional total; Sunday 03:00 UTC as proposed timing, with 24h retry grace. No working weekly source producer has been deployed; do not claim that weekly backups are running.

## Safe order to reach actual P0 acceptance
1. Operator: from trusted Railway service Console only, provision the verified user,ro HiDrive OAuth rclone config as a local **0600 file owned by the non-root worker**; do not place secrets in logs, GitHub or chat. Validate which mode, remote and account the grant authorizes. No unreviewed source credentials.
2. Operator: execute `node /opt/singmotion/scripts/hidrive-readonly-commit-preflight.mjs --manifest-only` in this isolated worker (not Production). Capture only sanitized PASS/FAIL, receipt identity, count/hashes and execution timestamp. Check actual exit code = 0. Only separately authorize `--all-ciphertext` if the new full-read scope and spend are explicitly approved.
3. Perform full recovery into **isolated databases and media** using the owner-held RSA private key, without copying live Stripe/BytePlus/R2 credentials or exposing customer plaintext. Re-run native SQLite integrity/foreign keys, Credit Ledger audit, isolated PG native import/catalog checks, and private object/media hashes.
4. Run isolated app acceptance against restored data with synthetic/isolated identities: private MP4 complete GET and HTTP Range; cross-account access denial; no duplicate worker dispatch or Stripe/provider side effects; orphan task reconciliation. A local `File.slice` check does not prove R2 HTTP or authorization.
5. Measure actual backup creation time, recovery timestamp, drill duration (RPO/RTO); document original-name mapping and the two unclassified objects' intended role privately.
6. Implement and test a **separate every-seven-days source-data producer** that consistently snapshots SQLite/Postgres/R2, encrypts and sends bounded immutable snapshots, verifies remote COMMITTED receipts, applies retention, detects stale/missing backups, and alerts. Receiver startup or one historic receipt does **not** fulfill this requirement. Respect the previously documented €10 **total additional-cost cap** and obtain a verified cost bound before any new long-running/scheduled transfer.
7. Only if the above independent checks PASS, record audit evidence and then review `BACKUP_RESTORE_EXERCISE_VERIFIED`, `PRODUCTION_CMS_BACKUP_RESTORE_VERIFIED` and other public-release gates. Do not mark them true from synthetic tests or owner-reported metadata alone.

## Safety and deployment
- No public endpoints, no new live charges, no paid provider generation.
- No production volume/bucket replacement, no migration of real customers into untrusted sandbox.
- Keep `www.singmotion.ai` password protected.
- This is a review/runbook change only; **backup P0 is OPEN** until actual executable steps and independent evidence are recorded in issue #230.
