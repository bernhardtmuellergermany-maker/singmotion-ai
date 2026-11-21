import {NextRequest} from "next/server";
import {getPayload} from "payload";
import payloadConfig from "@payload-config";
import {hasRole} from "@/cms/policy";
import {stagingDenial} from "@/lib/staging";
import {showcaseMutationOriginAllowed} from "@/lib/showcase-media-security";
import {dataDir} from "@/lib/db";
import {openStudioStore} from "@/lib/live/studio";
import {validateAudio} from "@/lib/media";
import {randomUUID} from "node:crypto";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {ensureAudioTips,listAudioTips,validTipId,audioMime,sampleFilename,MAX_SAMPLE_BYTES,MAX_LIBRARY_BYTES,MAX_SAMPLES} from "@/lib/audio-quick-tips";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
async function admin(req:NextRequest){
 if(process.env.CMS_ENABLED!=="true")return false;
 const cms=await getPayload({config:payloadConfig});
 const {user}=await cms.auth({headers:req.headers});
 return hasRole(user,["super-admin"]);
}
async function mutationAllowed(req:NextRequest){
 return showcaseMutationOriginAllowed(req.url,req.headers.get("host"),req.headers.get("origin"))&&await admin(req);
}
export async function GET(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 try{
  const manage=req.nextUrl.searchParams.get("manage")==="1";
  if(manage&&!await admin(req))return json({error:"Super Admin required"},403);
  const id=req.nextUrl.searchParams.get("id");
  if(id!==null&&!validTipId(id))return json({error:"Invalid sample"},400);
  const store=await openStudioStore(dataDir);
  try{
   ensureAudioTips(store.db);
   if(id===null)return json({tips:listAudioTips(store.db,manage)});
   const row=store.db.prepare("SELECT audio,mime,size FROM cms_audio_quick_tips WHERE id=?"+(manage?"":" AND active=1")).get(id) as {audio:Uint8Array;mime:string;size:number}|undefined;
   if(!row)return json({error:"Audio sample not available"},404);
   return new Response(new Uint8Array(row.audio),{headers:{"Content-Type":row.mime,"Content-Length":String(row.size),"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Content-Disposition":"attachment"}});
  }finally{store.close();}
 }catch{ return json({error:"Audio library unavailable"},500); }
}
export async function POST(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 try{
  if(!await mutationAllowed(req))return json({error:"Super Admin required or invalid origin"},403);
  if(Number(req.headers.get("content-length")||0)>MAX_SAMPLE_BYTES+65536)return json({error:"Maximal 50 MB pro Audiodatei"},413);
  const form=await req.formData();
  const field=(key:string)=>String(form.get(key)||"").trim();
  const inputId=field("id"),headline=field("headline"),description=field("description"),emoji=field("emoji"),sortOrder=Number(field("sortOrder")||0),active=field("active")==="1"?1:0;
  if((inputId&&!validTipId(inputId))||!headline||headline.length>120||description.length>300||emoji.length>24||!Number.isInteger(sortOrder)||sortOrder<0||sortOrder>9999)return json({error:"Bitte gültige Überschrift und Reihenfolge eingeben"},400);
  const file=form.get("file");
  let bytes:Buffer|null=null,mime:string|null=null;
  if(file instanceof File&&file.size){
   if(file.size>MAX_SAMPLE_BYTES)return json({error:"Maximal 50 MB pro Audiodatei"},413);
   bytes=Buffer.from(await file.arrayBuffer());mime=audioMime(file.name,bytes);
   if(!mime)return json({error:"Nur gültige MP3-, WAV- oder M4A-Dateien"},415);
   const temp=await mkdtemp(path.join(tmpdir(),"sm-audio-tip-"));
   try{
    const source=path.join(temp,sampleFilename("sample",mime));
    await writeFile(source,bytes,{mode:0o600});
    if(await validateAudio(source)<5)return json({error:"Audio muss mindestens 5 Sekunden lang sein"},400);
   }catch{return json({error:"Audiodatei konnte nicht gelesen werden"},415);}
   finally{await rm(temp,{recursive:true,force:true});}
  }
  if(!inputId&&!bytes)return json({error:"Bitte eine Audiodatei hochladen"},400);
  const store=await openStudioStore(dataDir);
  try{
   ensureAudioTips(store.db);
   store.db.exec("BEGIN IMMEDIATE");
   try{
    const existing=inputId?store.db.prepare("SELECT size,mime FROM cms_audio_quick_tips WHERE id=?").get(inputId) as {size:number;mime:string}|undefined:undefined;
    if(inputId&&!existing){store.db.exec("ROLLBACK");return json({error:"Vorlage nicht gefunden"},404);}
    const usage=store.db.prepare("SELECT COUNT(*) AS count,COALESCE(SUM(size),0) AS bytes FROM cms_audio_quick_tips").get() as {count:number;bytes:number};
    if((!existing&&usage.count>=MAX_SAMPLES)||usage.bytes-(existing?.size||0)+(bytes?.length||existing?.size||0)>MAX_LIBRARY_BYTES){store.db.exec("ROLLBACK");return json({error:"Speicherlimit der Audio-Bibliothek erreicht"},413);}
    const id=inputId||randomUUID();
    const effectiveMime=mime||existing!.mime;
    const filename=sampleFilename(headline,effectiveMime);
    if(bytes)store.db.prepare("INSERT INTO cms_audio_quick_tips(id,headline,description,emoji,sort_order,active,filename,mime,size,audio) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET headline=excluded.headline,description=excluded.description,emoji=excluded.emoji,sort_order=excluded.sort_order,active=excluded.active,filename=excluded.filename,mime=excluded.mime,size=excluded.size,audio=excluded.audio").run(id,headline,description,emoji,sortOrder,active,filename,effectiveMime,bytes.length,bytes);
    else store.db.prepare("UPDATE cms_audio_quick_tips SET headline=?,description=?,emoji=?,sort_order=?,active=?,filename=? WHERE id=?").run(headline,description,emoji,sortOrder,active,filename,id);
    store.db.exec("COMMIT");
    return json({ok:true,id});
   }catch(e){store.db.exec("ROLLBACK");throw e;}
  }finally{store.close();}
 }catch{return json({error:"Speichern fehlgeschlagen"},500);}
}
export async function DELETE(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 try{
  if(!await mutationAllowed(req))return json({error:"Super Admin required or invalid origin"},403);
  const id=req.nextUrl.searchParams.get("id")||"";
  if(!validTipId(id))return json({error:"Invalid sample"},400);
  const store=await openStudioStore(dataDir);
  try{
   ensureAudioTips(store.db);
   store.db.prepare("DELETE FROM cms_audio_quick_tips WHERE id=?").run(id);
   return json({ok:true});
  }finally{store.close();}
 }catch{return json({error:"Löschen fehlgeschlagen"},500);}
}
