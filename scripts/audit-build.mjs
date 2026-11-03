/** Read-only dependency audit during the Docker builder stage.
 * Advisory lookup does not mutate the lockfile or install dependencies.
 * Network failures never masquerade as a clean audit. */
import {spawnSync} from "node:child_process";
{
 const run=spawnSync("npm",["audit","--json","--omit=dev"],{
  encoding:"utf8",timeout:30000,maxBuffer:8*1024*1024
 });
 if(run.error||!run.stdout){
  console.warn("DEPENDENCY_AUDIT unavailable; registry or audit invocation failed");
 }else{
  try{
   const report=JSON.parse(run.stdout);
   if(!report.metadata?.vulnerabilities||typeof report.vulnerabilities!=="object")
    throw Error("No audit metadata");
   const counts=report.metadata.vulnerabilities;
   const exposed=Object.entries(report.vulnerabilities)
    .filter(([,value])=>value&&typeof value==="object")
    .map(([name,value])=>({name,severity:value.severity,direct:!!value.isDirect,
      fixAvailable:value.fixAvailable===true?"patch":value.fixAvailable?"review":"none"}))
    .sort((a,b)=>({critical:0,high:1,moderate:2,low:3}[a.severity]??4)-
                 ({critical:0,high:1,moderate:2,low:3}[b.severity]??4))
    .slice(0,20);
   console.log("DEPENDENCY_AUDIT production-only",JSON.stringify({
    total:counts.total,critical:counts.critical,high:counts.high,
    moderate:counts.moderate,low:counts.low,top:exposed
   }));
  }catch{
   console.warn("DEPENDENCY_AUDIT unavailable; unparseable or incomplete audit");
  }
 }
}
