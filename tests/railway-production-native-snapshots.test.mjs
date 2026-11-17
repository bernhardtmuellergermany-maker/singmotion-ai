import test from "node:test";
import assert from "node:assert/strict";
import {run,PROJECT,ENVIRONMENT,TARGETS,client} from "../scripts/railway-production-native-snapshots.mjs";
function fixture(){
 const calls=[],snapshots=[[],[]],ids=["instance1","instance2"];
 async function query(text,v){
  calls.push(text);
  if(text.includes("project(id:"))return {project:{id:PROJECT,volumes:{edges:TARGETS.map((t,i)=>({
   node:{id:t.volumeId,name:t.name,volumeInstances:{edges:[{node:{id:ids[i],
    environmentId:ENVIRONMENT,serviceId:t.serviceId}}]}}}))}}};
  if(text.includes("volumeInstance(id:")){
   const i=ids.indexOf(v.id),t=TARGETS[i];
   return {volumeInstance:{id:v.id,state:"READY",mountPath:t.mount,
    volume:{id:t.volumeId,name:t.name}}};
  }
  const i=ids.indexOf(v.volumeInstanceId);
  if(text.startsWith("mutation(")){snapshots[i].push({id:"new"+i,createdAt:"2026-11-17"});return {volumeInstanceBackupCreate:true};}
  return {volumeInstanceBackupList:snapshots[i]};
 }
 return {query,calls,snapshots};
}
test("plan is read-only and targets only two exact Production volumes",async()=>{
 const f=fixture(),r=await run({query:f.query});
 assert.equal(r.status,"plan_only");
 assert.equal(r.volumes.length,2);
 assert.equal(f.calls.some(x=>x.startsWith("mutation(")),false);
});
test("write is rejected before any GraphQL activity without explicit approval",async()=>{
 const f=fixture();
 await assert.rejects(run({query:f.query,create:true}),/SNAPSHOT_APPROVAL_REQUIRED/);
 assert.equal(f.calls.length,0);
});
test("two native snapshots recorded with distinct backup IDs",async()=>{
 const f=fixture();
 const r=await run({query:f.query,create:true,
  approval:"CREATE_TWO_NATIVE_PRODUCTION_VOLUME_SNAPSHOTS",pause:async()=>{}});
 assert.equal(r.status,"native_snapshots_observed");
 assert.deepEqual(r.backups.map(x=>x.backupId),["new0","new1"]);
 assert.equal(r.independentOffsiteRestoreVerified,false);
 assert.equal(f.calls.filter(x=>x.startsWith("mutation(")).length,2);
});
test("project token is sent only through scoped Project-Access-Token header",async()=>{
 const req=[];
 await client({RAILWAY_TOKEN:"test"},async(url,opts)=>{
  req.push(opts);return {ok:true,json:async()=>({data:{ok:true}})};
 })("query { ok }",{});
 assert.equal(req[0].headers["Project-Access-Token"],"test");
 assert.equal(req[0].headers.Authorization,undefined);
});
