import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("critical DOMPurify XSS regression cannot enter the locked production dependency graph",()=>{
 const pkg=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8"));
 const lock=JSON.parse(readFileSync(new URL("../package-lock.json",import.meta.url),"utf8"));
 assert.equal(pkg.overrides?.dompurify,"3.4.17");
 const item=lock.packages["node_modules/dompurify"];
 assert.ok(item,"DOMPurify must be present to verify its locked version");
 assert.equal(item.version,"3.4.17");
 assert.equal(item.resolved,"https://registry.npmjs.org/dompurify/-/dompurify-3.4.17.tgz");
 assert.equal(item.integrity,"sha512-B/pSlYVHQ58kqISD/yDjuJ1yfzI34m1gF4lAod2bwSRhiN4K5Cl3H8Af7hqB2PmTL911tdEudnnXn5FnhRoz0w==");
});
