import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const script=readFileSync(new URL("../scripts/cms-deploy-migrate.ts",import.meta.url),"utf8");
const config=readFileSync(new URL("../cms/config.ts",import.meta.url),"utf8");
const pkg=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8"));
test("Railway CMS pre-deploy migrations run only against an explicitly enabled CMS service",()=>{
 assert.equal(pkg.scripts["cms:migrate:deploy"],"tsx scripts/cms-deploy-migrate.ts");
 assert.match(script,/RAILWAY_SERVICE_ID/);
 assert.match(script,/RAILWAY_ENVIRONMENT_ID/);
 assert.match(script,/CMS_ENABLED !== "true"/);
 assert.match(script,/!process\.env\.CMS_DATABASE_URL/);
 assert.match(config,/push: false/);
 assert.match(config,/disableCreateDatabase: true/);
});
test("CMS migration exit waits for confirmed adapter success and closed DB pool",()=>{
 assert.match(script,/await payload\.db\.migrate\(\)/);
 assert.match(script,/finally \{\s*await payload\.destroy\(\)/);
 assert.match(script,/process\.exit\(0\)/);
 assert.ok(script.indexOf("process.exit(0)") > script.indexOf("await payload.destroy()"));
 assert.doesNotMatch(script,/migrateFresh|migrateReset|migrateDown|db\.push\(/);
 assert.doesNotMatch(script,/catch\s*\([^)]*\)\s*\{\s*process\.exit\(0\)/);
});
