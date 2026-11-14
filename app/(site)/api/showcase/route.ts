import { NextRequest } from "next/server";
import { getPayload } from "payload";
import payloadConfig from "@payload-config";
import { hasRole } from "@/cms/policy";
import { stagingDenial } from "@/lib/staging";
import {applicationOrigin} from "@/lib/request-origin";
import { dataDir } from "@/lib/db";
import { openStudioStore } from "@/lib/live/studio";
import { createReadStream } from "node:fs";
import { stat, realpath } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
const shuffled=<T,>(items:T[]):T[]=>{
  const result=[...items];
  for(let i=result.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [result[i],result[j]]=[result[j],result[i]];
  }
  return result;
};
type Selected={attempt_id:string;owner:string;artist_name:string;project_name?:string};
const slots=["main","second","third"] as const;
type Slot=typeof slots[number];
const isSlot=(slot:string):slot is Slot=>slots.some(s=>s===slot);
type Channel="desktop"|"desktop_portrait"|"mobile";
const isChannel=(v:unknown):v is Channel=>v==="desktop"||v==="desktop_portrait"||v==="mobile";
type ChannelEntry=Selected&{channel:Channel;sort_order:number;policy_json:string|null};
const superAdminPolicy=(value:string)=>{try{return (JSON.parse(value) as {reviewedBy?:string}).reviewedBy==="authenticated-super-admin-server-policy";}catch{return false}};

async function store(){
  const s=await openStudioStore(dataDir);
  s.db.exec("CREATE TABLE IF NOT EXISTS live_studio_projects (attempt_id TEXT PRIMARY KEY, owner TEXT NOT NULL, selection_json TEXT NOT NULL, policy_json TEXT NOT NULL, artist_name TEXT NOT NULL, diagnostic TEXT, started_at INTEGER)");
  s.db.exec("CREATE TABLE IF NOT EXISTS public_showcase_selection (slot TEXT PRIMARY KEY, attempt_id TEXT NOT NULL, owner TEXT NOT NULL, artist_name TEXT NOT NULL)");
  s.db.exec("CREATE TABLE IF NOT EXISTS public_showcase_entries (channel TEXT NOT NULL CHECK(channel IN ('desktop','mobile')),attempt_id TEXT NOT NULL,owner TEXT NOT NULL,artist_name TEXT NOT NULL,sort_order INTEGER NOT NULL,PRIMARY KEY(channel,attempt_id))");
  // Safely expand the earlier two-channel table to three independently curated surfaces.
  const tableSql=(s.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='public_showcase_entries'").get() as {sql:string}|undefined)?.sql||"";
  if(!tableSql.includes("desktop_portrait")){
    s.db.exec("BEGIN IMMEDIATE");
    try{
      s.db.exec("CREATE TABLE public_showcase_entries_v2 (channel TEXT NOT NULL CHECK(channel IN ('desktop','desktop_portrait','mobile')),attempt_id TEXT NOT NULL,owner TEXT NOT NULL,artist_name TEXT NOT NULL,sort_order INTEGER NOT NULL,PRIMARY KEY(channel,attempt_id))");
      s.db.exec("INSERT INTO public_showcase_entries_v2 SELECT channel,attempt_id,owner,artist_name,sort_order FROM public_showcase_entries");
      s.db.exec("DROP TABLE public_showcase_entries");
      s.db.exec("ALTER TABLE public_showcase_entries_v2 RENAME TO public_showcase_entries");
      s.db.exec("COMMIT");
    }catch(error){s.db.exec("ROLLBACK");throw error;}
  }
  // One-time migration of already published selections only; never publish
  // other completed or private videos automatically.
  s.db.exec("CREATE TABLE IF NOT EXISTS public_showcase_migrations (version INTEGER PRIMARY KEY)");
  const migrated=s.db.prepare("SELECT version FROM public_showcase_migrations WHERE version=1").get();
  if(!migrated){
    s.db.exec("BEGIN IMMEDIATE");
    try{
      const old=s.db.prepare("SELECT attempt_id,owner,artist_name FROM public_showcase_selection ORDER BY CASE slot WHEN 'main' THEN 0 WHEN 'second' THEN 1 ELSE 2 END").all() as Selected[];
      for(const [i,entry] of old.entries()){
        for(const channel of ["desktop","mobile"] as const)
          s.db.prepare("INSERT OR IGNORE INTO public_showcase_entries(channel,attempt_id,owner,artist_name,sort_order) VALUES(?,?,?,?,?)").run(channel,entry.attempt_id,entry.owner,entry.artist_name,i);
      }
      s.db.prepare("INSERT INTO public_showcase_migrations(version) VALUES(1)").run();
      s.db.exec("COMMIT");
    }catch(error){s.db.exec("ROLLBACK");throw error;}
  }
  s.db.exec("CREATE TABLE IF NOT EXISTS public_showcase_channel_config (channel TEXT PRIMARY KEY, explicitly_configured INTEGER NOT NULL DEFAULT 1)");
  const configColumns=s.db.prepare("PRAGMA table_info(public_showcase_channel_config)").all() as {name:string}[];
  if(!configColumns.some(col=>col.name==="random_order")){
    s.db.exec("ALTER TABLE public_showcase_channel_config ADD COLUMN random_order INTEGER NOT NULL DEFAULT 0");
    // Start the new mobile-only shuffle mode enabled. CMS can turn it off.
    s.db.prepare("UPDATE public_showcase_channel_config SET random_order=1 WHERE channel='mobile'").run();
  }
  s.db.exec("CREATE TABLE IF NOT EXISTS public_showcase_uploads(id TEXT PRIMARY KEY,title TEXT NOT NULL,filename TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,created_at INTEGER NOT NULL)");
  s.db.exec("CREATE TABLE IF NOT EXISTS public_showcase_posters(id TEXT PRIMARY KEY,filename TEXT NOT NULL,created_at INTEGER NOT NULL)");
  s.db.exec("CREATE TABLE IF NOT EXISTS public_showcase_hidden(attempt_id TEXT PRIMARY KEY,hidden_at INTEGER NOT NULL)");
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
  if(req.method!=="GET"){
    const origin=applicationOrigin(req.url,req.headers.get("host"));
    if(!origin||req.headers.get("origin")!==origin)
      return json({error:"Invalid request origin."},403);
  }
  try{
    const s=await store();
    const channelParam=req.nextUrl.searchParams.get("channel");
    if(channelParam!==null&&!isChannel(channelParam))return json({error:"Invalid channel"},400);
    // Channel-scoped calls power CMS curation and both independent feeds.
    // Legacy slot calls below remain compatible with existing pages.
    if(channelParam!==null){
      const channel=channelParam as Channel;
      const entries=()=>s.db.prepare("SELECT e.channel,e.attempt_id,e.owner,e.artist_name,e.sort_order,p.policy_json FROM public_showcase_entries e LEFT JOIN live_studio_projects p ON p.attempt_id=e.attempt_id AND p.owner=e.owner WHERE e.channel=? ORDER BY e.sort_order,e.rowid").all(channel) as ChannelEntry[];
      const validated=()=>entries().filter(entry=>{
        if(s.db.prepare("SELECT 1 FROM public_showcase_hidden WHERE attempt_id=?").get(entry.attempt_id))return false;
        if(entry.attempt_id.startsWith("upload-")){
          return !!s.db.prepare("SELECT 1 FROM public_showcase_uploads WHERE id=?").get(entry.attempt_id);
        }
        if(!entry.policy_json||!superAdminPolicy(entry.policy_json))return false;
        try{const a=s.get(entry.attempt_id);return a.state==="completed"&&!!a.outputPath;}catch{return false;}
      });
      const posterUrl=(id:string)=>s.db.prepare("SELECT 1 FROM public_showcase_posters WHERE id=?").get(id)?"/api/showcase-media?kind=poster&id="+encodeURIComponent(id):null;
       const selectedVideo=req.nextUrl.searchParams.get("id");
      if(req.method==="GET"&&req.nextUrl.searchParams.has("video")){
        if(!selectedVideo)return json({error:"Missing published video ID"},400);
        const selected=validated().find(e=>e.attempt_id===selectedVideo);
        if(!selected)return json({error:"Video not published"},404);
        let file:string;
        let mime="video/mp4";
        if(selected.attempt_id.startsWith("upload-")){
          const uploaded=s.db.prepare("SELECT filename,mime FROM public_showcase_uploads WHERE id=?").get(selected.attempt_id) as {filename:string;mime:string}|undefined;
          if(!uploaded)return json({error:"Video unavailable"},404);
          const base=await realpath(path.join(dataDir,"showcase-media"));
          file=await realpath(path.join(base,uploaded.filename));
          if(!file.startsWith(base+path.sep))return json({error:"Video unavailable"},404);
          mime=uploaded.mime;
        }else{
          const attempt=s.get(selected.attempt_id);
          const base=await realpath(path.join(dataDir,"live-output"));
          file=await realpath(attempt.outputPath!);
          if(!file.startsWith(base+path.sep))return json({error:"Video unavailable"},404);
        }
        if(!(await stat(file)).isFile())return json({error:"Video unavailable"},404);
        const size=(await stat(file)).size;let start=0,end=size-1,status=200;
        const range=req.headers.get("range");
        if(range){
          const m=/^bytes=(\d+)-(\d*)$/.exec(range);
          if(!m)return new Response(null,{status:416,headers:{"Content-Range":`bytes */${size}`}});
          start=Number(m[1]);end=m[2]?Number(m[2]):size-1;
          if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||end>=size)return new Response(null,{status:416,headers:{"Content-Range":`bytes */${size}`}});
          // Chrome/Safari often request bytes=0- for HTML video. Sending an
          // entire 80 MiB showcase file monopolizes bandwidth while three
          // previews compete for the first decodable frame. Keep open-ended
          // ranges bounded so each player can progressively request its
          // next segment. Explicit bounded ranges remain unchanged.
          if(!m[2])end=Math.min(end,start+(2*1024*1024)-1);
          status=206;
        }
        return new Response(Readable.toWeb(createReadStream(file,{start,end})) as ReadableStream,{status,headers:{"Content-Type":mime,"Accept-Ranges":"bytes","Content-Length":String(end-start+1),"Cache-Control":"public,max-age=60","X-Content-Type-Options":"nosniff",...(status===206?{"Content-Range":`bytes ${start}-${end}/${size}`}:{})}});
      }
      if(req.method==="GET"&&!req.nextUrl.searchParams.has("admin")){
        const config=s.db.prepare("SELECT random_order FROM public_showcase_channel_config WHERE channel=?").get(channel) as {random_order:number}|undefined;
        const randomOrder=channel==="mobile"&&(config?.random_order??1)===1;
        const published=validated();
        const videos=(randomOrder?shuffled(published):published).map(entry=>({id:entry.attempt_id,title:entry.artist_name,videoUrl:"/api/showcase?channel="+channel+"&video=1&id="+encodeURIComponent(entry.attempt_id),posterUrl:posterUrl(entry.attempt_id)}));
        // Preserve the explicitly published legacy feed until its new mobile
        // playlist is curated in CMS. Never import other/private projects.
        const configured=!!s.db.prepare("SELECT 1 FROM public_showcase_channel_config WHERE channel=?").get(channel);
        if(channel==="mobile"&&videos.length===0&&!configured){
          const legacy=s.db.prepare("SELECT slot,attempt_id,owner,artist_name FROM public_showcase_selection ORDER BY CASE slot WHEN 'main' THEN 0 WHEN 'second' THEN 1 ELSE 2 END").all() as (Selected&{slot:string})[];
          const publicOld=legacy.filter(row=>{
            const verified=s.db.prepare("SELECT policy_json FROM live_studio_projects WHERE attempt_id=? AND owner=?").get(row.attempt_id,row.owner) as {policy_json:string}|undefined;
            if(!verified||!superAdminPolicy(verified.policy_json)||
              s.db.prepare("SELECT 1 FROM public_showcase_hidden WHERE attempt_id=?").get(row.attempt_id))return false;
            try{const output=s.get(row.attempt_id);return output.state==="completed"&&!!output.outputPath;}catch{return false;}
          }).map(row=>({id:row.attempt_id,title:row.artist_name,videoUrl:"/api/showcase?video=1&slot="+row.slot}));
          return json({channel,legacyFallback:true,title:publicOld[0]?.title||"SingMotion AI Showcase",videoUrl:publicOld[0]?.videoUrl||"",videos:publicOld});
        }
        return json({channel,randomOrder,title:videos[0]?.title||"SingMotion AI Showcase",videoUrl:videos[0]?.videoUrl||"",videos});
      }
      if(!await admin(req))return json({error:"Super-admin authorization required"},403);
      // Only authenticated Super Admin-created, COMPLETED output is eligible.
      const all=s.db.prepare("SELECT attempt_id,owner,artist_name,project_name,policy_json FROM live_studio_projects ORDER BY rowid DESC").all() as (Selected&{policy_json:string})[];
      // Inventory diagnostics distinguish missing Super Admin proof from
      // unfinished and unavailable outputs, without exposing private media.
      const classified=all.map(row=>{
        const approved=superAdminPolicy(row.policy_json);
        let state="missing";
        let outputReady=false;
        if(approved){
          try{const a=s.get(row.attempt_id);state=a.state;outputReady=a.state==="completed"&&!!a.outputPath;}catch{state="missing";}
        }
        return {...row,approved,state,outputReady};
      });
      const completedStudio=classified.filter(row=>row.approved&&row.outputReady&&
        !s.db.prepare("SELECT 1 FROM public_showcase_hidden WHERE attempt_id=?").get(row.attempt_id)).map(row=>({id:row.attempt_id,name:row.project_name?.trim()||row.artist_name,owner:row.owner,artistName:row.artist_name}));
      const uploaded=s.db.prepare("SELECT id,title FROM public_showcase_uploads ORDER BY created_at DESC").all() as {id:string;title:string}[];
      const hiddenVideos=classified.filter(row=>row.approved&&row.outputReady&&
        !!s.db.prepare("SELECT 1 FROM public_showcase_hidden WHERE attempt_id=?").get(row.attempt_id))
       .map(row=>({id:row.attempt_id,name:row.project_name?.trim()||row.artist_name}));
      const eligible=[...completedStudio.map(row=>({...row,source:"generated" as const})),
        ...uploaded.map(row=>({id:row.id,name:row.title,owner:"cms-upload",artistName:row.title,source:"upload" as const}))];
      const inventory={
        totalStudioRecords:all.length,
        verifiedSuperAdmin:classified.filter(row=>row.approved).length,
        completedSuperAdmin:completedStudio.length,
        uploadedVideos:uploaded.length,
        incompleteSuperAdmin:classified.filter(row=>row.approved&&!row.outputReady&&row.state!=="missing").length,
        missingOutputRecord:classified.filter(row=>row.approved&&row.state==="missing").length,
        unverifiedLegacy:classified.filter(row=>!row.approved).length,
        published:validated().length,
        hiddenGenerated:hiddenVideos.length
      };
      if(req.method==="GET"){
        const published=validated();
        const selectedIds=published.map(v=>v.attempt_id);
        const config=s.db.prepare("SELECT random_order FROM public_showcase_channel_config WHERE channel=?").get(channel) as {random_order:number}|undefined;
        return json({channel,randomOrder:channel==="mobile"&&(config?.random_order??1)===1,
          projects:eligible.map(p=>({...p,selected:selectedIds.includes(p.id),posterUrl:posterUrl(p.id)})),
          hiddenVideos,published:published.map((p,index)=>({id:p.attempt_id,title:p.artist_name,position:index+1})),inventory});
      }
      if(req.method==="POST"){
        const body=await req.json() as {action?:unknown;id?:unknown;ids?:unknown;randomOrder?:unknown};
        if(body.action==="hide-generated"||body.action==="restore-generated"){
          const id=body.id;
          if(typeof id!=="string"||!/^[a-f0-9-]{36}$/i.test(id))
            return json({error:"Invalid generated video ID."},400);
          const selected=classified.find(row=>row.attempt_id===id&&row.approved&&row.outputReady);
          if(!selected)return json({error:"Generated video is not available for curation."},404);
          s.db.exec("BEGIN IMMEDIATE");
          try{
            if(body.action==="hide-generated"){
              s.db.prepare("INSERT OR IGNORE INTO public_showcase_hidden(attempt_id,hidden_at) VALUES(?,?)").run(id,Date.now());
              s.db.prepare("DELETE FROM public_showcase_entries WHERE attempt_id=?").run(id);
              s.db.prepare("DELETE FROM public_showcase_selection WHERE attempt_id=?").run(id);
            }else s.db.prepare("DELETE FROM public_showcase_hidden WHERE attempt_id=?").run(id);
            s.db.exec("COMMIT");
          }catch(error){s.db.exec("ROLLBACK");throw error;}
          return json({ok:true,id,hidden:body.action==="hide-generated"});
        }
        // An explicit complete ordered set supports publishing, removal,
        // reordering, and clearing without any fixed three-item ceiling.
        if(body.action!=="set-list"||!Array.isArray(body.ids)||body.ids.length>500||!body.ids.every((id:unknown)=>typeof id==="string"&&id.length>0&&id.length<=160)||new Set(body.ids).size!==body.ids.length)return json({error:"Invalid ordered showcase selection"},400);
        if(body.randomOrder!==undefined&&typeof body.randomOrder!=="boolean")return json({error:"Invalid random order setting"},400);
        const chosen=body.ids.map(id=>eligible.find(p=>p.id===id));
        if(chosen.some(v=>!v))return json({error:"Only completed Super Admin videos may be published"},403);
        s.db.exec("BEGIN IMMEDIATE");
        try{
          s.db.prepare("DELETE FROM public_showcase_entries WHERE channel=?").run(channel);
          const add=s.db.prepare("INSERT INTO public_showcase_entries(channel,attempt_id,owner,artist_name,sort_order) VALUES(?,?,?,?,?)");
          for(const [index,p] of chosen.entries()){if(p)add.run(channel,p.id,p.owner,p.name,index);}
          const previous=s.db.prepare("SELECT random_order FROM public_showcase_channel_config WHERE channel=?").get(channel) as {random_order:number}|undefined;
          const randomOrder=channel==="mobile"?(body.randomOrder===undefined?previous?.random_order===1:body.randomOrder):false;
          s.db.prepare("INSERT OR REPLACE INTO public_showcase_channel_config(channel,explicitly_configured,random_order) VALUES(?,1,?)").run(channel,randomOrder?1:0);
          s.db.exec("COMMIT");
        }catch(error){s.db.exec("ROLLBACK");throw error;}
        return json({ok:true,channel,published:chosen.length});
      }
      return json({error:"Method not allowed"},405);
    }
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
    // CMS Super Admin identity is the publication authorization. Private
    // operator sessions are ephemeral; historical Super Admin recordings
    // often belong to an older media-session owner. Filter by the immutable
    // server-authenticated generation policy instead of current session.
    // This cannot include customer, guest, or editor-generated projects.
    const rows=s.db.prepare("SELECT attempt_id,owner,artist_name,project_name,policy_json FROM live_studio_projects ORDER BY rowid DESC LIMIT 500").all() as (Selected&{policy_json:string})[];
    const verified=rows.filter(row=>superAdminPolicy(row.policy_json)&&!s.db.prepare("SELECT 1 FROM public_showcase_hidden WHERE attempt_id=?").get(row.attempt_id));
    const eligible=verified.flatMap(row=>{
      try{const a=s.get(row.attempt_id);return a.state==="completed"&&a.outputPath?[{id:row.attempt_id,name:row.project_name?.trim()||row.artist_name,owner:row.owner}]:[]}catch{return []}
    });
    if(req.method==="GET"){
      const projects=eligible.map(row=>({...row,selected:selected?.attempt_id===row.id}));
      const selectedIds=Object.fromEntries(slots.map(slotName=>[slotName,(s.db.prepare("SELECT attempt_id FROM public_showcase_selection WHERE slot=?").get(slotName) as {attempt_id:string}|undefined)?.attempt_id||null]));
      return json({projects,selectedId:selectedIds.main,selectedIds,inventory:{totalRecorded:rows.length,superAdminRecorded:verified.length,completedSuperAdmin:eligible.length}});
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
            s.db.prepare("INSERT INTO public_showcase_selection (slot,attempt_id,owner,artist_name) VALUES (?,?,?,?) ON CONFLICT(slot) DO UPDATE SET attempt_id=excluded.attempt_id,owner=excluded.owner,artist_name=excluded.artist_name").run(target,row.id,row.owner,row.name);
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
      s.db.prepare("INSERT INTO public_showcase_selection (slot,attempt_id,owner,artist_name) VALUES (?,?,?,?) ON CONFLICT(slot) DO UPDATE SET attempt_id=excluded.attempt_id,owner=excluded.owner,artist_name=excluded.artist_name").run(target,eligibleRow.id,eligibleRow.owner,eligibleRow.name);
      return json({ok:true,title:eligibleRow.name,videoUrl:"/api/showcase?video=1&slot="+target});
    }
    return json({error:"Method not allowed"},405);
  }catch(e){console.error("Showcase request failed",e);return json({error:"Showcase unavailable"},500);}
}
export const GET=handler;
export const POST=handler;
