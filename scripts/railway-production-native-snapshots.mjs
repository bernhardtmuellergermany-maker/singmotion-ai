import path from "node:path";
import {pathToFileURL} from "node:url";

/** Production-only Railway native snapshots; never restores or exports data. */
export const PROJECT="96ab3402-f974-4cdf-b9a3-408443b17025";
export const ENVIRONMENT="36adc41d-7e54-4396-ad1a-fd432ba0441d";
export const TARGETS=Object.freeze([
 {volumeId:"e27c9de5-a4b8-4bf9-8830-b67f4695951b",name:"singmotion-ai-volume",serviceId:"2c6bca77-61e6-4ab5-9447-fa23767622aa",mount:"/app/.data"},
 {volumeId:"8953c9fa-a3e9-4b29-b377-f442908699f5",name:"postgres-volume",serviceId:"10a10398-e2b8-45bf-a8f5-298999904358",mount:"/var/lib/postgresql/data"},
]);
const QUERY="query($id:String!){project(id:$id){id volumes{edges{node{id name volumeInstances{edges{node{id environmentId serviceId}}}}}}}}";
const INFO="query($id:String!){volumeInstance(id:$id){id state mountPath volume{id name}}}";
const LIST="query($volumeInstanceId:String!){volumeInstanceBackupList(volumeInstanceId:$volumeInstanceId){id createdAt}}";
const CREATE="mutation($volumeInstanceId:String!){volumeInstanceBackupCreate(volumeInstanceId:$volumeInstanceId)}";

export function client(env,request=fetch) {
 const project=env.RAILWAY_TOKEN,account=env.RAILWAY_API_TOKEN;
 if(!project&&!account)throw Error("RAILWAY_AUTH_REQUIRED");
 const auth=project?{"Project-Access-Token":project}:{Authorization:"Bearer "+account};
 return async (query,variables)=>{
  const r=await request("https://backboard.railway.com/graphql/v2",{
   method:"POST",headers:{"Content-Type":"application/json",...auth},
   body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(25000)});
  if(!r.ok)throw Error("RAILWAY_REQUEST_FAILED");
  const v=await r.json();
  if(v.errors?.length||!v.data)throw Error("RAILWAY_QUERY_FAILED");
  return v.data;
 };
}
export async function run({query,create=false,approval="",pause=ms=>new Promise(r=>setTimeout(r,ms))}){
 if(create&&approval!=="CREATE_TWO_NATIVE_PRODUCTION_VOLUME_SNAPSHOTS")
  throw Error("SNAPSHOT_APPROVAL_REQUIRED");
 const project=(await query(QUERY,{id:PROJECT})).project;
 if(project?.id!==PROJECT)throw Error("WRONG_PROJECT");
 const volumes=project.volumes?.edges?.map(x=>x.node);
 if(!Array.isArray(volumes))throw Error("INCOMPLETE_VOLUME_LIST");
 const plan=[];
 for(const expected of TARGETS){
  const matches=volumes.filter(x=>x.id===expected.volumeId&&x.name===expected.name);
  if(matches.length!==1)throw Error("VOLUME_DRIFT");
  const refs=matches[0].volumeInstances?.edges?.map(x=>x.node);
  if(!Array.isArray(refs))throw Error("INSTANCE_LIST_MISSING");
  const i=refs.filter(x=>x.environmentId===ENVIRONMENT&&x.serviceId===expected.serviceId);
  if(i.length!==1||!i[0].id)throw Error("INSTANCE_DRIFT");
  const id=i[0].id,detail=(await query(INFO,{id})).volumeInstance;
  if(detail?.id!==id||detail.state!=="READY"||detail.mountPath!==expected.mount||
     detail.volume?.id!==expected.volumeId||detail.volume?.name!==expected.name)
   throw Error("INSTANCE_NOT_READY_OR_CHANGED");
  plan.push({name:expected.name,id});
 }
 const previous=[];
 for(const target of plan){
  const records=(await query(LIST,{volumeInstanceId:target.id})).volumeInstanceBackupList;
  if(!Array.isArray(records))throw Error("BACKUP_INVENTORY_UNAVAILABLE");
  previous.push({...target,before:new Set(records.map(x=>x.id))});
 }
 if(!create)return {status:"plan_only",environment:ENVIRONMENT,
  volumes:previous.map(x=>({name:x.name,instanceId:x.id,existingBackups:x.before.size})),
  customerDataTransferred:false};
 const created=[];
 for(const target of previous){
  const result=await query(CREATE,{volumeInstanceId:target.id});
  if(result.volumeInstanceBackupCreate!==true)
   throw Error("SNAPSHOT_REQUEST_UNCONFIRMED");
  let item;
  for(let attempt=0;attempt<12;attempt++){
   const list=(await query(LIST,{volumeInstanceId:target.id})).volumeInstanceBackupList;
   if(!Array.isArray(list))throw Error("SNAPSHOT_REQUESTED_BUT_UNVERIFIABLE");
   const extra=list.filter(x=>x?.id&&!target.before.has(x.id));
   if(extra.length>1)throw Error("MULTIPLE_NEW_SNAPSHOTS_AMBIGUOUS");
   if(extra.length===1){item=extra[0];break;}
   if(attempt<11)await pause(2500);
  }
  if(!item)throw Error("SNAPSHOT_REQUESTED_NOT_OBSERVED_DO_NOT_RETRY");
  created.push({volume:target.name,instanceId:target.id,backupId:item.id,createdAt:item.createdAt});
 }
 return {status:"native_snapshots_observed",environment:ENVIRONMENT,backups:created,
  independentOffsiteRestoreVerified:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{
  const args=process.argv.slice(2);
  if(args.length!==1||!["--plan","--create"].includes(args[0]))
   throw Error("USE_PLAN_OR_CREATE");
  const result=await run({query:client(process.env),
   create:args[0]==="--create",approval:process.env.SINGMOTION_NATIVE_SNAPSHOT_APPROVAL});
  console.log("RAILWAY_NATIVE_BACKUP "+JSON.stringify(result));
 }catch(e){
  // Deliberately do not emit provider responses or credentials in diagnostics.
  console.error("RAILWAY_NATIVE_BACKUP "+JSON.stringify({ok:false,code:
   /^[A-Z_]+$/.test(e?.message||"")?e.message:"BACKUP_OPERATION_FAILED"}));
  process.exitCode=1;
 }
}
