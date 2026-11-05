import {auditSingMotionLaunch,type ReleaseEnvironment} from "../lib/launch-audit.ts";

// A machine-readable report is useful for CI, but never includes environment
// values, credentials, or evidence identifiers.
const args=process.argv.slice(2);
const targets=args.filter(s=>s==="--staging"||s==="--production");
const json=args.includes("--json");
const valid=args.every(s=>["--staging","--production","--json"].includes(s))&&
 targets.length===1&&new Set(args).size===args.length;

if(!valid){
 console.error("Usage: node --experimental-strip-types scripts/launch-audit.ts --staging|--production [--json]");
 process.exitCode=2;
}else{
 const target:ReleaseEnvironment=targets[0]==="--production"?"production":"staging";
 const audit=auditSingMotionLaunch(process.env,target);
 const summary={environment:target,ready:audit.ready,passed:audit.gates.filter(g=>g.ready).length,total:audit.gates.length};
 if(json){
  console.log(JSON.stringify({...summary,gates:audit.gates}));
 }else{
  for(const gate of audit.gates)
   console.log(`${gate.ready?"PASS":"BLOCK"} ${gate.id}: ${gate.reason}`);
  console.log(`LAUNCH_AUDIT ${JSON.stringify(summary)}`);
 }
 if(!audit.ready)process.exitCode=1;
}
