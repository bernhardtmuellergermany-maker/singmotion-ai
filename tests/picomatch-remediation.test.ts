import {test} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";

const appRequire=createRequire(import.meta.url);
const tinyglobbyRequire=createRequire(new URL("../node_modules/tinyglobby/package.json",import.meta.url));
const pkg=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8"));
const lock=JSON.parse(readFileSync(new URL("../package-lock.json",import.meta.url),"utf8"));

test("published security fork is pinned, integrity-checked, and installed throughout dependency graph",()=>{
 assert.equal(pkg.overrides.picomatch,"npm:@ryotsu/picomatch@4.0.7-a");
 const installs=Object.entries(lock.packages).filter(([path])=>path.endsWith("/node_modules/picomatch")||path==="node_modules/picomatch");
 assert.ok(installs.length>=1);
 for(const [path,entry] of installs){
  const item=entry as {version:string;resolved:string;integrity:string};
  assert.equal(item.version,"4.0.7-a",path);
  assert.match(item.resolved,/registry\\.npmjs\\.org\\/@ryotsu\\/picomatch/,path);
  assert.match(item.integrity,/^sha512-/,path);
 }
 assert.equal(appRequire("picomatch/package.json").name,"@ryotsu/picomatch");
 assert.equal(tinyglobbyRequire("picomatch/package.json").name,"@ryotsu/picomatch");
});

test("micromatch 4 remains compatible with the patched matcher",()=>{
 const micromatch=appRequire("micromatch");
 assert.deepEqual(micromatch(["src/a.ts","src/b.ts","test/a.ts"],["src/**/*.ts"]),["src/a.ts","src/b.ts"]);
 assert.equal(micromatch.isMatch("a/bar.js","**/*.js"),true);
 assert.equal(micromatch.isMatch("a/bar.ts","**/*.js"),false);
});

test("patched parsers preserve normal path glob matching",()=>{
 for(const req of [appRequire,tinyglobbyRequire]){
  const matcher=req("picomatch");
  assert.equal(matcher.isMatch("movie.mp4","*.mp4"),true);
  assert.equal(matcher.isMatch("movie.mp4","*.png"),false);
  assert.equal(matcher.isMatch("subdir/movie.mp4","**/*.mp4"),true);
  assert.equal(matcher.isMatch("file.wav","file.*"),true);
 }
});

test("CVE-2026-112366 ReDoS payloads cannot monopolize the Node event loop",()=>{
 const targets=[appRequire.resolve("picomatch"),tinyglobbyRequire.resolve("picomatch")];
 for(const modulePath of targets){
  const code=`
const assert=require("node:assert/strict");
const pm=require(${JSON.stringify(modulePath)});
for(const pattern of ["+(*a)","*(*a)","+(a|*a)"]){
  const haystack="a".repeat(44)+"!";
  assert.equal(pm.isMatch(haystack,pattern),false,pattern);
}
`;
  assert.doesNotThrow(()=>execFileSync(process.execPath,["-e",code],{
    timeout:2000,windowsHide:true,stdio:["ignore","pipe","pipe"]
  }),"CVE must not cause runaway backtracking for "+modulePath);
 }
});
