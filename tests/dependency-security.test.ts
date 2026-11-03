import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import sharp from "sharp";

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

test("patched sharp version loads its packaged libvips and can convert and resize a customer image",async()=>{
 const pkg=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8"));
 const lock=JSON.parse(readFileSync(new URL("../package-lock.json",import.meta.url),"utf8"));
 assert.equal(pkg.dependencies.sharp,"0.35.5");
 assert.equal(lock.packages[""].dependencies.sharp,"0.35.5");
 assert.equal(lock.packages["node_modules/sharp"].version,"0.35.5");
 assert.equal(lock.packages["node_modules/@img/sharp-linux-x64"].version,"0.35.5");
 assert.equal(lock.packages["node_modules/@img/sharp-libvips-linux-x64"].version,"1.3.4");
 const input=await sharp({create:{width:4,height:3,channels:3,background:{r:20,g:40,b:60}}}).png().toBuffer();
 const output=await sharp(input).resize(8,6).png().toBuffer();
 const metadata=await sharp(output).metadata();
 assert.equal(metadata.format,"png");
 assert.equal(metadata.width,8);
 assert.equal(metadata.height,6);
});

import {assessProductionDependencyAudit} from "../scripts/audit-policy.mjs";

test("npm audit policy accepts complete low/moderate reports but never overlooks severe findings",()=>{
 const report=(counts:Record<string,number>,issues:Record<string,unknown>={})=>({
  metadata:{vulnerabilities:{critical:0,high:0,moderate:0,low:0,total:0,...counts}},
  vulnerabilities:issues
 });
 const moderate=assessProductionDependencyAudit(report({moderate:1,total:1},{
  "example-transitive-lib":{severity:"moderate",isDirect:false,fixAvailable:true}
 }));
 assert.equal(moderate.blocked,false);
 assert.equal(moderate.summary.moderate,1);
 assert.deepEqual(moderate.summary.top,[{
  name:"example-transitive-lib",severity:"moderate",direct:false,fixAvailable:"patch"
 }]);
 assert.equal(assessProductionDependencyAudit(report({high:1,total:1},{
  "unsafe-sharp":{severity:"high",isDirect:true,fixAvailable:false}
 })).blocked,true);
 assert.equal(assessProductionDependencyAudit(report({critical:1,total:1},{
  "critical-html-parser":{severity:"critical",isDirect:false}
 })).blocked,true);
});
test("npm audit policy fails closed on missing, inconsistent or malformed reports",()=>{
 const report=(counts:Record<string,number>,issues:Record<string,unknown>={})=>({
  metadata:{vulnerabilities:{critical:0,high:0,moderate:0,low:0,total:0,...counts}},
  vulnerabilities:issues
 });
 for(const invalid of [
  null,{}, {error:{code:"ENOAUDIT"}},
  {metadata:{vulnerabilities:{critical:0,high:0,moderate:0,low:0,total:0}}},
  report({critical:-1}), report({high:NaN}),report({moderate:1,total:0}),
  report({critical:0,high:0,total:0},{"unsafe":{severity:"high"}}),
  report({critical:0,high:0,total:0},{"unknown":{severity:"urgent"}}),
 ])assert.throws(()=>assessProductionDependencyAudit(invalid),undefined,JSON.stringify(invalid));
});
