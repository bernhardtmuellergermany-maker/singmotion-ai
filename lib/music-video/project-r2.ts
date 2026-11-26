/** Owner-scoped immutable R2 objects for Projects videos and songs. */
import {createHash,randomUUID,randomBytes} from "node:crypto";
import {lstat,realpath,mkdtemp,rm,copyFile,stat,statfs,readdir,open} from "node:fs/promises";
import {createReadStream} from "node:fs";
import {PROJECT_VIDEO_MAX_BYTES} from "./media-limits.ts";
import {tmpdir} from "node:os";
import path from "node:path";
import {S3Client,PutObjectCommand,GetObjectCommand,DeleteObjectCommand,HeadObjectCommand} from "@aws-sdk/client-s3";
import {loadR2Config,r2ClientConfig} from "../live/r2-config.ts";
export type ProjectCloudRecord={key:string;sha256:string;bytes:number};
const sha=(b:Buffer|string)=>createHash("sha256").update(b).digest("hex");
const MiB=1024*1024,limit=128*MiB,videoLimit=PROJECT_VIDEO_MAX_BYTES;
const uuid=/^[a-f0-9-]{36}$/i;
const customer=/^customer:[a-f0-9-]{36}$/i;
export const songSlots=["song-original.mp3","song-original.wav","song-original.m4a","song.mp3"] as const;
export type SongSlot=typeof songSlots[number];
export const songAssetId=(project:string,slot:SongSlot)=>project+":"+slot;
const validSongAsset=(project:string,asset:string)=>songSlots.some(slot=>songAssetId(project,slot)===asset);
const byteLimit=(asset:string)=>uuid.test(asset)?videoLimit:limit;
const environment=(env:Record<string,string|undefined>)=>env.RAILWAY_ENVIRONMENT_ID==="dfaeabed-03df-43ed-aa71-50f343a75041"?"staging":env.RAILWAY_ENVIRONMENT_ID==="36adc41d-7e54-4396-ad1a-fd432ba0441d"?"production":null;
export function projectR2Enabled(env:Record<string,string|undefined>=process.env){return !!environment(env)&&env.PROJECT_VIDEO_R2_ENABLED==="true"&&env.PROJECT_VIDEO_R2_VERIFIED==="true";}
export function projectCloudKey(owner:string,project:string,asset:string,digest:string,env:Record<string,string|undefined>=process.env){
 const scope=environment(env);
 if(!scope||!(/^staff:[A-Za-z0-9_-]{1,100}$/.test(owner)||customer.test(owner))||!uuid.test(project)||!(uuid.test(asset)||validSongAsset(project,asset))||!/^[a-f0-9]{64}$/.test(digest))throw Error("Invalid Projects cloud identity");
 return ["projects-video","v1",scope,sha(owner),project,asset,digest].join("/");
}
export function validProjectCloudRecord(owner:string,project:string,asset:string,record:ProjectCloudRecord,env:Record<string,string|undefined>=process.env){
 try{return Number.isSafeInteger(record.bytes)&&record.bytes>0&&record.bytes<=byteLimit(asset)&&record.key===projectCloudKey(owner,project,asset,record.sha256,env);}catch{return false;}
}
type Sender={send:(command:PutObjectCommand|GetObjectCommand|DeleteObjectCommand)=>Promise<any>};
export async function verifyCloudStream(client:Sender,bucket:string,record:ProjectCloudRecord,consume?:(chunk:Buffer)=>Promise<void>){
 const response=await client.send(new GetObjectCommand({Bucket:bucket,Key:record.key}));
 if(!response.Body||response.ContentLength!==record.bytes||response.Metadata?.["singmotion-sha256"]!==record.sha256)throw Error("Projects R2 metadata mismatch");
 if(!Number.isSafeInteger(record.bytes)||record.bytes<1||record.bytes>videoLimit)throw Error("Projects R2 body exceeds bound");
 const digest=createHash("sha256");let total=0;
 for await(const chunk of response.Body as AsyncIterable<Uint8Array>){total+=chunk.length;if(total>record.bytes)throw Error("Projects R2 body exceeds bound");digest.update(chunk);if(consume)await consume(Buffer.from(chunk));}
 if(total!==record.bytes||digest.digest("hex")!==record.sha256)throw Error("Projects R2 checksum mismatch");
}
export async function verifiedCloudBytes(client:Sender,bucket:string,record:ProjectCloudRecord){
 const chunks:Buffer[]=[];
 await verifyCloudStream(client,bucket,record,async chunk=>{chunks.push(chunk);});
 return Buffer.concat(chunks,record.bytes);
}
export async function mirrorProjectBytes(client:Sender,bucket:string,key:string,bytes:Buffer,mime:string){
 if(bytes.length<1||bytes.length>(mime.startsWith("video/")?videoLimit:limit))throw Error("Projects media exceeds limit");
 const record={key,sha256:sha(bytes),bytes:bytes.length};
 try{await client.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:bytes,ContentLength:bytes.length,ContentType:mime,ContentMD5:createHash("md5").update(bytes).digest("base64"),Metadata:{"singmotion-sha256":record.sha256},CacheControl:"private, no-store",IfNoneMatch:"*"}));}
 catch(e){if((e as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode!==412)throw e;}
 await verifyCloudStream(client,bucket,record);
 return record;
}
export async function safeLocalProjectVideo(folder:string,asset:string,extension:string){
 if(!uuid.test(asset)||!["mp4","webm"].includes(extension))throw Error("Invalid Projects source");
 const root=await realpath(folder),file=path.join(root,asset+"."+extension);
 const s=await lstat(file);
 if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size<1||s.size>videoLimit||await realpath(file)!==file)throw Error("Invalid local Projects video");
 return file;
}
export async function safeLocalProjectSong(folder:string,slot:SongSlot){
 const root=await realpath(folder),file=path.join(root,slot),s=await lstat(file);
 if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size<1||s.size>limit||await realpath(file)!==file)throw Error("Invalid local Projects song");
 return file;
}
export async function mirrorProjectVideo(owner:string,project:string,asset:string,file:string,mime:string){
 if(!projectR2Enabled())throw Error("Projects R2 writes disabled");
 const info=await stat(file);if(info.size<1||info.size>byteLimit(asset))throw Error("Projects media exceeds limit");
 const digest=createHash("sha256"),md5=createHash("md5");let total=0;
 for await(const chunk of createReadStream(file)){total+=chunk.length;if(total>info.size)throw Error("Projects source changed");digest.update(chunk);md5.update(chunk);}
 if(total!==info.size)throw Error("Projects source changed");
 const hash=digest.digest("hex"),key=projectCloudKey(owner,project,asset,hash),record={key,sha256:hash,bytes:total};
 const config=loadR2Config(),client=new S3Client(r2ClientConfig(config));
 try{
  const body=createReadStream(file);
  try{await client.send(new PutObjectCommand({Bucket:config.bucket,Key:key,Body:body,ContentLength:total,ContentType:mime,ContentMD5:md5.digest("base64"),Metadata:{"singmotion-sha256":hash},CacheControl:"private, no-store",IfNoneMatch:"*"}),{abortSignal:AbortSignal.timeout(180000)});}
  catch(e){if((e as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode!==412)throw e;}
  finally{body.destroy();}
  await verifyCloudStream({send:command=>client.send(command as any,{abortSignal:AbortSignal.timeout(180000)})},config.bucket,record);
  return record;
 }finally{client.destroy();}
}
export async function readProjectVideo(owner:string,project:string,asset:string,record:ProjectCloudRecord){
 if(!validProjectCloudRecord(owner,project,asset,record))throw Error("Invalid Projects cloud manifest");
 const config=loadR2Config(),client=new S3Client(r2ClientConfig(config));
 try{return await verifiedCloudBytes(client,config.bucket,record);}finally{client.destroy();}
}
export async function deleteProjectVideo(owner:string,project:string,asset:string,record:ProjectCloudRecord){
 if(!validProjectCloudRecord(owner,project,asset,record))throw Error("Invalid Projects cloud manifest");
 const config=loadR2Config(),client=new S3Client(r2ClientConfig(config));
 try{
  await client.send(new DeleteObjectCommand({Bucket:config.bucket,Key:record.key}),{abortSignal:AbortSignal.timeout(15000)});
  try{await client.send(new HeadObjectCommand({Bucket:config.bucket,Key:record.key}),{abortSignal:AbortSignal.timeout(15000)});}
  catch(e){if((e as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode===404)return;throw e;}
  throw Error("Projects R2 deletion not confirmed");
 }finally{client.destroy();}
}
// Direct private Range reads: the browser never sees bucket URLs or credentials.
export async function projectVideoResponse(req:Request,owner:string,project:string,asset:string,record:ProjectCloudRecord,mime:string,headers:Record<string,string>,downloadName?:string){
 if(!validProjectCloudRecord(owner,project,asset,record))throw Error("Invalid Projects cloud manifest");
 const size=record.bytes,etag='"'+record.sha256+'"';
 const base={...headers,"Cache-Control":"private, no-cache","Vary":"Cookie, Authorization","ETag":etag,"Content-Type":mime,"Accept-Ranges":"bytes",...(downloadName?{"Content-Disposition":'attachment; filename="'+downloadName+'"'}:{})};
 const ifRange=req.headers.get("if-range"),range=!ifRange||ifRange===etag?req.headers.get("range"):null;
 if(!range&&!downloadName&&req.headers.get("if-none-match")===etag)return new Response(null,{status:304,headers:base});
 let start=0,end=size-1;
 const invalid=()=>new Response(null,{status:416,headers:{...base,"Content-Range":"bytes */"+size}});
 if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m||(!m[1]&&!m[2]))return invalid();
 const a=Number(m[1]),b=Number(m[2]);if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||(!m[1]&&b<=0))return invalid();
 start=m[1]?a:Math.max(0,size-b);end=m[1]&&m[2]?Math.min(b,size-1):size-1;if(start>end||start>=size)return invalid();}
 const config=loadR2Config(),client=new S3Client(r2ClientConfig(config));
 try{
  const response=await client.send(new GetObjectCommand({Bucket:config.bucket,Key:record.key,...(range?{Range:"bytes="+start+"-"+end}:{})}),{abortSignal:req.signal});
  const length=end-start+1,expected="bytes "+start+"-"+end+"/"+size;
  if(!response.Body||response.ContentLength!==length||response.Metadata?.["singmotion-sha256"]!==record.sha256||(range&&response.ContentRange!==expected))throw Error("Projects R2 range mismatch");
  const reader=response.Body.transformToWebStream().getReader();
  const body=new ReadableStream<Uint8Array>({async pull(controller){try{const next=await reader.read();if(next.done){client.destroy();controller.close();}else controller.enqueue(next.value);}catch(e){client.destroy();controller.error(e);}},async cancel(reason){try{await reader.cancel(reason);}finally{client.destroy();}}});
  return new Response(body,{status:range?206:200,headers:{...base,"Content-Length":String(length),...(range?{"Content-Range":expected}:{})}});
 }catch(e){client.destroy();throw e;}
}
// Per-request working copies are bounded globally and removed after rendering.
let reserved=0;
export class ProjectScratch{
 private folder:string|undefined;
 private bytes=0;
 async materialize(asset:string,ext:string,size:number,work:(file:string)=>Promise<void>){
  if(!(uuid.test(asset)||/^[a-f0-9-]{36}:song(?:-original)?\.(mp3|wav|m4a)$/.test(asset))||!["mp4","webm","mp3","wav","m4a"].includes(ext)||size<1||size>byteLimit(asset))throw Error("Invalid Projects scratch source");
  const fs=await statfs(tmpdir());
  if(reserved+size>768*MiB||fs.bavail*fs.bsize-reserved-size<256*MiB)throw Error("Projects temporary storage full");
  reserved+=size;this.bytes+=size;
  this.folder??=await mkdtemp(path.join(tmpdir(),"sm-project-source-"));
  const file=path.join(this.folder,asset+"."+ext);
  await work(file);
  return file;
 }
 async hydrate(owner:string,project:string,asset:string,ext:string,record:ProjectCloudRecord){
  if(!validProjectCloudRecord(owner,project,asset,record))throw Error("Invalid Projects cloud manifest");
  return this.materialize(asset,ext,record.bytes,async file=>{
   const config=loadR2Config(),client=new S3Client(r2ClientConfig(config));
   try{
    const handle=await open(file,"wx",0o600);
    try{await verifyCloudStream({send:command=>client.send(command as any,{abortSignal:AbortSignal.timeout(180000)})},config.bucket,record,async chunk=>{await handle.writeFile(chunk);});}
    finally{await handle.close();}
   }finally{client.destroy();}
  });
 }
 async copy(asset:string,ext:string,source:string){return this.materialize(asset,ext,(await stat(source)).size,async file=>{await copyFile(source,file);});}
 async close(){const folder=this.folder;this.folder=undefined;const bytes=this.bytes;this.bytes=0;try{if(folder)await rm(folder,{recursive:true,force:true});}finally{reserved-=bytes;}}
}

// Startup probe uses a unique synthetic object, never actual project/customer data.
// The parent process grants the child write/migration flag only after this passes.
export async function projectR2Canary(){
 if(!environment(process.env)||process.env.PROJECT_VIDEO_R2_ENABLED!=="true")return false;
 const owner="staff:canary-"+randomUUID(),project=randomUUID(),asset=randomUUID(),bytes=randomBytes(1024);
 const key=projectCloudKey(owner,project,asset,sha(bytes));
 const cfg=loadR2Config(),client=new S3Client(r2ClientConfig(cfg));
 let verified=false,deleted=false;
 try{
  const bounded={send:(command:PutObjectCommand|GetObjectCommand|DeleteObjectCommand)=>client.send(command as any,{abortSignal:AbortSignal.timeout(12000)})};
  const record=await mirrorProjectBytes(bounded,cfg.bucket,key,bytes,"video/mp4");
  const range=await client.send(new GetObjectCommand({Bucket:cfg.bucket,Key:key,Range:"bytes=10-39"}),{abortSignal:AbortSignal.timeout(12000)});
  if(!range.Body||range.ContentLength!==30||range.ContentRange!=="bytes 10-39/1024"||!Buffer.from(await range.Body.transformToByteArray()).equals(bytes.subarray(10,40)))throw Error("Projects R2 range verification failed");
  verified=record.bytes===1024;
 }catch{/* No provider secrets or object identifiers in logs. */}
 finally{
  try{
   await client.send(new DeleteObjectCommand({Bucket:cfg.bucket,Key:key}),{abortSignal:AbortSignal.timeout(12000)});
   try{await client.send(new HeadObjectCommand({Bucket:cfg.bucket,Key:key}),{abortSignal:AbortSignal.timeout(12000)});}
   catch(e){deleted=(e as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode===404;}
  }catch{}finally{client.destroy();}
 }
 return verified&&deleted;
}

/** Startup-only cleanup of disposable files left by a terminated previous process.
 * Never walk DATA_DIR or delete a project original. */
export async function cleanupProjectTemp(){
 const root=tmpdir(),names=await readdir(root,{withFileTypes:true});
 for(const entry of names){
  if(!entry.isDirectory()||entry.isSymbolicLink())continue;
  if(!/^(sm-project-source-[A-Za-z0-9]{6}|sm-project-upload-[A-Za-z0-9]{6}|sm-music-export-[A-Za-z0-9]{6}|singmotion-project-mobile-v1|singmotion-project-mobile-720-v2|singmotion-project-preview-v1)$/.test(entry.name))continue;
  const file=path.join(root,entry.name),info=await lstat(file).catch(()=>null);
  if(info?.isDirectory()&&!info.isSymbolicLink()&&Date.now()-info.mtimeMs>6*60*60*1000)await rm(file,{recursive:true,force:true}).catch(()=>{});
 }
}
