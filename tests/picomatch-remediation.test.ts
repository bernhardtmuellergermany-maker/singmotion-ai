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
 assert.equal(pkg.overrides.picomatch,"npm:@rootio/picomatch@2.3.2-root.io.1");
 assert.equal(pkg.overrides.tinyglobby.picomatch,"npm:@rootio/picomatch@4.0.7-root.io.1");
 const two=lock.packages["node_modules/picomatch"];
 const four=lock.packages["node_modules/tinyglobby/node_modules/picomatch"];
 for(const [node,major,revision] of [[two,"2.3.2","2.3.2-root.io.1"],[four,"4.0.7","4.0.7-root.io.1"]] as const){
  assert.ok(node,"patched picomatch must be present for "+major);
  assert.equal(node.version,revision);
  assert.match(node.resolved,/registry\.npmjs\.org\/@rootio\/picomatch\/.*\.tgz/);
  assert.ok(node.integrity?.startsWith("sha512-"),"must retain registry integrity");
 }
 assert.equal(appRequire("picomatch/package.json").name,"@rootio/picomatch");
 assert.equal(tinyglobbyRequire("picomatch/package.json").name,"@rootio/picomatch");
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
