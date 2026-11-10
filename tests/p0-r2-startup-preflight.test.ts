import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const code=readFileSync(new URL("../scripts/serve.mjs",import.meta.url),"utf8");
test("P0 production R2 one-shot diagnostic runs only after healthy web/worker startup",()=>{
 const web=code.indexOf("const web = spawn(");
 const worker=code.indexOf("const worker = spawn(");
 const canary=code.indexOf('console.log("PRODUCTION_R2_WRITE_PREFLIGHT started")');
 assert.ok(web>0 && worker>web && canary>worker,"R2 network probe must not stall the public app before startup");
 assert.match(code,/if \(process\.env\.PRODUCTION_R2_WRITE_PREFLIGHT_ENABLED === "true"\)/);
 assert.match(code,/void import\("\.\/production-r2-write-preflight\.ts"\)/);
 assert.match(code,/PRODUCTION_R2_WRITE_PREFLIGHT blocked/);
 assert.match(code,/productionR2WritePreflight\(\)/);
});
test("P0 R2 canary has isolated random key and deletes the test object",()=>{
 const src=readFileSync(new URL("../scripts/production-r2-write-preflight.ts",import.meta.url),"utf8");
 assert.match(src,/singmotion-private-preflight\/v1\/.*randomUUID/);
 assert.match(src,/PutObjectCommand/);
 assert.match(src,/GetObjectCommand/);
 assert.match(src,/DeleteObjectCommand/);
 assert.match(src,/return verified&&deleted\?"verified":"blocked"/);
});
