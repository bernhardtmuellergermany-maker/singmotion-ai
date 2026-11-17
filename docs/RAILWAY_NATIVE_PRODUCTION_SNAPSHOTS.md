# Railway Native Production Snapshots — controlled operator run

This is the first recovery layer for SingMotion. It does NOT complete issue #230.

The script scripts/railway-production-native-snapshots.mjs checks the two actual
Production volume IDs, service IDs, environment ID and mount paths, reads existing
snapshots, and fails closed on mismatches. It never invokes a Restore mutation.

Run on a trusted Node 24 operator host without Codex:

1. Supply a secret Railway project token scoped to Production as RAILWAY_TOKEN
   through a trusted secrets facility, NOT in a commit, chat or log.
   (An account/workspace RAILWAY_API_TOKEN is supported but less restricted.)
2. Read-only preflight:
   node scripts/railway-production-native-snapshots.mjs --plan
3. Only after confirming the two exact targets, set
   SINGMOTION_NATIVE_SNAPSHOT_APPROVAL=CREATE_TWO_NATIVE_PRODUCTION_VOLUME_SNAPSHOTS
   in the private operator environment, then execute ONCE:
   node scripts/railway-production-native-snapshots.mjs --create
4. Record observed backup IDs, verify each in the Railway Backups dashboard,
   and enable daily/weekly/monthly schedules there after review.

The current ChatGPT Railway integration cannot execute GraphQL native volume backup
mutations or obtain the Railway project token. A GitHub merge does not create the
snapshots. Never repeat a possibly successful mutation after a network failure
before inspecting the Railway dashboard for actual backups.

The backups are Railway-local, NOT independently encrypted HiDrive offsite archives.
Do not restore them to Production to test them. Do not mark backup release flags
until real encrypted Production SQLite/Postgres/R2 snapshots and an isolated restore
have been verified. See issue #230 and docs/PRODUCTION_CROSS_STORE_RECOVERY_2026-11-16.md.

Official API: https://docs.railway.com/integrations/api/manage-volumes
