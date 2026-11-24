import {NextRequest} from "next/server";
import {createReadStream} from "node:fs";
import {Readable} from "node:stream";
import {mkdir,writeFile,rename,rm,stat,unlink,realpath,readFile,readdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {stagingDenial} from "@/lib/staging";
import {applicationOrigin} from "@/lib/request-origin";
import {dataDir,session} from "@/lib/db";
import {validateAudio,createAudioPreview,probe} from "@/lib/media";
import {AUDIO_LIMIT} from "@/lib/domain";
import {CommerceStore} from "@/lib/commerce/store";
import {openStudioStore} from "@/lib/live/studio";
import {studioRuntime} from "@/lib/live/studio-runtime";
import {musicPrincipal} from "@/lib/music-video/auth";
import {startMusicExport,musicExportStatus,musicExportFile,inspectVideoDimensions} from "@/lib/music-video/export";
import {
  MusicError,validId,projectFolder,requireMusicProject,listMusicProjects,
  newMusicProject,musicDetail,renameMusicProject,renameMusicSong,fillMusicSongName,removeMusicProject,
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
async function streamFile(req:NextRequest,filename:string,mime:string,revalidate=false){
  const info=await stat(filename);
  if(!info.isFile()||info.size<1)throw new MusicError("Media unavailable.",404);
  const size=info.size;
  const etag='"'+createHash("sha256").update(filename+":"+size+":"+info.mtimeMs).digest("hex")+'"';
  const headers:Record<string,string>=revalidate?{...common,"Cache-Control":"private, no-cache","Vary":"Cookie, Authorization","ETag":etag}:common;
  const ifRange=req.headers.get("if-range");
  const range=!ifRange||ifRange===etag?req.headers.get("range"):null;
  if(revalidate&&!range&&req.headers.get("if-none-match")===etag)return new Response(null,{status:304,headers});
  let start=0,end=size-1,status=200;
  if(range){
    const match=/^bytes=(\d*)-(\d*)$/.exec(range);
    if(!match||(!match[1]&&!match[2]))return new Response(null,{status:416,headers:{...headers,"Content-Range":"bytes */"+size}});
    const a=Number(match[1]),b=Number(match[2]);
    if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||(!match[1]&&b<=0))return new Response(null,{status:416,headers:{...headers,"Content-Range":"bytes */"+size}});
    start=match[1]?a:Math.max(0,size-b);end=match[1]&&match[2]?Math.min(b,size-1):size-1;
    if(start>end||start>=size)return new Response(null,{status:416,headers:{...headers,"Content-Range":"bytes */"+size}});
    status=206;
  }
  return new Response(Readable.toWeb(createReadStream(filename,{start,end})) as ReadableStream,{
    status,headers:{...headers,"Content-Type":mime,"Accept-Ranges":"bytes",
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
      const file=await service.output(ref,logged.owner);
      // The prepared provider audio may have been slowed down; the delivered MP4 is authoritative for clip length.
      const inspected=await probe(file);
      const stream=inspected.streams.find(s=>s.codec_type==="video");
      const measured=Number(stream?.duration??inspected.format.duration);
      if(!stream||!Number.isFinite(measured)||measured<=0)throw new MusicError("Delivered video duration unavailable.",409);
      const from=toMs(p.selection.start),to=toMs(p.selection.end),duration=toMs(measured);
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
async function exportSources(req:NextRequest,owner:string,id:string,detail:ReturnType<typeof musicDetail>,assetIds=detail.clips.map(c=>c.assetId)){
  const files=new Map<string,string>(),assets=new Map(detail.assets.map(a=>[a.id,a]));
  for(const aid of new Set(assetIds)){
    const a=assets.get(aid);
    if(!a)throw new MusicError("A source video is missing.",409);
    if(a.sourceKind==="uploaded"){
      if(a.sourceId!=="mp4"&&a.sourceId!=="webm")throw new MusicError("Invalid source video.",409);
      const root=await realpath(projectFolder(id)),file=await realpath(path.join(/*turbopackIgnore: true*/ root,a.id+"."+a.sourceId));
      if(!file.startsWith(root+path.sep)||!(await stat(file)).isFile())throw new MusicError("Source video unavailable.",409);
      files.set(aid,file);
    }else if(a.sourceKind==="live"&&a.sourceId&&owner.startsWith("staff:")){
      const logged=session(req.cookies.get("sm_session")?.value);
      if(logged?.owner!=="cms-staff-"+owner.slice(6))throw new MusicError("Open Videos to establish your private media session.",403);
      const live=await openStudioStore(dataDir);
      try{
        const service=studioRuntime(live,dataDir,process.env,true,false).service;
        const p=service.view(a.sourceId,logged.owner);
        if(!p.outputReady||p.hidden||service.trashedAt(a.sourceId,logged.owner)!==null)throw new MusicError("A SingMotion source video is unavailable.",409);
        files.set(aid,await service.output(a.sourceId,logged.owner));
      }finally{live.db.close();}
    }else throw new MusicError("This source cannot be exported in the private editor.",409);
  }
  return files;
}
// Private, small thumbnails: deduplicate requests and limit concurrent decoders.
const thumbnailJobs=new Map<string,Promise<Buffer>>();
let thumbnailSlots=0;
const thumbnailWaiters:Array<()=>void>=[];
async function withThumbnailSlot<T>(work:()=>Promise<T>):Promise<T>{
  if(thumbnailSlots>=2)await new Promise<void>(resolve=>thumbnailWaiters.push(resolve));
  else thumbnailSlots++;
  try{return await work();}
  finally{const next=thumbnailWaiters.shift();if(next)next();else thumbnailSlots--;}
}
async function libraryThumbnail(projectId:string,assetId:string,file:string,durationMs:number):Promise<Buffer>{
  const cached=path.join(projectFolder(projectId),assetId+".thumb-v1.jpg");
  const previous=await readFile(cached).catch(()=>null);
  if(previous?.length)return previous;
  const pending=thumbnailJobs.get(cached);if(pending)return pending;
  if(thumbnailJobs.size>=100)throw new MusicError("Thumbnail queue busy.",503);
  const job=withThumbnailSlot(async()=>{
    const existing=await readFile(cached).catch(()=>null);if(existing?.length)return existing;
    const frame=async(at:number)=>{
      const {stdout}=await promisify(execFile)("ffmpeg",["-nostdin","-hide_banner","-loglevel","error","-threads","1","-ss",String(at),"-i",file,"-map","0:v:0","-an","-sn","-dn","-frames:v","1","-vf","scale=320:240:force_original_aspect_ratio=decrease:force_divisible_by=2","-threads","1","-c:v","mjpeg","-q:v","5","-f","image2pipe","pipe:1"],{encoding:"buffer",timeout:15000,maxBuffer:512*1024});
      if(stdout.length<4||stdout[0]!==255||stdout[1]!==216)throw new Error("No thumbnail frame");
      return stdout;
    };
    let image:Buffer;
    try{image=await frame(Math.min(0.5,durationMs/5000));}catch{image=await frame(0);}
    const temp=cached+"."+randomUUID()+".tmp";
    try{await writeFile(temp,image,{flag:"wx",mode:0o600});await rename(temp,cached);}catch{/* The decoded image is still usable. */}
    finally{await rm(temp,{force:true}).catch(()=>{});}
    return image;
  });
  thumbnailJobs.set(cached,job);
  try{return await job;}finally{thumbnailJobs.delete(cached);}
}
// Cache compact waveform data, not decoded audio in the browser. Bound FFmpeg work.
const waveJobs=new Map<string,Promise<number[]>>();
async function songWaveform(id:string):Promise<number[]>{
  const cached=path.join(projectFolder(id),"song.wave-v1.json");
  const old=await readFile(cached,"utf8").then(v=>JSON.parse(v) as number[]).catch(()=>null);
  if(old?.length===240)return old;
  const pending=waveJobs.get(id);if(pending)return pending;
  if(waveJobs.size>=2)return [];
  const job=(async()=>{
    const {stdout}=await promisify(execFile)("ffmpeg",["-nostdin","-hide_banner","-loglevel","error","-threads","1","-i",path.join(projectFolder(id),"song.mp3"),"-vn","-sn","-dn","-ac","1","-ar","2000","-t","3600","-f","s16le","pipe:1"],{encoding:"buffer",timeout:30000,maxBuffer:16*1024*1024});
    const samples=Math.floor(stdout.length/2);
    if(!samples)return [];
    const peaks=Array.from({length:240},(_,i)=>{
      let peak=0;const from=Math.floor(i*samples/240),to=Math.floor((i+1)*samples/240);
      for(let j=from;j<to;j++)peak=Math.max(peak,Math.abs(stdout.readInt16LE(j*2))/32768);
      return Math.max(.07,Math.round(peak*1000)/1000);
    });
    const temp=cached+"."+randomUUID()+".tmp";
    try{await writeFile(temp,JSON.stringify(peaks),{flag:"wx",mode:0o600});await rename(temp,cached);}catch{}finally{await rm(temp,{force:true}).catch(()=>{});}
    return peaks;
  })();
  waveJobs.set(id,job);
  try{return await job;}finally{waveJobs.delete(id);}
}

// Private, disposable preview cache. Never replace or transcode the original for export.
// One encoder, at most six 24 MiB files; long/unavailable media fall back to the original.
const previewRoot=(mobile=false)=>{const root=path.join(tmpdir(),mobile?"singmotion-project-mobile-v1":"singmotion-project-preview-v1");return mkdir(root,{recursive:true,mode:0o700}).then(()=>root);};
const previewJobs=new Map<string,Promise<boolean>>();
async function previewPath(id:string,assetId:string,file:string,mobile=false){
  const info=await stat(file);
  const key=createHash("sha256").update(id+":"+assetId+":"+info.size+":"+info.mtimeMs).digest("hex");
  return path.join(await previewRoot(mobile),key+".mp4");
}
async function readyPreview(file:string){
  return stat(file).then(s=>s.isFile()&&s.size>1024&&s.size<=24*1024*1024).catch(()=>false);
}
async function preparePreview(file:string,target:string,durationMs:number,mobile=false):Promise<boolean>{
  if(await readyPreview(target))return true;
  if(durationMs>180000)return false;
  const pending=previewJobs.get(target);if(pending)return pending;
  if(previewJobs.size)return false;
  const job=(async()=>{
    const dir=path.dirname(target);
    const names=await readdir(dir);
    // Remove abandoned partial encodes after a process restart; no other encoder runs here.
    await Promise.all(names.filter(n=>/^[a-f0-9]{64}\.mp4\.[a-f0-9-]{36}\.tmp\.mp4$/.test(n)).map(n=>rm(path.join(dir,n),{force:true}).catch(()=>{})));
    const entries=await Promise.all(names.filter(n=>/^[a-f0-9]{64}\.mp4$/.test(n)).map(async n=>({file:path.join(dir,n),info:await stat(path.join(dir,n)).catch(()=>null)})));
    const old=entries.filter(e=>e.info).sort((a,b)=>a.info!.mtimeMs-b.info!.mtimeMs);
    while(old.length>=(mobile?8:6)){const first=old.shift()!;await rm(first.file,{force:true});}
    const temp=target+"."+randomUUID()+".tmp.mp4";
    try{
      await promisify(execFile)("ffmpeg",["-nostdin","-hide_banner","-loglevel","error","-threads","1","-i",file,"-map","0:v:0","-map","0:a:0?","-sn","-dn","-filter_threads","1","-vf",mobile?"scale=w='min(640,iw)':h='min(640,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,fps=30":"scale=w='min(854,iw)':h='min(854,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1","-c:v","libx264","-threads","1","-preset","veryfast","-crf",mobile?"26":"24","-maxrate",mobile?"400k":"800k","-bufsize",mobile?"800k":"1600k","-g",mobile?"15":"30",...(mobile?["-profile:v","baseline","-level:v","3.1"]:[]),"-pix_fmt","yuv420p","-c:a","aac","-b:a",mobile?"64k":"96k","-movflags","+faststart",temp],{timeout:90000,maxBuffer:65536});
      if(!await readyPreview(temp))return false;
      await rename(temp,target);return true;
    }catch{return false;}finally{await rm(temp,{force:true}).catch(()=>{});}
  })();
  previewJobs.set(target,job);
  try{return await job;}finally{previewJobs.delete(target);}
}

function cleanSongName(name:unknown):string|null{
 if(typeof name!=="string")return null;
 return name.replace(/[\x00-\x1f\x7f]/g," ").trim().slice(0,180)||null;
}
async function originalSongTitle(file:string):Promise<string|null>{
 try{
  const {stdout}=await promisify(execFile)("ffprobe",["-v","error","-show_entries","format_tags=title:stream_tags=title","-of","json",file],{timeout:5000,maxBuffer:32768});
  const tags=JSON.parse(stdout) as {format?:{tags?:Record<string,string>};streams?:Array<{tags?:Record<string,string>}>};
  return cleanSongName(tags.format?.tags?.title??tags.format?.tags?.TITLE??tags.streams?.find(s=>s.tags?.title||s.tags?.TITLE)?.tags?.title??tags.streams?.find(s=>s.tags?.TITLE)?.tags?.TITLE);
 }catch{return null;}
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
        const songName=await originalSongTitle(temp)||cleanSongName(file.name.replace(/\.(mp3|wav|m4a)$/i,""))||"Untitled song";
        project=newMusicProject(owner,title,toMs(duration),form.get("aspectRatio")??"auto",songName);
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
      if(req.method==="GET"){
        if(!project.songName){
          for(const ext of ["mp3","wav","m4a"]){
            const file=path.join(projectFolder(id),"song-original."+ext);
            if(!await stat(file).then(s=>s.isFile()).catch(()=>false))continue;
            const title=await originalSongTitle(file);
            if(title)fillMusicSongName(id,owner,title);
            break;
          }
        }
        return json(musicDetail(id,owner));
      }
      if(req.method==="PATCH"){
        const body=await jsonBody(req);
        return json({project:body.songName!==undefined?renameMusicSong(id,owner,body.songName):renameMusicProject(id,owner,body.name)});
      }
      if(req.method==="DELETE"){
        removeMusicProject(id,owner);
        await rm(projectFolder(id),{recursive:true,force:true});
        return json({deleted:true});
      }
    }
    if(section==="song"&&req.method==="GET"&&!assetId)
      return await streamFile(req,path.join(projectFolder(project.id),"song.mp3"),"audio/mpeg",true);
    if(section==="waveform"&&req.method==="GET"&&!assetId){
      const peaks=await songWaveform(id).catch(()=>[]);
      return json({peaks});
    }
    if(section==="preview"&&assetId&&validId(assetId)&&(req.method==="GET"||req.method==="POST")){
      const asset=musicAsset(id,owner,assetId);
      const files=await exportSources(req,owner,id,musicDetail(id,owner),[assetId]);
      const original=files.get(assetId)!;
      const mobile=req.nextUrl.searchParams.get("mobile")==="1";
      const target=await previewPath(id,assetId,original,mobile);
      if(req.method==="POST")return json({ready:await preparePreview(original,target,asset.durationMs,mobile),unsupported:asset.durationMs>180000});
      if(await readyPreview(target))return await streamFile(req,target,"video/mp4",true);
      // Mobile must not silently fall back to a heavyweight original.
      if(mobile)return json({error:"Mobile preview not ready."},409);
      // Evicted preview: use original, preserving the source clock.
      return Response.redirect(new URL("/api/music-video/"+id+"/assets/"+assetId,req.url));
    }
    if(section==="clips"&&req.method==="PATCH"&&!assetId){
      const body=await jsonBody(req);
      return json(saveMusicClips(id,owner,body.revision,body.clips as MusicClip[],body.songStartMs,body.songEndMs,body.songPositionMs,body.songParts,body.trackMutes,body.aspectRatio));
    }
    if(section==="thumbnail"&&assetId&&validId(assetId)&&req.method==="GET"){
      const asset=musicAsset(id,owner,assetId);
      const detail=musicDetail(id,owner);
      const files=await exportSources(req,owner,id,detail,[assetId]);
      const etag='"mv-thumb-v1-'+asset.id+'"';
      const headers={...common,"Content-Type":"image/jpeg","Cache-Control":"private, no-cache","ETag":etag};
      if(req.headers.get("if-none-match")===etag)return new Response(null,{status:304,headers});
      const image=await libraryThumbnail(id,assetId,files.get(assetId)!,asset.durationMs);
      return new Response(new Uint8Array(image),{headers:{...headers,"Content-Length":String(image.length)}});
    }
    if(section==="format"&&assetId&&validId(assetId)&&req.method==="GET"){
      const detail=musicDetail(id,owner);
      const files=await exportSources(req,owner,id,detail,[assetId]);
      return json(await inspectVideoDimensions(files.get(assetId)!));
    }
    if(section==="export"){
      if(!assetId&&req.method==="POST"){
        const body=await jsonBody(req),detail=musicDetail(id,owner);
        if(body.revision!==detail.project.revision)throw new MusicError("Save your latest changes before exporting.",409);
        const files=await exportSources(req,owner,id,detail);
        const folder=projectFolder(id);
        let songFile=path.join(folder,"song.mp3");
        for(const ext of ["wav","m4a","mp3"]){const candidate=path.join(/*turbopackIgnore: true*/ folder,"song-original."+ext);if(await stat(candidate).then(s=>s.isFile()).catch(()=>false)){songFile=candidate;break;}}
        try{return json(await startMusicExport(owner,detail.project,detail.clips,files,songFile),202);}
        catch(e){throw new MusicError(e instanceof Error?e.message:"Export unavailable.",409);}
      }
      if(assetId&&validId(assetId)&&req.method==="GET"){
        if(req.nextUrl.searchParams.has("download")){
          const result=await musicExportFile(owner,id,assetId);
          if(!result)throw new MusicError("Export is not ready or has expired.",404);
          const size=(await stat(result.file)).size;
          const name=result.name.replace(/[^A-Za-z0-9_. -]/g,"_").trim()||"music-video";
          return new Response(Readable.toWeb(createReadStream(result.file)) as ReadableStream,{headers:{...common,"Content-Type":"video/mp4","Content-Length":String(size),"Content-Disposition":'attachment; filename="'+name+'.mp4"'}});
        }
        const job=await musicExportStatus(owner,id,assetId);
        if(!job)throw new MusicError("Export has expired or the server restarted. Start a new export.",404);
        return json(job);
      }
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
        await unlink(path.join(projectFolder(id),asset.id+".thumb-v1.jpg")).catch(()=>{});
        if(asset.sourceKind==="uploaded")await unlink(path.join(/*turbopackIgnore: true*/ projectFolder(id),asset.id+"."+asset.sourceId)).catch(()=>{});
        return json({deleted:true});
      }
      if(req.method==="GET"){
        if(req.nextUrl.searchParams.has("download")){
          // Recheck the project and original media ownership before streaming.
          if(asset.sourceKind==="paid")return Response.redirect(new URL("/api/customer-video?orderId="+encodeURIComponent(asset.sourceId||"")+"&download=1",req.url));
          const files=await exportSources(req,owner,id,musicDetail(id,owner),[assetId]);
          const file=files.get(assetId)!;
          const extension=asset.sourceKind==="uploaded"&&asset.sourceId==="webm"?"webm":"mp4";
          const name=(asset.name.replace(/\.(mp4|webm)$/i,"").replace(/[^A-Za-z0-9_. -]/g,"_").trim()||"video")+"."+extension;
          const info=await stat(file);
          if(!info.isFile()||info.size<1)throw new MusicError("Media unavailable.",404);
          return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream,{headers:{...common,"Content-Type":extension==="webm"?"video/webm":"video/mp4","Content-Length":String(info.size),"Content-Disposition":'attachment; filename="'+name+'"'}});
        }
        if(asset.sourceKind==="uploaded")
          return await streamFile(req,path.join(/*turbopackIgnore: true*/ projectFolder(id),asset.id+"."+asset.sourceId),asset.sourceId==="webm"?"video/webm":"video/mp4",true);
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
