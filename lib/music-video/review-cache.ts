/** A rendered review has one local A/V clock and no network range requests
 * while playing or seeking. Session only: the caller revokes the object URL. */
export const REVIEW_MAX_BYTES=128*1024*1024;
export async function downloadReview(url:string,signal:AbortSignal,onProgress:(percent:number)=>void):Promise<Blob>{
 const response=await fetch(url,{credentials:"same-origin",cache:"no-store",redirect:"error",signal});
 const length=Number(response.headers.get("content-length"));
 if(response.status!==200||response.headers.get("content-type")?.split(";")[0]!=="video/mp4"||!Number.isSafeInteger(length)||length<1||length>REVIEW_MAX_BYTES||!response.body)throw Error("Synced preview download unavailable. Tap Play to retry.");
 const reader=response.body.getReader(),chunks:Uint8Array<ArrayBuffer>[]=[];
 let count=0,last=-1;
 try{
  while(true){
   signal.throwIfAborted();
   const {done,value}=await reader.read();if(done)break;
   count+=value.byteLength;if(count>length||count>REVIEW_MAX_BYTES)throw Error("Synced preview exceeds its download limit.");
   chunks.push(new Uint8Array(value));
   const percent=Math.floor(count*100/length);
   if(percent!==last){last=percent;onProgress(percent);}
  }
  signal.throwIfAborted();
  if(count!==length)throw Error("Incomplete synced preview. Tap Play to retry.");
  return new Blob(chunks,{type:"video/mp4"});
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
