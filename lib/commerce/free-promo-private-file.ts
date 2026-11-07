import {constants} from "node:fs";
import {createHash} from "node:crypto";
import {lstat,open,realpath,type FileHandle} from "node:fs/promises";
import path from "node:path";

/** Securely reopen the exact owner-authorized free MP4 for range streaming.
 * Hash is checked on every open against the permanent private manifest.
 */
export async function openVerifiedFreeVideoFile(
 mediaDirectory:string,orderId:string,bytes:number,sha256:string,
):Promise<FileHandle>{
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(orderId)||
  !Number.isSafeInteger(bytes)||bytes<1||bytes>100*1024*1024||
  !/^[a-f0-9]{64}$/.test(sha256))
  throw Error("Invalid private free-video manifest");
 const root=await realpath(mediaDirectory);
 const file=path.join(root,`free-${orderId}.mp4`);
 if(await realpath(file)!==file)throw Error("Private free-video path mismatch");
 const before=await lstat(file);
 if(!before.isFile()||before.nlink!==1||before.size!==bytes||
  (before.mode&0o077)!==0)throw Error("Private free-video metadata mismatch");
 const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const opened=await handle.stat();
  if(!opened.isFile()||opened.nlink!==1||opened.size!==bytes||
   (opened.mode&0o077)!==0||opened.dev!==before.dev||opened.ino!==before.ino)
   throw Error("Private free-video file changed");
  const digest=createHash("sha256");let read=0;
  for await(const chunk of handle.createReadStream({autoClose:false})){
   read+=chunk.length;
   if(read>bytes)throw Error("Private free-video size changed");
   digest.update(chunk);
  }
  const after=await handle.stat();
  if(read!==bytes||digest.digest("hex")!==sha256||
   after.ino!==opened.ino||after.size!==bytes||after.mtimeMs!==opened.mtimeMs)
   throw Error("Private free-video digest mismatch");
  return handle;
 }catch(error){await handle.close();throw error}
}
