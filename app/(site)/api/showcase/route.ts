import { NextRequest } from "next/server";
import { getPayload } from "payload";
import payloadConfig from "@payload-config";
import { hasRole } from "@/cms/policy";
import { stagingDenial } from "@/lib/staging";
import { dataDir, session } from "@/lib/db";
import { openStudioStore } from "@/lib/live/studio";
import { createReadStream } from "node:fs";
import { stat, realpath } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
type Selected={attempt_id:string;owner:string;artist_name:string;project_name?:string};
const slots=["main","second","third"] as const;
type Slot=typeof slots[number];
const isSlot=(slot:string):slot is Slot=>slots.some(s=>s===slot);
const superAdminPolicy=(value:string)=>{try{return (JSON.parse(value) as {reviewedBy?:string}).reviewedBy==="authenticated-super-admin-server-policy";}catch{return false}};

async function store(){
  const s=await openStudioStore(dataDir);
  s.db.exec("CREATE TABLE IF NOT EXISTS live_studio_projects (attempt_id TEXT PRIMARY KEY, owner TEXT NOT NULL, selection_json TEXT NOT NULL, policy_json TEXT NOT NULL, artist_name TEXT NOT NULL, diagnostic TEXT, started_at INTEGER)");
  s.db.exec("CREATE TABLE IF NOT EXISTS public_showcase_selection (slot TEXT PRIMARY KEY, attempt_id TEXT NOT NULL, owner TEXT NOT NULL, artist_name TEXT NOT NULL)");
  return s;
}
async function admin(req:NextRequest){
  if(process.env.CMS_ENABLED!=="true")return false;
  const payload=await getPayload({config:payloadConfig});
  const {user}=await payload.auth({headers:req.headers});
  return hasRole(user,["super-admin"]);
}
async function handler(req:NextRequest){
  const denial=stagingDenial(req.headers.get("authorization"));
  if(denial)return denial;
  try{
    const s=await store();
    const slot=req.nextUrl.searchParams.get("slot")||"main";
    if(!isSlot(slot))return json({error:"Invalid showcase slot"},400);
    const selected=s.db.prepare("SELECT attempt_id,owner,artist_name FROM public_showcase_selection WHERE slot=?").get(slot) as Selected|undefined;
    const video=req.nextUrl.searchParams.has("video");
    if(req.method==="GET"&&video){
      if(!selected)return json({error:"No public showcase selected"},404);
      const project=s.db.prepare("SELECT policy_json FROM live_studio_projects WHERE attempt_id=? AND owner=?").get(selected.attempt_id,selected.owner) as {policy_json:string}|undefined;
      if(!project||!superAdminPolicy(project.policy_json))return json({error:"Showcase unavailable"},404);
      const attempt=s.get(selected.attempt_id);
      if(attempt.state!=="completed"||!attempt.outputPath)return json({error:"Showcase unavailable"},404);
      const base=await realpath(path.join(dataDir,"live-output"));
      const file=await realpath(attempt.outputPath);
      if(!file.startsWith(base+path.sep)||(await stat(file)).isFile()===false)return json({error:"Showcase unavailable"},404);
      const size=(await stat(file)).size;
      let start=0,end=size-1,status=200;
      const range=req.headers.get("range");
      if(range){
        const match=/^bytes=(\d+)-(\d*)$/.exec(range);
        if(!match)return new Response(null,{status:416,headers:{"Content-Range":`bytes */${size}`}});
        start=Number(match[1]);end=match[2]?Number(match[2]):size-1;
        if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||end>=size)return new Response(null,{status:416,headers:{"Content-Range":`bytes */${size}`}});
        status=206;
      }
      return new Response(Readable.toWeb(createReadStream(file,{start,end})) as ReadableStream,{status,headers:{"Content-Type":"video/mp4","Accept-Ranges":"bytes","Content-Length":String(end-start+1),"Cache-Control":"public,max-age=60","X-Content-Type-Options":"nosniff",...(status===206?{"Content-Range":`bytes ${start}-${end}/${size}`}:{})}});
    }
    if(req.method==="GET"&&!req.nextUrl.searchParams.has("admin")){
      const selectedRows=s.db.prepare("SELECT p.slot,p.attempt_id,p.owner,p.artist_name,l.policy_json FROM public_showcase_selection p JOIN live_studio_projects l ON l.attempt_id=p.attempt_id AND l.owner=p.owner WHERE p.slot IN ('main','second','third')").all() as (Selected&{slot:Slot;policy_json:string})[];
      const approved=selectedRows.filter(row=>{
        if(!superAdminPolicy(row.policy_json))return false;
        try{const a=s.get(row.attempt_id);return a.state==="completed"&&!!a.outputPath;}catch{return false}
      });
      const videos=slots.flatMap(slotName=>approved.filter(v=>v.slot===slotName).map(v=>({title:v.artist_name,videoUrl:"/api/showcase?video=1&slot="+v.slot})));
      return json({title:videos[0]?.title||"SingMotion AI Showcase",videoUrl:videos[0]?.videoUrl||"",videos});
    }
    if(!await admin(req))return json({error:"Super-admin authorization required"},403);
    // A Super Admin can publish only THEIR OWN projects that were GENERATED
    // with the server-authenticated Super Admin policy. Admin role alone
    // does not authorize publication of somebody else's private video.
    const actor=session(req.cookies.get("sm_session")?.value);
    if(!actor||actor.owner.startsWith("customer-"))return json({error:"Super-admin media session required"},403);
    const owned=s.db.prepare("SELECT attempt_id,owner,artist_name,project_name,policy_json FROM live_studio_projects WHERE owner=? ORDER BY rowid DESC LIMIT 500").all(actor.owner) as (Selected&{policy_json:string})[];
    const eligible=owned.filter(row=>superAdminPolicy(row.policy_json)).flatMap(row=>{
      try{const a=s.get(row.attempt_id);return a.state==="completed"&&a.outputPath?[{id:row.attempt_id,name:row.project_name?.trim()||row.artist_name,owner:row.owner}]:[]}catch{return []}
    });
    if(req.method==="GET"){
      const projects=eligible.map(row=>({...row,selected:selected?.attempt_id===row.id}));
      const selectedIds=Object.fromEntries(slots.map(slotName=>[slotName,(s.db.prepare("SELECT attempt_id FROM public_showcase_selection WHERE slot=?").get(slotName) as {attempt_id:string}|undefined)?.attempt_id||null]));
      return json({projects,selectedId:selectedIds.main,selectedIds});
    }
    if(req.method==="POST"){
      const body=await req.json() as {id?:unknown;slot?:unknown;action?:unknown};
      if(body.action==="publish-next-two"){
        const current=s.db.prepare("SELECT attempt_id FROM public_showcase_selection WHERE slot='main'").get() as {attempt_id:string}|undefined;
        const choices=eligible.filter(row=>row.id!==current?.attempt_id).slice(0,2);
        if(choices.length!==2)return json({error:"Two additional completed Super Admin videos are not available in this private workspace."},409);
        s.db.exec("BEGIN IMMEDIATE");
        try{
          for(const [index,row] of choices.entries()){
            const target=index===0?"second":"third";
            s.db.prepare("INSERT INTO public_showcase_selection (slot,attempt_id,owner,artist_name) VALUES (?,?,?,?) ON CONFLICT(slot) DO UPDATE SET attempt_id=excluded.attempt_id,owner=excluded.owner,artist_name=excluded.artist_name").run(target,row.id,actor.owner,row.name);
          }
          s.db.exec("COMMIT");
        }catch(error){s.db.exec("ROLLBACK");throw error;}
        return json({ok:true,published:choices.map((row,index)=>({slot:index===0?"second":"third",title:row.name}))});
      }
      const target=typeof body.slot==="string"?body.slot:"main";
      if(!isSlot(target))return json({error:"Invalid showcase slot"},400);
      if(typeof body.id!=="string"||body.id.length>160)return json({error:"Invalid project ID"},400);
      const eligibleRow=eligible.find(row=>row.id===body.id);
      if(!eligibleRow)return json({error:"Completed Super Admin project from this private workspace required"},403);
      s.db.prepare("INSERT INTO public_showcase_selection (slot,attempt_id,owner,artist_name) VALUES (?,?,?,?) ON CONFLICT(slot) DO UPDATE SET attempt_id=excluded.attempt_id,owner=excluded.owner,artist_name=excluded.artist_name").run(target,eligibleRow.id,actor.owner,eligibleRow.name);
      return json({ok:true,title:eligibleRow.name,videoUrl:"/api/showcase?video=1&slot="+target});
    }
    return json({error:"Method not allowed"},405);
  }catch(e){console.error("Showcase request failed",e);return json({error:"Showcase unavailable"},500);}
}
export const GET=handler;
export const POST=handler;
