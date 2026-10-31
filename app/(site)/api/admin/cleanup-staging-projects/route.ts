import {NextRequest} from "next/server";
import {getPayload} from "payload";
import payloadConfig from "@payload-config";
import {hasRole} from "@/cms/policy";
import {stagingDenial} from "@/lib/staging";
import {dataDir} from "@/lib/db";
import {openStudioStore} from "@/lib/live/studio";
const staging="dfaeabed-03df-43ed-aa71-50f343a75041";
const respond=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 if(process.env.RAILWAY_ENVIRONMENT_ID!==staging)return respond({error:"Staging only"},403);
 if(req.headers.get("origin")!=="https://singmotion-ai-staging.up.railway.app")return respond({error:"Origin mismatch"},403);
 const payload=await getPayload({config:payloadConfig});
 const {user}=await payload.auth({headers:req.headers});
 if(!user||!hasRole(user,["super-admin"]))return respond({error:"Super admin required"},403);
 const owner="cms-staff-"+String(user.id);
 const body=await req.json().catch(()=>null) as {mode?:string;confirmation?:string}|null;
 if(!body||!["preview","execute"].includes(body.mode||""))return respond({error:"Invalid mode"},400);
 const store=await openStudioStore(dataDir);
 try{
  const rows=store.db.prepare("SELECT p.attempt_id id,a.data data FROM live_studio_projects p JOIN live_attempts a ON a.id=p.attempt_id WHERE p.owner=?").all(owner) as {id:string;data:string}[];
  const projects=rows.map(r=>({id:r.id,state:(JSON.parse(r.data) as {state:string}).state}));
  const failed=projects.filter(p=>p.state==="failed");
  const uncertain=projects.filter(p=>["uncertain","authorized","submitting","submitted","processing","output_observed"].includes(p.state));
  const preserved=projects.filter(p=>p.state==="completed"||p.state==="prepared");
  if(body.mode==="preview")return respond({failed,uncertain,preservedCount:preserved.length,notice:"Uncertain and active provider tasks are protected from deletion; only failed projects can be permanently deleted."});
  if(body.confirmation!=="DELETE FAILED STAGING PROJECTS")return respond({error:"Confirmation required"},400);
  let deleted=0;const errors:string[]=[];
  for(const p of failed){
   try{
    const live=store.get(p.id);
    if(live.state!=="failed")continue;
    store.db.prepare("DELETE FROM live_studio_projects WHERE attempt_id=? AND owner=?").run(p.id,owner);
    deleted++;
   }catch{errors.push(p.id)}
  }
  return respond({deletedFailed:deleted,uncertainProtected:uncertain.map(p=>p.id),preservedCount:preserved.length,errors});
 }finally{store.close()}
}
