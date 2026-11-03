/** Pure evaluation of npm audit JSON. No network, filesystem writes or installs.
 * Incomplete audit reports must never be accepted as a clean dependency graph. */
export function assessProductionDependencyAudit(report) {
 if (!report || typeof report !== "object" || report.error ||
     !report.metadata?.vulnerabilities ||
     !report.vulnerabilities || typeof report.vulnerabilities !== "object" ||
     Array.isArray(report.vulnerabilities))
   throw new Error("Incomplete npm audit response");
 const counts=report.metadata.vulnerabilities;
 for(const field of ["critical","high","moderate","low","total"]) {
  if(!Number.isSafeInteger(counts[field])||counts[field]<0)
   throw new Error("Invalid npm audit severity counts");
 }
 if(counts.total<counts.critical+counts.high+counts.moderate+counts.low)
   throw new Error("Inconsistent npm audit severity counts");
 const order={critical:0,high:1,moderate:2,low:3,info:4};
 const issues=Object.entries(report.vulnerabilities).map(([name,value])=>{
  if(!name||!value||typeof value!=="object"||
     !Object.hasOwn(order,value.severity))
    throw new Error("Unrecognized npm audit advisory");
  return {name,severity:value.severity,direct:value.isDirect===true,
   fixAvailable:value.fixAvailable===true?"patch":value.fixAvailable?"review":"none"};
 }).sort((a,b)=>order[a.severity]-order[b.severity]||a.name.localeCompare(b.name));
 // npm may add advisory records without changing the expected count schema.
 // Never accept an explicit severe advisory when metadata claims zero severe risk.
 if(issues.some(i=>i.severity==="critical")&&counts.critical===0 ||
    issues.some(i=>i.severity==="high")&&counts.high===0)
  throw new Error("Inconsistent high/critical audit advisories");
 return {
  summary:{total:counts.total,critical:counts.critical,high:counts.high,
   moderate:counts.moderate,low:counts.low,top:issues.slice(0,20)},
  blocked:counts.critical>0||counts.high>0,
 };
}
