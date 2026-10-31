import { NextRequest } from "next/server";
import { getPayload } from "payload";
import payloadConfig from "@payload-config";
import { db, dataDir } from "@/lib/db";
import { hasRole } from "@/cms/policy";
import { stagingDenial } from "@/lib/staging";
import path from "node:path";
import { existsSync } from "node:fs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
const stagingId="dfaeabed-03df-43ed-aa71-50f343a75041";
const guest="^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
const guestSql="owner GLOB '[0-9a-f]*' AND length(owner)=36 AND owner NOT LIKE 'customer-%' AND owner NOT LIKE 'cms-staff-%'";
/** One-time, auditable ownership migration of legacy guest workspaces in STAGING only. */
export async function POST(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 if(process.env.RAILWAY_ENVIRONMENT_ID!==stagingId)return reply({error:"Staging only"},403);
 if(req.headers.get("origin")!==new URL(req.url).origin)return reply({error:"Origin mismatch"},403);
 const payload=await getPayload({config:payloadConfig});
 const {user}=await payload.auth({headers:req.headers});
 if(!user||!hasRole(user,["super-admin"])||!/^[a-zA-Z0-9_-]{1,100}$/.test(String(user.id)))return reply({error:"Super admin required"},403);
 const owner="cms-staff-"+String(user.id);
 const body=await req.json().catch(()=>null) as {confirmation?:string;mode?:string}|null;
 if(!body||!["preview","execute"].includes(body.mode||""))return reply({error:"Invalid mode"},400);
 const liveFile=path.join(dataDir,"live-test.sqlite");
 if(!existsSync(liveFile))return reply({error:"Live project database missing"},503);
 let attached=false;
 try{
  db.prepare("ATTACH DATABASE ? AS live_migration").run(liveFile);attached=true;
  const count=(sql:string)=>Number((db.prepare(sql).get() as {n:number}).n);
  const metrics={
   liveProjects:count("SELECT count(*) n FROM live_migration.live_studio_projects WHERE "+guestSql),
   legacyJobs:count("SELECT count(*) n FROM jobs WHERE "+guestSql),
   guestDrafts:count("SELECT count(*) n FROM studio_drafts WHERE "+guestSql),
   assets:count("SELECT count(*) n FROM assets WHERE "+guestSql),
   artists:count("SELECT count(*) n FROM artists WHERE "+guestSql),
   liveAttempts:count("SELECT count(*) n FROM live_migration.live_attempts WHERE json_extract(data,'$.media.owner') GLOB '[0-9a-f]*' AND length(json_extract(data,'$.media.owner'))=36"),
  };
  if(body.mode==="preview")return reply({owner,metrics,requiresConfirmation:"MIGRATE LEGACY STAGING PROJECTS"});
  if(body.confirmation!=="MIGRATE LEGACY STAGING PROJECTS")return reply({error:"Explicit confirmation required"},400);
  db.exec("CREATE TABLE IF NOT EXISTS legacy_staging_migrations (id INTEGER PRIMARY KEY, target TEXT NOT NULL, counts TEXT NOT NULL, created INTEGER NOT NULL)");
  db.exec("BEGIN IMMEDIATE");
  try{
   db.prepare("UPDATE assets SET owner=? WHERE "+guestSql).run(owner);
   db.prepare("UPDATE artists SET owner=?,data=json_set(data,'$.owner',?) WHERE "+guestSql).run(owner,owner);
   db.prepare("UPDATE jobs SET owner=?,data=json_set(data,'$.owner',?) WHERE "+guestSql).run(owner,owner);
   db.prepare("UPDATE studio_drafts SET owner=?,selection=json_set(selection,'$.owner',?) WHERE "+guestSql).run(owner,owner);
   db.prepare("UPDATE live_migration.live_studio_projects SET owner=?,selection_json=json_set(selection_json,'$.owner',?) WHERE "+guestSql).run(owner,owner);
   db.prepare("UPDATE live_migration.live_attempts SET data=json_set(data,'$.media.owner',?) WHERE length(json_extract(data,'$.media.owner'))=36 AND json_extract(data,'$.media.owner') GLOB '[0-9a-f]*'").run(owner);
   db.prepare("UPDATE live_migration.live_private_exceptions SET owner=? WHERE "+guestSql).run(owner);
   db.prepare("INSERT INTO legacy_staging_migrations(target,counts,created) VALUES(?,?,?)").run(owner,JSON.stringify(metrics),Date.now());
   db.exec("COMMIT");
  }catch(e){db.exec("ROLLBACK");throw e}
  return reply({migrated:true,owner,metrics});
 }catch(e){return reply({error:"Migration blocked; no ownership changes committed",detail:e instanceof Error?e.message:"Unknown error"},500)}
 finally{if(attached)try{db.exec("DETACH DATABASE live_migration")}catch{}}
}
