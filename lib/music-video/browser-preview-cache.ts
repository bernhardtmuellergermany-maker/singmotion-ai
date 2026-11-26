/** Private editor-session cache. No persistent browser storage or original downloads. */
export type PreviewCandidate={key:string;url:string};
type Entry={url:string;bytes:number};
export class BrowserPreviewCache {
 private entries=new Map<string,Entry>();
 private failures=new Map<string,number>();
 private wanted:PreviewCandidate[]=[];
 private pinned=new Set<string>();
 private controller:AbortController|null=null;
 private closed=false;
 private running=false;
 private bytes=0;
 private readonly maxBytes:number;
 private readonly maxFile:number;
 private readonly changed:()=>void;
 constructor(mobile:boolean,changed:()=>void){
  this.maxBytes=(mobile?128:192)*1024*1024;
  this.maxFile=(mobile?64:24)*1024*1024;
  this.changed=changed;
 }
 get(key:string){return this.entries.get(key)?.url;}
 update(wanted:PreviewCandidate[],pinned:string[]){
  if(this.closed)return;
  this.wanted=wanted.filter((v,i,a)=>a.findIndex(x=>x.key===v.key)===i).slice(0,6);
  this.pinned=new Set(pinned);
  for(const {key} of this.wanted){const value=this.entries.get(key);if(value){this.entries.delete(key);this.entries.set(key,value);}}
  void this.pump();
 }
 private evict(key:string){
  const entry=this.entries.get(key);if(!entry)return;
  URL.revokeObjectURL(entry.url);this.entries.delete(key);this.bytes-=entry.bytes;
 }
 private async pump(){
  if(this.running||this.closed)return;
  this.running=true;
  try{
   while(!this.closed){
    const next=this.wanted.find(x=>!this.entries.has(x.key)&&Date.now()-(this.failures.get(x.key)??0)>15000);
    if(!next)break;
    const controller=new AbortController();this.controller=controller;
    try{
     const response=await fetch(next.url,{credentials:"same-origin",cache:"no-store",redirect:"error",signal:controller.signal});
     const length=Number(response.headers.get("content-length"));
     if(!response.ok||response.status!==200||response.headers.get("content-type")?.split(";")[0]!=="video/mp4"||!Number.isSafeInteger(length)||length<1||length>this.maxFile||!response.body)throw Error("Preview unavailable");
     // Do not allocate beyond the total budget, even during download.
     for(const key of this.entries.keys()){
      if(this.bytes+length<=this.maxBytes)break;
      if(!this.pinned.has(key)&&!this.wanted.some(x=>x.key===key))this.evict(key);
     }
     if(this.bytes+length>this.maxBytes)throw Error("Preview cache full");
     const reader=response.body.getReader(),parts:Uint8Array<ArrayBuffer>[]=[];
     let count=0;
     try{
      while(true){
       const {done,value}=await reader.read();if(done)break;
       count+=value.byteLength;if(count>length||count>this.maxFile)throw Error("Preview exceeds bound");
       parts.push(new Uint8Array(value));
      }
     }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
     if(count!==length||this.closed)throw Error("Incomplete preview");
     const url=URL.createObjectURL(new Blob(parts,{type:"video/mp4"}));
     this.entries.set(next.key,{url,bytes:count});this.bytes+=count;this.changed();
    }catch{this.failures.set(next.key,Date.now());}
    finally{controller.abort();if(this.controller===controller)this.controller=null;}
   }
  }finally{this.running=false;}
 }
 close(){this.closed=true;this.controller?.abort();for(const key of this.entries.keys())this.evict(key);this.wanted=[];this.pinned.clear();}
}
