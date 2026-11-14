import {NextRequest} from "next/server";
import path from "node:path";
import {existsSync} from "node:fs";
import {CommerceStore} from "@/lib/commerce/store";
import {db,dataDir,session,limit} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";
import {applicationOrigin} from "@/lib/request-origin";
import {customerIdentityOrigin} from "@/lib/customer-identity-origin";
import {rehomeMirroredPrivateSource,type CloudMediaRecord} from "@/lib/cloud-media";
import type {Asset} from "@/lib/domain";
export const runtime="nodejs";export const dynamic="force-dynamic";
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{"Cache-Control":"private, no-store"}});
export async function POST(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 if(!customerIdentityOrigin(process.env))return json({error:"Customer accounts are not available in this environment."},403);
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
  const body=await req.json().catch(()=>null) as {mode?:string;confirmation?:string;draftId?:string}|null;
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
   // Handoff requires a real saved draft in the original authenticated guest
   // session. A supplied UUID is a lookup hint, NOT proof of ownership.
   if(body.draftId!==undefined){
    if(!/^[A-Za-z0-9_-]{1,80}$/.test(body.draftId))return json({error:"Invalid saved draft"},400);
    const selected=db.prepare("SELECT selection,step FROM studio_drafts WHERE id=? AND owner=?")
     .get(body.draftId,guestOwner) as {selection:string;step:number}|undefined;
    if(!selected)return json({error:"This draft does not belong to your verified guest workspace"},404);
    const saved=JSON.parse(selected.selection) as {owner?:string;songId?:string;imageId?:string};
    if(saved.owner!==guestOwner||!saved.songId||!saved.imageId||selected.step!==3)
     return json({error:"Finish and save all Studio steps before account handoff"},409);
   }
   if(pending.n)return json({error:"Wait until pending video tasks finish before importing."},409);
   // R2 source keys include SHA256(owner). A mere owner-column UPDATE would
   // strand the original audio/photo after local scratch files are removed.
   // Copy, SHA256-verify and GET-confirm EVERY private object before the
   // owner-bound SQLite rows are changed. Keep old objects for rollback.
   type Migrated={assetId:string;previousKey:string;newKey:string};
   const cloudPresent=!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cloud_source_media'").get();
   const cloudRows=cloudPresent?db.prepare(
    "SELECT asset_id,key,sha256,bytes FROM cloud_source_media WHERE owner=?"
   ).all(guestOwner) as {asset_id:string;key:string;sha256:string;bytes:number}[]:[];
   const rehomed:Migrated[]=[];
   for(const row of cloudRows){
    const found=db.prepare("SELECT data FROM assets WHERE id=? AND owner=?")
     .get(row.asset_id,guestOwner) as {data:string}|undefined;
    if(!found)throw Error("Cloud manifest without verified guest source");
    const asset=JSON.parse(found.data) as Asset;
    if(asset.id!==row.asset_id||asset.owner!==guestOwner)throw Error("Source owner mismatch");
    const original:CloudMediaRecord={key:row.key,sha256:row.sha256,bytes:row.bytes};
    const updated=await rehomeMirroredPrivateSource(guestOwner,accountOwner,asset,original);
    rehomed.push({assetId:row.asset_id,previousKey:row.key,newKey:updated.key});
   }
   // Ensure a stable, idempotent ownership transfer across both SQLite files.
   db.exec("BEGIN IMMEDIATE");
   try{
    const attempts=db.prepare("SELECT attempt_id FROM guest_import.live_studio_projects WHERE owner=?").all(guestOwner) as {attempt_id:string}[];
    for(const row of attempts) {
      const a=db.prepare("SELECT data FROM guest_import.live_attempts WHERE id=?").get(row.attempt_id) as {data:string}|undefined;
      if(!a||JSON.parse(a.data).media?.owner!==guestOwner)throw Error("Video evidence owner mismatch");
    }
    db.prepare("UPDATE assets SET owner=?,data=json_set(data,'$.owner',?) WHERE owner=?").run(accountOwner,accountOwner,guestOwner);
    for(const row of rehomed){
     const change=db.prepare(
      "UPDATE cloud_source_media SET owner=?,key=? WHERE asset_id=? AND owner=? AND key=?"
     ).run(accountOwner,row.newKey,row.assetId,guestOwner,row.previousKey);
     if(change.changes!==1)throw Error("Cloud owner transfer must update exactly one source");
    }
    db.prepare("UPDATE artists SET owner=?,data=json_set(data,'$.owner',?) WHERE owner=?").run(accountOwner,accountOwner,guestOwner);
    db.prepare("UPDATE studio_drafts SET owner=?,selection=json_set(selection,'$.owner',?) WHERE owner=?").run(accountOwner,accountOwner,guestOwner);
    db.prepare("UPDATE jobs SET owner=?,data=json_set(data,'$.owner',?) WHERE owner=?").run(accountOwner,accountOwner,guestOwner);
    db.prepare("UPDATE guest_import.live_studio_projects SET owner=?,selection_json=json_set(selection_json,'$.owner',?) WHERE owner=?").run(accountOwner,accountOwner,guestOwner);
    for(const row of attempts)db.prepare("UPDATE guest_import.live_attempts SET data=json_set(data,'$.media.owner',?) WHERE id=?").run(accountOwner,row.attempt_id);
    db.prepare("UPDATE guest_import.live_private_exceptions SET owner=? WHERE owner=?").run(accountOwner,guestOwner);
    db.exec("COMMIT");
   }catch(e){db.exec("ROLLBACK");throw e}
   return json({imported:true,counts,verifiedCloudSources:rehomed.length});
  }catch(e){return json({error:e instanceof Error?e.message:"Import failed"},500)}
  finally{if(attached)try{db.exec("DETACH DATABASE guest_import")}catch{}}
 }finally{customer.close()}
}