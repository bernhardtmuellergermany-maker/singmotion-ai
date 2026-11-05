import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const script=fileURLToPath(new URL("../scripts/launch-audit.ts",import.meta.url));
const run=(args:string[])=>spawnSync(process.execPath,["--experimental-strip-types",script,...args],{
 encoding:"utf8",
 env:{
  PATH:process.env.PATH,
  RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d",
  R2_SECRET_ACCESS_KEY:"never-expose-this-private-value",
  PAYLOAD_SECRET:"never-expose-this-cms-value",
 },
});

test("JSON launch audit is parseable, redacted and fail closed",()=>{
 const result=run(["--production","--json"]);
 assert.equal(result.status,1);
 assert.equal(result.stderr,"");
 const report=JSON.parse(result.stdout) as {
  environment:string;ready:boolean;passed:number;total:number;
  gates:Array<{id:string;ready:boolean;reason:string}>;
 };
 assert.equal(report.environment,"production");
 assert.equal(report.ready,false);
 assert.equal(report.total,report.gates.length);
 assert.equal(report.passed,report.gates.filter(g=>g.ready).length);
 assert.equal(report.gates.find(g=>g.id==="code-runtime-readiness")?.ready,false);
 assert.ok(!result.stdout.includes("never-expose-this"));
 assert.ok(!result.stdout.includes("R2_SECRET_ACCESS_KEY"));
 assert.ok(!result.stdout.includes("PAYLOAD_SECRET"));
 assert.ok(!result.stdout.includes("LAUNCH_AUDIT "));
});

test("human-readable audit remains the default and blocked audits exit 1",()=>{
 const result=run(["--staging"]);
 assert.equal(result.status,1);
 assert.match(result.stdout,/BLOCK environment:/);
 assert.match(result.stdout,/LAUNCH_AUDIT /);
 assert.ok(!result.stdout.includes("never-expose-this"));
});

test("invalid and duplicate arguments fail with usage and no audit output",()=>{
 for(const args of [
  [],["--json"],["--production","--staging"],["--production","--production"],
  ["--staging","--json","--json"],["--production","--unexpected"],
 ]){
  const result=run(args);
  assert.equal(result.status,2,args.join(" "));
  assert.match(result.stderr,/Usage:/);
  assert.equal(result.stdout,"");
 }
});
