import {NextRequest} from "next/server";
import {getPayload} from "payload";
import payloadConfig from "@payload-config";
import {hasRole} from "@/cms/policy";
import {stagingDenial} from "@/lib/staging";
import {dataDir} from "@/lib/db";
import {openStudioStore} from "@/lib/live/studio";
import {mkdir,writeFile,readFile,unlink} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import path from "node:path";
import sharp from "sharp";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const root=path.join(dataDir,"showcase-media");
const respond=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
type ImageKind="desktop-bg"|"mobile-fallback"|"final-cta-bg";
const imageKind=(s:string):s is ImageKind=>s==="desktop-bg"||s==="mobile-fallback"||s==="final-cta-bg";
async function superAdmin(req:NextRequest){
 if(process.env.CMS_ENABLED!=="true")return false;
 const cms=await getPayload({config:payloadConfig});
 const {user}=await cms.auth({headers:req.headers});
 return hasRole(user,["super-admin"]);
}
async function tables(){
 const s=await openStudioStore(dataDir);
 s.db.exec("CREATE TABLE IF NOT EXISTS public_showcase_uploads(id TEXT PRIMARY KEY,title TEXT NOT NULL,filename TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,created_at INTEGER NOT NULL)");
 s.db.exec("CREATE TABLE IF NOT EXISTS public_showcase_backgrounds(kind TEXT PRIMARY KEY,filename TEXT NOT NULL,created_at INTEGER NOT NULL)");
 return s;
}
export async function GET(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 try{
  const kind=req.nextUrl.searchParams.get("kind")||"";
  if(!imageKind(kind))return respond({error:"Invalid background"},400);
  const s=await tables();
  const row=s.db.prepare("SELECT filename FROM public_showcase_backgrounds WHERE kind=?").get(kind) as {filename:string}|undefined;
  if(!row)return Response.redirect(new URL("/artwork/singmotion-stage.webp",req.url),307);
  const bytes=await readFile(path.join(root,row.filename));
  return new Response(new Uint8Array(bytes),{headers:{"Content-Type":"image/webp","Cache-Control":"public,max-age=60","X-Content-Type-Options":"nosniff"}});
 }catch(e){console.error("Showcase artwork unavailable",e);return Response.redirect(new URL("/artwork/singmotion-stage.webp",req.url),307);}
}
export async function POST(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 if(!await superAdmin(req))return respond({error:"Super Admin required"},403);
 const length=Number(req.headers.get("content-length")||0);
 if(length>90*1024*1024)return respond({error:"Upload is too large (max 80 MiB video)"},413);
 try{
  const form=await req.formData();
  const kind=form.get("kind");
  const file=form.get("file");
  if(!(file instanceof File)||typeof kind!=="string")return respond({error:"File and kind required"},400);
  await mkdir(root,{recursive:true,mode:0o700});
  const s=await tables();
  if(imageKind(kind)){
   if(file.size<100||file.size>5*1024*1024)return respond({error:"Image must be 5 MiB or less"},413);
   if(!["image/png","image/webp","image/jpeg"].includes(file.type))return respond({error:"JPEG, PNG or WebP required"},415);
   const buffer=Buffer.from(await file.arrayBuffer());
   const metadata=await sharp(buffer,{limitInputPixels:20000000}).metadata();
   if(!["jpeg","png","webp"].includes(metadata.format||"")||!metadata.width||!metadata.height||(metadata.pages||1)!==1)return respond({error:"Invalid image"},415);
   const output=await sharp(buffer,{limitInputPixels:20000000}).rotate().webp({quality:86}).toBuffer();
   const filename=randomUUID()+".webp";
   await writeFile(path.join(root,filename),output,{flag:"wx",mode:0o600});
   const previous=s.db.prepare("SELECT filename FROM public_showcase_backgrounds WHERE kind=?").get(kind) as {filename:string}|undefined;
   s.db.prepare("INSERT INTO public_showcase_backgrounds(kind,filename,created_at) VALUES(?,?,?) ON CONFLICT(kind) DO UPDATE SET filename=excluded.filename,created_at=excluded.created_at").run(kind,filename,Date.now());
   if(previous)void unlink(path.join(root,previous.filename)).catch(()=>{});
   return respond({ok:true,kind,url:"/api/showcase-media?kind="+kind});
  }
  if(kind!=="video")return respond({error:"Invalid upload type"},400);
  if(file.size<1024||file.size>80*1024*1024)return respond({error:"Video must be under 80 MiB"},413);
  if(!["video/mp4","video/webm"].includes(file.type))return respond({error:"MP4 or WebM required"},415);
  const buffer=Buffer.from(await file.arrayBuffer());
  const mp4=buffer.length>12&&buffer.toString("ascii",4,8)==="ftyp";
  const webm=buffer[0]===0x1a&&buffer[1]===0x45&&buffer[2]===0xdf&&buffer[3]===0xa3;
  if(file.type==="video/mp4"&&!mp4||file.type==="video/webm"&&!webm)return respond({error:"Video file signature does not match its format"},415);
  const id="upload-"+randomUUID();
  const filename=id+(mp4?".mp4":".webm");
  const titleRaw=form.get("title");
  const title=typeof titleRaw==="string"&&titleRaw.trim()?titleRaw.trim().slice(0,120):file.name.slice(0,120);
  await writeFile(path.join(root,filename),buffer,{flag:"wx",mode:0o600});
  s.db.prepare("INSERT INTO public_showcase_uploads(id,title,filename,mime,size,created_at) VALUES(?,?,?,?,?,?)").run(id,title,filename,file.type,file.size,Date.now());
  return respond({ok:true,id,title});
 }catch(e){console.error("Showcase upload failed",e);return respond({error:"Upload failed"},500);}
}
