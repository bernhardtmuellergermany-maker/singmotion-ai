/** Read-only npm production-dependency audit inside the Docker builder.
 * Fail closed if registry access, the audit response or policy verification fails. */
import {spawnSync} from "node:child_process";
import {assessProductionDependencyAudit} from "./audit-policy.mjs";

const run=spawnSync("npm",["audit","--json","--omit=dev"],{
 encoding:"utf8",timeout:30000,maxBuffer:8*1024*1024
});
try {
 if(run.error||!run.stdout||run.signal||![0,1].includes(run.status))
  throw new Error("npm audit process unavailable");
 const {summary,blocked}=assessProductionDependencyAudit(JSON.parse(run.stdout));
 console.log("DEPENDENCY_AUDIT production-only",JSON.stringify(summary));
 if(blocked){
  console.error("DEPENDENCY_AUDIT gate failed: production high/critical advisories");
  process.exitCode=1;
 }
} catch {
 console.error("DEPENDENCY_AUDIT unavailable; registry failure or invalid report");
 process.exitCode=1;
}
