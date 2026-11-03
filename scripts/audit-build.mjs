/** Read-only dependency audit during the Docker builder stage.
 * Advisory lookup does not mutate the lockfile or install dependencies.
 * Network failures never masquerade as a clean audit. */
import {spawnSync} from "node:child_process";
{
 const run=spawnSync("npm",["audit","--json","--omit=dev"],{
  encoding:"utf8",timeout:30000,maxBuffer:8*1024*1024
 });
 if(run.error||!run.stdout){
  console.error("DEPENDENCY_AUDIT unavailable; registry or audit invocation failed");
  process.exitCode=1;
 }else{
  try{
   const report=JSON.parse(run.stdout);
   if(!report.metadata?.vulnerabilities||typeof report.vulnerabilities!=="object")
    throw Error("No audit metadata");
   const counts=report.metadata.vulnerabilities;
   if(!["critical","high","moderate","low","total"].every(key => Number.isSafeInteger(counts[key]) && counts[key]>=0))
    throw Error("Incomplete severity counts");
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
   if(counts.critical>0||counts.high>0){
    console.error("DEPENDENCY_AUDIT gate failed: production high/critical advisories");
    process.exitCode=1;
   }
  }catch{
   console.error("DEPENDENCY_AUDIT unavailable; unparseable or incomplete audit");
   process.exitCode=1;
  }
 }
}
