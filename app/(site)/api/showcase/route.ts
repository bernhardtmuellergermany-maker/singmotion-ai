import { NextRequest } from "next/server";
import { getPayload } from "payload";
import payloadConfig from "@payload-config";
import { hasRole } from "@/cms/policy";
import { stagingDenial } from "@/lib/staging";
import { dataDir } from "@/lib/db";
import { openStudioStore } from "@/lib/live/studio";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
type Selected={attempt_id:string;owner:string;artist_name:string};
async function store(){
  const s=await openStudioStore(dataDir);
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
    const selected=s.db.prepare("SELECT attempt_id,owner,artist_name FROM public_showcase_selection WHERE slot='main'").get() as Selected|undefined;
    const video=req.nextUrl.searchParams.has("video");
    if(req.method==="GET"&&video){
      if(!selected)return json({error:"No public showcase selected"},404);
      const project=s.db.prepare("SELECT attempt_id FROM live_studio_projects WHERE attempt_id=? AND owner=?").get(selected.attempt_id,selected.owner);
      if(!project)return json({error:"Showcase unavailable"},404);
      const attempt=s.get(selected.attempt_id);
      if(attempt.state!=="completed"||!attempt.outputPath)return json({error:"Showcase unavailable"},404);
      const file=attempt.outputPath;
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
    if(req.method==="GET"&&!req.nextUrl.searchParams.has("admin"))return json({title:selected?.artist_name||"SingMotion AI Showcase",videoUrl:selected?"/api/showcase?video=1":""});
    if(!await admin(req))return json({error:"Super-admin authorization required"},403);
    if(req.method==="GET"){
      const rows=s.db.prepare("SELECT attempt_id,owner,artist_name FROM live_studio_projects ORDER BY rowid DESC LIMIT 500").all() as Selected[];
      const projects=rows.flatMap(row=>{try{const a=s.get(row.attempt_id);return a.state==="completed"&&a.outputPath?[{id:row.attempt_id,artist:row.artist_name,owner:row.owner,selected:selected?.attempt_id===row.attempt_id}]:[]}catch{return [];}});
      return json({projects,selectedId:selected?.attempt_id||null});
    }
    if(req.method==="POST"){
      const body=await req.json() as {id?:string};
      if(typeof body.id!=="string"||body.id.length>160)return json({error:"Invalid project ID"},400);
      const row=s.db.prepare("SELECT attempt_id,owner,artist_name FROM live_studio_projects WHERE attempt_id=?").get(body.id) as Selected|undefined;
      if(!row)return json({error:"Project not found"},404);
      const a=s.get(row.attempt_id);
      if(a.state!=="completed"||!a.outputPath)return json({error:"Project video is not completed"},409);
      await stat(a.outputPath);
      s.db.prepare("INSERT INTO public_showcase_selection (slot,attempt_id,owner,artist_name) VALUES ('main',?,?,?) ON CONFLICT(slot) DO UPDATE SET attempt_id=excluded.attempt_id,owner=excluded.owner,artist_name=excluded.artist_name").run(row.attempt_id,row.owner,row.artist_name);
      return json({ok:true,title:row.artist_name,videoUrl:"/api/showcase?video=1"});
    }
    return json({error:"Method not allowed"},405);
  }catch(e){console.error("Showcase request failed",e);return json({error:"Showcase unavailable"},500);}
}
export const GET=handler;
export const POST=handler;
