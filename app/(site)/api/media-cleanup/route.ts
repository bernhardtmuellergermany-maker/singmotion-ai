import { NextRequest } from "next/server";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { db, dataDir, session, limit } from "@/lib/db";
import { CommerceStore } from "@/lib/commerce/store";
import { PlanLedger } from "@/lib/commerce/plans";
import {uploadStorageLimit} from "@/lib/upload-storage";
import { stagingDenial } from "@/lib/staging";
import { openStudioStore } from "@/lib/live/studio";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const respond=(x:unknown,s=200)=>Response.json(x,{status:s,headers:{"Cache-Control":"private, no-store"}});
const allowedEnvironment="dfaeabed-03df-43ed-aa71-50f343a75041";
type MediaRow={id:string;data:string};
export async function POST(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 if(process.env.RAILWAY_ENVIRONMENT_ID!==allowedEnvironment)return respond({error:"STAGING only"},403);
 if(req.headers.get("origin")!=="https://singmotion-ai-staging.up.railway.app")return respond({error:"Origin mismatch"},403);
 const auth=session(req.cookies.get("sm_session")?.value);
 if(!auth)return respond({error:"Studio session required"},401);
 limit(auth.owner+":media-cleanup",10,60000);
 const body=await req.json().catch(()=>null) as {mode?:string;confirmation?:string}|null;
 if(!body||!["preview","execute"].includes(body.mode||""))return respond({error:"Invalid mode"},400);
 const store=await openStudioStore(dataDir);
 try{
  // A conservative reachability scan: preserve an upload if any project,
  // artist, draft, job, or live attempt mentions its unique asset ID.
  const references:string[]=[];
  for(const table of ["jobs","artists","studio_drafts"] as const){
   if(table==="studio_drafts")db.exec("CREATE TABLE IF NOT EXISTS studio_drafts (id TEXT PRIMARY KEY,owner TEXT NOT NULL,selection TEXT NOT NULL,artist_name TEXT NOT NULL,step INTEGER NOT NULL,updated INTEGER NOT NULL)");
   const col=table==="studio_drafts"?"selection":"data";
   const rows=db.prepare("SELECT "+col+" AS value FROM "+table+" WHERE owner=?").all(auth.owner) as {value:string}[];
   references.push(...rows.map(row=>row.value));
  }
  const liveRows=store.db.prepare("SELECT a.data,p.selection_json FROM live_attempts a JOIN live_studio_projects p ON p.attempt_id=a.id WHERE p.owner=?").all(auth.owner) as {data:string;selection_json:string}[];
  for(const row of liveRows)references.push(row.data,row.selection_json);
  // Preserve references from historical attempts too: tasks can still need originals.
  const attempts=store.db.prepare("SELECT data FROM live_attempts").all() as {data:string}[];
  references.push(...attempts.map(a=>a.data));
  const referenceText=references.join("\n");
  const assets=db.prepare("SELECT id,data FROM assets WHERE owner=?").all(auth.owner) as MediaRow[];
  const safe=assets.map(r=>{
   const a=JSON.parse(r.data) as {bytes?:number;name?:string;kind?:string};
   return {id:r.id,bytes:Number(a.bytes)||0,name:a.name||"Upload",kind:a.kind||"media",unused:!referenceText.includes(r.id)};
  });
  const unused=safe.filter(a=>a.unused);
  let storagePlan:"guest"|"free"|"hobby"="guest";
  if(auth.owner.startsWith("customer-") && process.env.CUSTOMER_ACCOUNTS_ENABLED==="true"){
   const customer=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
   try{
    const accountId=customer.session(req.cookies.get("sm_customer")?.value||"");
    storagePlan=accountId && auth.owner===`customer-${accountId}`
      ? new PlanLedger(customer.db).activePlan(accountId) : "free";
   }finally{customer.close()}
  }
  const report={totalBytes:safe.reduce((s,a)=>s+a.bytes,0),limitBytes:uploadStorageLimit(storagePlan),
   unusedBytes:unused.reduce((s,a)=>s+a.bytes,0),unusedCount:unused.length,
   protectedCount:safe.length-unused.length,
   unused:unused.map(({id,bytes,name,kind})=>({id,bytes,name,kind}))};
  if(body.mode==="preview")return respond(report);
  if(body.confirmation!=="DELETE UNUSED UPLOADS")return respond({error:"Confirmation required"},400);
  const removed:string[]=[];
  // Recheck under the SQLite write transaction for concurrent updates.
  db.exec("BEGIN IMMEDIATE");
  try{
   for(const item of unused){
    const still=db.prepare("SELECT 1 FROM assets WHERE id=? AND owner=?").get(item.id,auth.owner);
    if(!still)continue;
    db.prepare("DELETE FROM assets WHERE id=? AND owner=?").run(item.id,auth.owner);
    removed.push(item.id);
   }
   db.exec("COMMIT");
  }catch(e){db.exec("ROLLBACK");throw e}
  const fileErrors:string[]=[];
  for(const id of removed){
   for(const suffix of ["",".preview.mp3"]){
    try{await unlink(path.join(dataDir,"media",id+suffix))}
    catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")fileErrors.push(id+suffix)}
   }
  }
  return respond({deleted:removed.length,freedBytes:unused.filter(a=>removed.includes(a.id)).reduce((s,a)=>s+a.bytes,0),fileErrors});
 }catch(e){return respond({error:e instanceof Error?e.message:"Cleanup error"},500)}
 finally{store.close()}
}
