import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

const path=fileURLToPath(new URL("../scripts/offsite-postgres-age.sh",import.meta.url));
const script=readFileSync(path,"utf8");

test("operator PostgreSQL age export is syntactically valid Bash",()=>{
 const result=spawnSync("bash",["-n",path],{encoding:"utf8",timeout:10000});
 assert.equal(result.status,0,result.stderr);
});

test("PostgreSQL command is read-only, transactional, streaming encryption and no raw dump on disk",()=>{
 assert.match(script,/pg_dump --format=custom --no-owner --no-acl/);
 assert.match(script,/age -r "\$AGE_RECIPIENT" -o "\$run_dir\/cms\.dump\.age"/);
 assert.match(script,/set -Eeuo pipefail/);
 assert.match(script,/PGSSLMODE/);
 assert.match(script,/verify-full/);
 assert.match(script,/PGPASSFILE/);
 assert.match(script,/stat -c %a/);
 assert.match(script,/RAILWAY_ENVIRONMENT_ID/);
 assert.match(script,/pg-encrypted-XXXXXXXX/);
 assert.doesNotMatch(script,/pg_restore|DROP DATABASE|TRUNCATE|DELETE FROM|--clean|--if-exists|railway redeploy/);
});

test("PostgreSQL CLI refuses unconfirmed execution in Railway without touching data",()=>{
 const run=spawnSync("bash",[path],{
  env:{...process.env,RAILWAY_ENVIRONMENT_ID:"production"},
  encoding:"utf8",timeout:10000,
 });
 assert.notEqual(run.status,0);
 assert.match(run.stderr,/PRIVATE_OPERATOR_CONFIGURATION_REQUIRED/);
 assert.doesNotMatch(run.stderr,/password|secret|customer|pgpass/i);
});

test("independent offsite workflow is never invoked from customer server startup or worker",()=>{
 for(const p of ["scripts/worker.ts","scripts/container-entrypoint.mjs"]){
  const content=readFileSync(new URL("../"+p,import.meta.url),"utf8");
  assert.doesNotMatch(content,/offsite-r2-backup|offsite-postgres-age/);
 }
});
