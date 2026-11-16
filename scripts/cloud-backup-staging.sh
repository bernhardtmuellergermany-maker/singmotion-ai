#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
# Exact environment and explicit fixture mode. Never connect to the existing PG
# service or mount existing staging data; native PG runs on a disposable socket.
node --input-type=module -e 'import {syntheticOnly} from "./lib/ops/cloud-backup.mjs"; syntheticOnly(process.env)'
export BACKUP_NATIVE_PG_TEST=YES
fixture_pg=$(mktemp -d /tmp/sm-pg-XXXXXXXX)
trap 'pg_ctl -D "$fixture_pg" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$fixture_pg"' EXIT
initdb -D "$fixture_pg" -A trust -U fixture --no-locale >/dev/null
pg_ctl -D "$fixture_pg" -o "-c listen_addresses='' -k /tmp" -l "$fixture_pg/server.log" -w start >/dev/null
createdb -h /tmp -U fixture backup_fixture
psql -h /tmp -U fixture -d backup_fixture -v ON_ERROR_STOP=1 -c "CREATE TABLE fixture_content(id integer PRIMARY KEY, title text); INSERT INTO fixture_content VALUES (1,'synthetic-one'),(2,'synthetic-two'),(3,'synthetic-three');" >/dev/null
node --experimental-strip-types --test tests/cloud-backup.test.mjs
