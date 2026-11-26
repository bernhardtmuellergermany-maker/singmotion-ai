import {open} from "node:fs/promises";
import {PROJECT_VIDEO_MAX_BYTES} from "./media-limits.ts";
export class VideoUploadError extends Error{
 readonly status:number;
 constructor(message:string,status=400){super(message);this.status=status;}
}
export function parseVideoUpload(headers:Headers,max=PROJECT_VIDEO_MAX_BYTES){
 let name:string;
 try{name=decodeURIComponent(headers.get("x-project-filename")??"");}catch{throw new VideoUploadError("Invalid video filename.");}
 if(!name||name.length>255||/[\x00-\x1f\x7f/\\]/.test(name))throw new VideoUploadError("Invalid video filename.");
 const extension=/\.mp4$/i.test(name)?"mp4":/\.webm$/i.test(name)?"webm":null;
 if(!extension)throw new VideoUploadError("Use an MP4 or WebM video.");
 const value=headers.get("x-project-bytes")??"",size=Number(value),length=headers.get("content-length");
 if(!/^\d+$/.test(value)||!Number.isSafeInteger(size)||size<1)throw new VideoUploadError("Invalid upload size.");
 if(size>max)throw new VideoUploadError("File too large.",413);
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)!==size))throw new VideoUploadError("Upload length mismatch.");
 return {name,extension,size};
}
/** Never accumulate an entire upload in JS memory; reject overlong bodies even
 * when the client lies about the Content-Length or uses chunked transport. */
export async function writeVideoUpload(body:ReadableStream<Uint8Array>|null,file:string,size:number,signal?:AbortSignal){
 if(!body||!Number.isSafeInteger(size)||size<1||size>PROJECT_VIDEO_MAX_BYTES)throw new VideoUploadError("Invalid upload.");
 const handle=await open(file,"wx",0o600),reader=body.getReader();let total=0;
 const abort=()=>{void reader.cancel().catch(()=>{});};
 signal?.addEventListener("abort",abort,{once:true});
 try{
  if(signal?.aborted)throw new VideoUploadError("Upload interrupted.",408);
  for(;;){
   const item=await reader.read();
   if(signal?.aborted)throw new VideoUploadError("Upload interrupted.",408);
   if(item.done)break;
   total+=item.value.byteLength;
   if(total>size)throw new VideoUploadError("File too large.",413);
   await handle.writeFile(item.value);
  }
  if(total!==size)throw new VideoUploadError("Upload length mismatch.");
 }finally{
  signal?.removeEventListener("abort",abort);
  try{await reader.cancel().catch(()=>{});}finally{reader.releaseLock();await handle.close();}
 }
}
