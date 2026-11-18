import {test} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";

const appRequire=createRequire(import.meta.url);
const tinyglobbyRequire=createRequire(new URL("../node_modules/tinyglobby/package.json",import.meta.url));
const pkg=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8"));
const lock=JSON.parse(readFileSync(new URL("../package-lock.json",import.meta.url),"utf8"));

test("actual security-patched picomatch packages are installed for BOTH major dependency paths",()=>{
 assert.equal(pkg.overrides.picomatch,"github:sxnistxr/picomatch#f03bec2c02e46f063fbfdc161aae1d0f854b2565");
 assert.equal(pkg.overrides.tinyglobby.picomatch,"npm:@ryotsu/picomatch@4.0.7-a");
 const two=lock.packages["node_modules/picomatch"];
 const four=lock.packages["node_modules/tinyglobby/node_modules/picomatch"];
 assert.ok(two,"patched v2 picomatch must be installed");
 assert.equal(two.version,"2.3.2");
 assert.match(two.resolved,/github\.com\/sxnistxr\/picomatch/);
 assert.match(two.resolved,/f03bec2c02e46f063fbfdc161aae1d0f854b2565/);
 assert.ok(four,"patched v4 picomatch must be installed");
 assert.equal(four.version,"4.0.7-a");
 assert.match(four.resolved,/registry\.npmjs\.org\/@ryotsu\/picomatch/);
 assert.ok(four.integrity?.startsWith("sha512-"));
 assert.equal(appRequire("picomatch/package.json").version,"2.3.2");
 assert.equal(tinyglobbyRequire("picomatch/package.json").name,"@ryotsu/picomatch");
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
