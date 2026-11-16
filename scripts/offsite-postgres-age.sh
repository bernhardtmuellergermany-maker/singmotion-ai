#!/usr/bin/env bash
# Operator-only encrypted, transaction-consistent PostgreSQL logical snapshot.
# No changes to the source DB; plaintext never written to disk.
# On success, transfer the .age file to independently protected offsite storage.
set -Eeuo pipefail
umask 077

fail() {
  printf '%s\n' 'PG_OFFSITE_ENCRYPTED_EXPORT {"ok":false,"code":"PRIVATE_OPERATOR_CONFIGURATION_REQUIRED"}' >&2
  exit 1
}

[[ $# -eq 1 && "$1" == "--confirm-readonly-encrypted-pg-export" ]] || fail
[[ "$(id -u)" != "0" ]] || fail
[[ ! -v RAILWAY_ENVIRONMENT_ID ]] || fail
[[ "$PG_EXPORT_PRIVACY_AND_STORAGE_APPROVED" == "YES" ]] || fail
[[ "$PGSSLMODE" == "verify-full" ]] || fail
[[ -n "$PGHOST" && -n "$PGDATABASE" && -n "$PGUSER" ]] || fail
[[ "$AGE_RECIPIENT" == age1* ]] || fail
[[ -n "$PGPASSFILE" && -f "$PGPASSFILE" && ! -L "$PGPASSFILE" ]] || fail
[[ "$PG_EXPORT_PRIVATE_DIR" == /* ]] || fail
[[ -d "$PG_EXPORT_PRIVATE_DIR" && ! -L "$PG_EXPORT_PRIVATE_DIR" ]] || fail
[[ "$(stat -c %u -- "$PG_EXPORT_PRIVATE_DIR")" == "$(id -u)" ]] || fail
[[ "$(stat -c %a -- "$PG_EXPORT_PRIVATE_DIR")" == "700" ]] || fail
[[ "$(stat -c %u -- "$PGPASSFILE")" == "$(id -u)" ]] || fail
[[ "$(stat -c %a -- "$PGPASSFILE")" == "600" ]] || fail

command -v pg_dump >/dev/null || fail
command -v age >/dev/null || fail
command -v sha256sum >/dev/null || fail

run_dir=$(mktemp -d "$PG_EXPORT_PRIVATE_DIR/pg-encrypted-XXXXXXXX")
[[ -d "$run_dir" ]] || fail
success=0
cleanup() {
  if [[ "$success" != "1" ]]; then
    rm -rf -- "$run_dir"
  fi
}
trap cleanup EXIT
# pg_dump custom archive to stdout -> authenticated age encryption.
# Do not echo command lines with credentials. Export reads only, no writes.
if ! pg_dump --format=custom --no-owner --no-acl 2>/dev/null | \
     age -r "$AGE_RECIPIENT" -o "$run_dir/cms.dump.age" >/dev/null 2>&1; then
  fail
fi
[[ -s "$run_dir/cms.dump.age" ]] || fail
(
 cd "$run_dir"
 sha256sum -- cms.dump.age > cms.dump.age.sha256
)
success=1
printf '%s\n' 'PG_OFFSITE_ENCRYPTED_EXPORT {"ok":true,"encrypted":true,"files":1,"offsiteTransfer":"REQUIRED","isolatedRestore":"REQUIRED"}'
