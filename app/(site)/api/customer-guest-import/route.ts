import {NextRequest} from "next/server";
import path from "node:path";
import {existsSync} from "node:fs";
import {CommerceStore} from "@/lib/commerce/store";
import {db,dataDir,session,limit} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";
import {applicationOrigin} from "@/lib/request-origin";
export const runtime="nodejs";export const dynamic="force-dynamic";
const env="dfaeabed-03df-43ed-aa71-50f343a75041";
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{"Cache-Control":"private, no-store"}});
export async function POST(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 if(process.env.RAILWAY_ENVIRONMENT_ID!==env||process.env.CUSTOMER_ACCOUNTS_ENABLED!=="true")return json({error:"STAGING only"},403);
 if(req.headers.get("origin")!==applicationOrigin(req.url,req.headers.get("host")))return json({error:"Invalid origin"},403);
 const customer=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try{
  const accountId=customer.session(req.cookies.get("sm_customer")?.value||"");
  if(!accountId)return json({error:"Sign in first"},401);
  const accountOwner="customer-"+accountId;
  if(session(req.cookies.get("sm_session")?.value)?.owner!==accountOwner)return json({error:"Account workspace mismatch"},403);
  const guestToken=req.cookies.get("sm_guest_session")?.value;
  const guestOwner=session(guestToken)?.owner;
  if(!guestOwner||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(guestOwner))return json({error:"No verified guest workspace to import"},404);
  limit("guest-import:"+accountId,10,60000);
  const body=await req.json().catch(()=>null) as {mode?:string;confirmation?:string}|null;
  if(!body||!["preview","execute"].includes(body.mode||""))return json({error:"Invalid mode"},400);
  const liveFile=path.join(dataDir,"live-test.sqlite");
  if(!existsSync(liveFile))return json({error:"Project storage unavailable"},503);
  let attached=false;
  try{
   db.prepare("ATTACH DATABASE ? AS guest_import").run(liveFile);attached=true;
   db.exec("CREATE TABLE IF NOT EXISTS studio_drafts (id TEXT PRIMARY KEY,owner TEXT NOT NULL,selection TEXT NOT NULL,artist_name TEXT NOT NULL,step INTEGER NOT NULL,updated INTEGER NOT NULL)");
   const count=(table:string)=>Number((db.prepare("SELECT COUNT(*) AS n FROM "+table+" WHERE owner=?").get(guestOwner) as {n:number}).n);
   const counts={uploads:count("assets"),artists:count("artists"),drafts:count("studio_drafts"),jobs:count("jobs"),videoProjects:count("guest_import.live_studio_projects")};
   const pending=db.prepare("SELECT count(*) n FROM guest_import.live_studio_projects p JOIN guest_import.live_attempts a ON a.id=p.attempt_id WHERE p.owner=? AND json_extract(a.data,'$.state') NOT IN ('prepared','failed','completed')").get(guestOwner) as {n:number};
   if(body.mode==="preview")return json({counts,pendingProjects:pending.n,confirmation:"IMPORT MY GUEST PROJECTS"});
   if(body.confirmation!=="IMPORT MY GUEST PROJECTS")return json({error:"Confirmation required"},400);
   if(pending.n)return json({error:"Wait until pending video tasks finish before importing."},409);
   // Ensure a stable, idempotent ownership transfer across both SQLite files.
   db.exec("BEGIN IMMEDIATE");
   try{
    const attempts=db.prepare("SELECT attempt_id FROM guest_import.live_studio_projects WHERE owner=?").all(guestOwner) as {attempt_id:string}[];
    for(const row of attempts) {
      const a=db.prepare("SELECT data FROM guest_import.live_attempts WHERE id=?").get(row.attempt_id) as {data:string}|undefined;
      if(!a||JSON.parse(a.data).media?.owner!==guestOwner)throw Error("Video evidence owner mismatch");
    }
    db.prepare("UPDATE assets SET owner=?,data=json_set(data,'$.owner',?) WHERE owner=?").run(accountOwner,accountOwner,guestOwner);
    db.prepare("UPDATE artists SET owner=?,data=json_set(data,'$.owner',?) WHERE owner=?").run(accountOwner,accountOwner,guestOwner);
    db.prepare("UPDATE studio_drafts SET owner=?,selection=json_set(selection,'$.owner',?) WHERE owner=?").run(accountOwner,accountOwner,guestOwner);
    db.prepare("UPDATE jobs SET owner=?,data=json_set(data,'$.owner',?) WHERE owner=?").run(accountOwner,accountOwner,guestOwner);
    db.prepare("UPDATE guest_import.live_studio_projects SET owner=?,selection_json=json_set(selection_json,'$.owner',?) WHERE owner=?").run(accountOwner,accountOwner,guestOwner);
    for(const row of attempts)db.prepare("UPDATE guest_import.live_attempts SET data=json_set(data,'$.media.owner',?) WHERE id=?").run(accountOwner,row.attempt_id);
    db.prepare("UPDATE guest_import.live_private_exceptions SET owner=? WHERE owner=?").run(accountOwner,guestOwner);
    db.exec("COMMIT");
   }catch(e){db.exec("ROLLBACK");throw e}
   return json({imported:true,counts});
  }catch(e){return json({error:e instanceof Error?e.message:"Import failed"},500)}
  finally{if(attached)try{db.exec("DETACH DATABASE guest_import")}catch{}}
 }finally{customer.close()}
}