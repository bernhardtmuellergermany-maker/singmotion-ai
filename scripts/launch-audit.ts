import {auditSingMotionLaunch,type ReleaseEnvironment} from "../lib/launch-audit.ts";

const choice=process.argv.find(s=>s==="--staging"||s==="--production");
if(!choice||process.argv.filter(s=>s==="--staging"||s==="--production").length!==1){
 console.error("Usage: node --experimental-strip-types scripts/launch-audit.ts --staging|--production");
 process.exitCode=2;
}else{
 const target=choice==="--production"?"production":"staging" as ReleaseEnvironment;
 const audit=auditSingMotionLaunch(process.env,target);
 for(const gate of audit.gates)
  console.log(`${gate.ready?"PASS":"BLOCK"} ${gate.id}: ${gate.reason}`);
 console.log(`LAUNCH_AUDIT ${JSON.stringify({environment:target,ready:audit.ready,passed:audit.gates.filter(g=>g.ready).length,total:audit.gates.length})}`);
 if(!audit.ready)process.exitCode=1;
}
