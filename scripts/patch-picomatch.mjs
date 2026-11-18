/** 
 * SingMotion security backport for CVE-2026-112366 on pinned @ryotsu/picomatch.
 * The published 4.0.7-a fork fixes single-branch extglob repeats.
 * An additional ambiguous multi-branch case like +(a|*a) must be rejected too.
 * This conservative backport literalizes repeated multi-branch wildcard
 * extglobs, keeping well-defined normal glob patterns unchanged.
 *
 * This is an independently testable, fail-closed transformation of the actual
 * installed dependency — NOT an npm-audit suppression or a version spoof.
 */
import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
const root=process.cwd();
const read=(path)=>readFileSync(resolve(root,path),"utf8");
const declared=JSON.parse(read("package.json"));
const lock=JSON.parse(read("package-lock.json"));
if(declared.overrides?.picomatch!=="npm:@ryotsu/picomatch@4.0.7-a") {
 throw Error("CVE-PATCH-LOCK: unexpected picomatch dependency override");
}
const entry=lock.packages?.["node_modules/picomatch"];
if(entry?.version!=="4.0.7-a" ||
   entry?.resolved!=="https://registry.npmjs.org/@ryotsu/picomatch/-/picomatch-4.0.7-a.tgz" ||
   !entry?.integrity?.startsWith("sha512-")){
 throw Error("CVE-PATCH-LOCK: missing verified registry package integrity");
}
const installed=JSON.parse(read("node_modules/picomatch/package.json"));
if(installed.name!=="@ryotsu/picomatch"||installed.version!=="4.0.7-a"){
 throw Error("CVE-PATCH-LOCK: unexpected installed package");
}
const path=resolve(root,"node_modules/picomatch/lib/parse.js");
const source=readFileSync(path,"utf8");
const anchor="  const branches = splitTopLevel(body).map(branch => branch.trim());\n\n  if (branches.length > 1) {";
const marker="  // SINGMOTION-CVE-2026-112366-MULTIBRANCH";
const replacement=`  const branches = splitTopLevel(body).map(branch => branch.trim());

${marker}
  // A repeated alt with a star may compile a nested unbounded regexp such as
  // +(a|*a) -> (?:a|[^/]*?a)+. Fail closed instead of blocking the event loop.
  // Regular single-branch stars are handled by the pinned security fork.
  if (branches.length > 1 && branches.some(branch => analyzeStarBranch(branch).star)) {
    return { risky: true };
  }

  if (branches.length > 1) {`;
if(source.includes(marker)){
 if(!source.includes("branches.some(branch => analyzeStarBranch(branch).star)")) {
  throw Error("CVE-PATCH-LOCK: unexpected existing patch content");
 }
 console.log("PICOMATCH_CVE_BACKPORT_ALREADY_APPLIED");
}else{
 if(source.split(anchor).length!==2)throw Error("CVE-PATCH-LOCK: unexpected upstream source layout");
 writeFileSync(path,source.replace(anchor,replacement));
 console.log("PICOMATCH_CVE_BACKPORT_APPLIED");
}
