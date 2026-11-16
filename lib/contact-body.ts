/** Prevent oversized contact payloads from entering memory before the limit is checked.
 * Content-Length can be absent or dishonest, so enforce a streaming byte limit.
 * Contains no customer data logging and performs no external I/O.
 */
export async function readContactBody(
 request: Pick<Request,"body">,maxBytes=12_000
):Promise<string|null>{
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1)return null;
 const reader=request.body?.getReader();
 if(!reader)return "";
 const chunks:Uint8Array[]=[];
 let total=0;
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   if(!(value instanceof Uint8Array))return null;
   total+=value.byteLength;
   if(total>maxBytes){
    await reader.cancel().catch(()=>{});
    return null;
   }
   chunks.push(value);
  }
  return Buffer.concat(chunks,total).toString("utf8");
 }catch{
  return null;
 }finally{
  reader.releaseLock();
 }
}
