import {constants} from "node:fs";
import {lstat,open,realpath,type FileHandle} from "node:fs/promises";
import path from "node:path";
import {Readable} from "node:stream";

/** Open only the immutable paid MP4 associated with this particular order.
 * The caller must first verify the active authenticated account, paid status,
 * acknowledged delivery and owner-scoped asset record.
 * The returned handle must be closed by the caller or its streaming response. */
export async function openVerifiedPaidVideoFile(
 mediaDirectory:string,registeredPath:string,orderId:string,expectedBytes:number
):Promise<{handle:FileHandle;size:number}>{
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(orderId) ||
    !Number.isSafeInteger(expectedBytes)||expectedBytes<1)
  throw Error("Invalid private video reference");
 const root=await realpath(mediaDirectory);
 const expected=path.join(root,`paid-${orderId}.mp4`);
 // Require the exact immutable per-order name, not another asset in the root.
 if(path.resolve(registeredPath)!==expected || await realpath(registeredPath)!==expected)
  throw Error("Private video path does not match paid order");
 const before=await lstat(registeredPath);
 if(!before.isFile()||before.nlink!==1||before.size!==expectedBytes||
    (before.mode & 0o077)!==0)
  throw Error("Private video file metadata mismatch");
 const handle=await open(registeredPath,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const current=await handle.stat();
  if(!current.isFile()||current.nlink!==1||
     (current.mode & 0o077)!==0||
     current.dev!==before.dev||current.ino!==before.ino||
     current.size!==expectedBytes)
   throw Error("Private video file changed during open");
  return {handle,size:current.size};
 }catch(error){
  await handle.close();
  throw error;
 }
}

/** A private byte range is tied to the request lifecycle. Cancelling the web
 * stream or aborting the request destroys the underlying Node stream and closes
 * its opened file handle; no separate file descriptor is leaked. */
export function streamVerifiedPaidVideoRange(
 handle:FileHandle,start:number,end:number,signal?:AbortSignal
):ReadableStream<Uint8Array>{
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start)
  throw Error("Invalid private video range");
 return Readable.toWeb(handle.createReadStream({start,end,autoClose:true,signal})) as ReadableStream<Uint8Array>;
}
