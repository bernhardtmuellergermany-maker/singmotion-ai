import {NextRequest} from "next/server";
import {createReadStream} from "node:fs";
import {Readable} from "node:stream";
import {mkdir,writeFile,rename,rm,stat,unlink} from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {stagingDenial} from "@/lib/staging";
import {applicationOrigin} from "@/lib/request-origin";
import {dataDir,session} from "@/lib/db";
import {validateAudio,createAudioPreview,probe} from "@/lib/media";
import {AUDIO_LIMIT} from "@/lib/domain";
import {CommerceStore} from "@/lib/commerce/store";
import {openStudioStore} from "@/lib/live/studio";
import {studioRuntime} from "@/lib/live/studio-runtime";
import {musicPrincipal} from "@/lib/music-video/auth";
import {
  MusicError,validId,projectFolder,requireMusicProject,listMusicProjects,
  newMusicProject,musicDetail,renameMusicProject,removeMusicProject,
  newMusicAsset,musicAsset,removeMusicAsset,saveMusicClips,setMusicAssetRole,
  type MediaKind,type SourceKind,type MusicClip,
} from "@/lib/music-video/core";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const common={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:common});
type Context={params:Promise<{parts?:string[]}>};
const toMs=(s:number)=>Math.round(s*1000);
function checkOrigin(req:NextRequest){
  const origin=applicationOrigin(req.url,req.headers.get("host"));
  if(!origin||req.headers.get("origin")!==origin)throw new MusicError("Invalid request origin.",403);
}
async function jsonBody(req:NextRequest):Promise<Record<string,unknown>>{
  if(Number(req.headers.get("content-length"))>131072)throw new MusicError("Request too large.",413);
  const text=await req.text();
  if(Buffer.byteLength(text)>131072)throw new MusicError("Request too large.",413);
  let body:unknown;try{body=JSON.parse(text)}catch{throw new MusicError("Invalid JSON.");}
  if(!body||typeof body!=="object"||Array.isArray(body))throw new MusicError("Invalid request.");
  return body as Record<string,unknown>;
}
async function fileForm(req:NextRequest,maxBytes:number,name:string){
  if(Number(req.headers.get("content-length"))>maxBytes+1048576)throw new MusicError("File too large.",413);
  const form=await req.formData(),file=form.get(name);
  if(!(file instanceof File)||file.size<1||file.size>maxBytes)throw new MusicError("Upload a supported file.",413);
  return {form,file};
}
async function streamFile(req:NextRequest,filename:string,mime:string){
  const info=await stat(filename);
  if(!info.isFile()||info.size<1)throw new MusicError("Media unavailable.",404);
  const size=info.size,range=req.headers.get("range");
  let start=0,end=size-1,status=200;
  if(range){
    const match=/^bytes=(\d+)-(\d*)$/.exec(range);
    if(!match)return new Response(null,{status:416,headers:{...common,"Content-Range":"bytes */"+size}});
    start=Number(match[1]);end=match[2]?Number(match[2]):size-1;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||end>=size)
      return new Response(null,{status:416,headers:{...common,"Content-Range":"bytes */"+size}});
    status=206;
  }
  return new Response(Readable.toWeb(createReadStream(filename,{start,end})) as ReadableStream,{
    status,headers:{...common,"Content-Type":mime,"Accept-Ranges":"bytes",
      "Content-Length":String(end-start+1),
      ...(status===206?{"Content-Range":"bytes "+start+"-"+end+"/"+size}:{})}
  });
}
async function sourceMetadata(req:NextRequest,owner:string,sourceKind:SourceKind,ref:string){
  if(!validId(ref))throw new MusicError("Invalid source video.",400);
  if(sourceKind==="live"&&owner.startsWith("staff:")){
    // The source cannot be associated by its UUID alone; verify the
    // authenticated staff media workspace and actual completed output.
    const logged=session(req.cookies.get("sm_session")?.value);
    if(logged?.owner!=="cms-staff-"+owner.slice(6))throw new MusicError("Open Videos while signed into this account.",403);
    const live=await openStudioStore(dataDir);
    try{
      const service=studioRuntime(live,dataDir,process.env,true,false).service;
      const p=service.view(ref,logged.owner);
      if(!p.outputReady||p.hidden||service.trashedAt(ref,logged.owner)!==null)throw new MusicError("Only available completed videos can be added.",409);
      await service.output(ref,logged.owner);
      const from=toMs(p.selection.start),to=toMs(p.selection.end),duration=toMs(p.durationSeconds);
      return {kind:"lip-sync" as MediaKind,name:p.displayName||p.projectName||p.artistName||"Lip Sync",durationMs:duration,
        sourceStartMs:from,sourceEndMs:to};
    }finally{live.db.close();}
  }
  if(sourceKind==="paid"&&owner.startsWith("customer:")){
    const accountId=owner.slice(9);
    const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
    try{
      store.ownedOrder(ref,accountId,undefined);
      if(!store.ownedDeliveredVideoAsset(ref,accountId,undefined))throw new MusicError("Video is not ready.",409);
      const row=store.db.prepare("SELECT CASE WHEN json_valid(media_json) THEN json_extract(media_json,\'$.durationSeconds\') ELSE NULL END AS duration_seconds FROM customer_prepared_media WHERE order_id=?").get(ref) as {duration_seconds?:number}|undefined;
      const duration=Number(row?.duration_seconds);
      if(!Number.isFinite(duration)||duration<=0)throw new MusicError("Video duration unavailable.",409);
      return {kind:"ai-video" as MediaKind,name:"Generated video",durationMs:toMs(duration),sourceStartMs:null,sourceEndMs:null};
    }finally{store.close();}
  }
  throw new MusicError("Source video access denied.",403);
}
async function handler(req:NextRequest,context:Context){
  const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
  try{
    const owner=await musicPrincipal(req.headers,req.cookies.get("sm_customer")?.value||"");
    if(!owner)throw new MusicError("Music Video Builder access denied.",403);
    if(req.method!=="GET")checkOrigin(req);
    const [id,section,assetId]=(await context.params).parts||[];
    if(!id){
      if(req.method==="GET")return json({projects:listMusicProjects(owner)});
      if(req.method!=="POST")throw new MusicError("Unsupported method.",405);
      const {form,file}=await fileForm(req,AUDIO_LIMIT,"song");
      const title=form.get("name");
      if(typeof title!=="string")throw new MusicError("Project name required.");
      const extension=file.name.toLowerCase().endsWith(".mp3")?"mp3":file.name.toLowerCase().endsWith(".wav")?"wav":file.name.toLowerCase().endsWith(".m4a")?"m4a":null;
      if(!extension)throw new MusicError("Use MP3, WAV or M4A audio.");
      const buffer=Buffer.from(await file.arrayBuffer());
      const temp=path.join(dataDir,"music-video","upload-"+randomUUID()+"."+extension);
      let project:ReturnType<typeof newMusicProject>|null=null;
      try{
        await mkdir(path.dirname(temp),{recursive:true,mode:0o700});
        await writeFile(temp,buffer,{flag:"wx",mode:0o600});
        const duration=await validateAudio(temp);
        project=newMusicProject(owner,title,toMs(duration));
        await mkdir(projectFolder(project.id),{recursive:true,mode:0o700});
        await rename(temp,path.join(projectFolder(project.id),"song-original."+extension));
        if(extension==="mp3")await writeFile(path.join(projectFolder(project.id),"song.mp3"),buffer,{flag:"wx",mode:0o600});
        else await createAudioPreview(path.join(projectFolder(project.id),"song-original."+extension),path.join(projectFolder(project.id),"song.mp3"));
        return json({project},201);
      }catch(e){
        if(project){removeMusicProject(project.id,owner);await rm(projectFolder(project.id),{recursive:true,force:true});}
        throw e;
      }finally{await rm(temp,{force:true});}
    }
    const project=requireMusicProject(id,owner);
    if(!section){
      if(req.method==="GET")return json(musicDetail(id,owner));
      if(req.method==="PATCH"){
        const body=await jsonBody(req);
        return json({project:renameMusicProject(id,owner,body.name)});
      }
      if(req.method==="DELETE"){
        removeMusicProject(id,owner);
        await rm(projectFolder(id),{recursive:true,force:true});
        return json({deleted:true});
      }
    }
    if(section==="song"&&req.method==="GET"&&!assetId)
      return await streamFile(req,path.join(projectFolder(project.id),"song.mp3"),"audio/mpeg");
    if(section==="clips"&&req.method==="PATCH"&&!assetId){
      const body=await jsonBody(req);
      return json(saveMusicClips(id,owner,body.revision,body.clips as MusicClip[],body.songStartMs,body.songEndMs,body.songPositionMs,body.songParts));
    }
    if(section==="lip-sync"&&!assetId&&req.method==="GET"){
      const logged=session(req.cookies.get("sm_session")?.value);
      if(!owner.startsWith("staff:")||logged?.owner!=="cms-staff-"+owner.slice(6))
        throw new MusicError("Open Studio to establish your private media session.",403);
      const live=await openStudioStore(dataDir);
      try{
        const service=studioRuntime(live,dataDir,process.env,true,false).service;
        const videos=service.list(logged.owner).filter(p=>p.outputReady&&!p.hidden)
          .map(p=>({id:p.id,name:p.displayName||p.projectName||p.artistName||"Lip Sync",
            durationMs:toMs(p.durationSeconds),sourceStartMs:toMs(p.selection.start),sourceEndMs:toMs(p.selection.end)}))
          .filter(p=>p.sourceStartMs>=0&&p.sourceEndMs>p.sourceStartMs);
        return json({videos});
      }finally{live.db.close();}
    }
    if(section==="assets"&&!assetId&&req.method==="POST"){
      const kind=req.headers.get("content-type")||"";
      if(kind.startsWith("application/json")){
        const body=await jsonBody(req);
        const sourceKind=body.sourceKind;
        const sourceId=body.sourceId;
        if((sourceKind!=="live"&&sourceKind!=="paid")||typeof sourceId!=="string")throw new MusicError("Unknown video source.");
        const verified=await sourceMetadata(req,owner,sourceKind,sourceId);
        const asset=newMusicAsset(id,owner,{...verified,sourceKind,sourceId});
        return json({asset},201);
      }
      const {file}=await fileForm(req,50*1024*1024,"video");
      const extension=file.name.toLowerCase().endsWith(".mp4")?"mp4":file.name.toLowerCase().endsWith(".webm")?"webm":null;
      if(!extension)throw new MusicError("Use an MP4 or WebM video.");
      const folder=projectFolder(id);
      await mkdir(folder,{recursive:true,mode:0o700});
      const temporary=path.join(folder,"incoming-"+randomUUID()+"."+extension);
      let saved:ReturnType<typeof newMusicAsset>|null=null;
      try{
        await writeFile(temporary,Buffer.from(await file.arrayBuffer()),{flag:"wx",mode:0o600});
        const media=await probe(temporary);
        if(!media.streams.some(v=>v.codec_type==="video"))throw new MusicError("The file does not contain video.");
        const duration=Number(media.format.duration);
        if(!Number.isFinite(duration)||duration<=0||duration>3600)throw new MusicError("Invalid video duration.");
        saved=newMusicAsset(id,owner,{name:file.name.slice(0,80),kind:"imported",sourceKind:"uploaded",sourceId:extension,durationMs:toMs(duration)});
        await rename(temporary,path.join(/*turbopackIgnore: true*/ folder,saved.id+"."+extension));
        return json({asset:saved},201);
      }catch(error){
        if(saved)removeMusicAsset(id,owner,saved.id);
        throw error;
      }finally{await rm(temporary,{force:true});}
    }
    if(section==="assets"&&assetId){
      const asset=musicAsset(id,owner,assetId);
      if(req.method==="PATCH"){
        const body=await jsonBody(req);
        return json(setMusicAssetRole(id,owner,assetId,body.role,body.revision));
      }
      if(req.method==="DELETE"){
        removeMusicAsset(id,owner,assetId);
        if(asset.sourceKind==="uploaded")await unlink(path.join(/*turbopackIgnore: true*/ projectFolder(id),asset.id+"."+asset.sourceId)).catch(()=>{});
        return json({deleted:true});
      }
      if(req.method==="GET"){
        if(asset.sourceKind==="uploaded")
          return await streamFile(req,path.join(/*turbopackIgnore: true*/ projectFolder(id),asset.id+"."+asset.sourceId),asset.sourceId==="webm"?"video/webm":"video/mp4");
        if(asset.sourceKind==="live")
          return Response.redirect(new URL("/api/studio-live?id="+encodeURIComponent(asset.sourceId||"")+"&video=1",req.url));
        if(asset.sourceKind==="paid")
          return Response.redirect(new URL("/api/customer-video?orderId="+encodeURIComponent(asset.sourceId||""),req.url));
      }
    }
    throw new MusicError("Unknown endpoint.",404);
  }catch(error){
    if(error instanceof MusicError)return json({error:error.message},error.status);
    if((error as NodeJS.ErrnoException)?.code==="ENOENT")return json({error:"Media unavailable."},404);
    console.warn("MUSIC_VIDEO_REQUEST_FAILED",{method:req.method,error:"internal"});
    return json({error:"Unable to complete the request."},500);
  }
}
export const GET=handler;
export const POST=handler;
export const PATCH=handler;
export const DELETE=handler;
