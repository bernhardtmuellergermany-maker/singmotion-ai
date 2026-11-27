import {ALL_FORMATS,Input,UrlSource,CanvasSink,AudioBufferSink,type WrappedCanvas,type WrappedAudioBuffer} from "mediabunny";
import {frameTarget,TIMELINE_FPS,type FrameTimeline,type FrameClip,type AudioSpan} from "./frame-timeline";
const WINDOW_FRAMES=15,WINDOW_MS=WINDOW_FRAMES*1000/TIMELINE_FPS;
const FRAME_CACHE_LIMIT=4,SOURCE_CACHE_LIMIT=6;
type Source={input:Input;video?:CanvasSink;audio?:AudioBufferSink|null;audioReady?:Promise<AudioBufferSink|null>;videoReady?:Promise<CanvasSink>};
type Sound={buffer:AudioBuffer;at:number;offset:number;duration:number};
type Window={index:number;frames:Map<number,WrappedCanvas|null>;audio:Sound[];start:number;end:number};
type Callbacks={position:(at:number)=>void;playing:(playing:boolean)=>void;buffering:(buffering:boolean)=>void;error:(error:string)=>void};
type SourceUrl=(assetId:string,signal:AbortSignal)=>Promise<string>;

/** Single interactive player. A Web Audio output clock selects canvas frames;
 * there are no independently running video elements. Bounded decode windows
 * are scheduled on the same clock. A late window holds at its exact boundary. */
export class FramePreviewEngine<C extends FrameClip>{
 private canvas:HTMLCanvasElement;
 private context:CanvasRenderingContext2D;
 private audio:AudioContext|null=null;
 private gain:GainNode|null=null;
 private volume=1;
 private timeline:FrameTimeline<C>|null=null;
 private sources=new Map<string,Promise<Source>>();
 private windows=new Map<number,Window>();
 private loading=new Map<number,Promise<Window>>();
 private controller=new AbortController();
 private version=0;
 private seekVersion=0;
 private position=0;
 private intent=false;
 private dragging=false;
 private closed=false;
 private anchorTime=0;
 private anchorPosition=0;
 private running=false;
 private scheduledThrough=0;
 private lastFrame=-1;
 private raf=0;
 private lastPublish=0;
 private buffering=false;
 private scheduled=new Set<AudioBufferSourceNode>();
 private pendingFrame=false;
 private frameWanted=false;
 private starting=false;
 private idleWarm:ReturnType<typeof setTimeout>|null=null;
 constructor(canvas:HTMLCanvasElement,private readonly sourceUrl:SourceUrl,private readonly cb:Callbacks){
  this.canvas=canvas;
  const context=canvas.getContext("2d",{alpha:false});if(!context)throw Error("Canvas preview unavailable.");
  this.context=context;this.black();
 }
 private black(){this.context.fillStyle="#000";this.context.fillRect(0,0,this.canvas.width,this.canvas.height);}
 private setBuffering(value:boolean){if(this.buffering!==value){this.buffering=value;this.cb.buffering(value);}}
 private fail(error:unknown){if(this.closed||this.controller.signal.aborted)return;this.pause();this.cb.error(error instanceof Error?error.message:"Could not decode preview. Tap Play to retry.");}
 private async source(assetId:string):Promise<Source>{
  const cached=this.sources.get(assetId);if(cached){this.sources.delete(assetId);this.sources.set(assetId,cached);return cached;}
  const signal=this.controller.signal;
  const pending=(async()=>{
   const url=await this.sourceUrl(assetId,signal);signal.throwIfAborted();
   const input=new Input({formats:ALL_FORMATS,source:new UrlSource(new Request(url,{credentials:"same-origin",redirect:"error"}),{maxCacheSize:8*1024*1024,parallelism:1,getRetryDelay:attempt=>attempt<3?.5:null})});
   if(signal.aborted){input.dispose();signal.throwIfAborted();}
   return {input} as Source;
  })();
  this.sources.set(assetId,pending);
  pending.catch(()=>{if(this.sources.get(assetId)===pending)this.sources.delete(assetId);});
  // Evict only once all outstanding windows complete (their iterators own inputs).
  return pending;
 }
 private trimSources(){
  if(this.loading.size||this.pendingFrame)return;
  while(this.sources.size>SOURCE_CACHE_LIMIT){const key=this.sources.keys().next().value!;const input=this.sources.get(key)!;this.sources.delete(key);void input.then(s=>s.input.dispose()).catch(()=>{});}
 }
 private async videoSink(assetId:string){
  const s=await this.source(assetId);
  if(!s.videoReady)s.videoReady=(async()=>{const track=await s.input.getPrimaryVideoTrack();if(!track||!await track.canDecode())throw Error("This browser cannot decode the project video. Use an up-to-date Chrome or Safari browser.");return s.video=new CanvasSink(track,{width:this.canvas.width,height:this.canvas.height,fit:"contain",poolSize:0});})();
  return s.videoReady;
 }
 private async audioSink(assetId:string){
  const s=await this.source(assetId);
  if(!s.audioReady)s.audioReady=(async()=>{const track=await s.input.getPrimaryAudioTrack();if(!track){if(assetId==="song")throw Error("Song audio is missing.");return s.audio=null;}if(!await track.canDecode())throw Error("This browser cannot decode the project audio.");return s.audio=new AudioBufferSink(track);})();
  return s.audioReady;
 }
 setTimeline(timeline:FrameTimeline<C>,width:number,height:number,position:number){
  const resize=this.canvas.width!==width||this.canvas.height!==height;
  this.clearWarm();this.stopClock();this.version++;this.seekVersion++;this.controller.abort();
  this.controller=new AbortController();for(const p of this.sources.values())void p.then(s=>s.input.dispose()).catch(()=>{});
  this.sources.clear();this.loading.clear();this.windows.clear();this.lastFrame=-1;this.timeline=timeline;
  if(resize){this.canvas.width=width;this.canvas.height=height;}this.black();
  this.position=Math.max(0,Math.min(timeline.durationMs,position));this.cb.position(this.position);
  this.requestFrame();if(this.intent&&!this.dragging)this.ensureStart();else this.warmWhenIdle();
 }
 setVolume(value:number){this.volume=Math.max(0,Math.min(1,value));if(this.gain&&this.audio)this.gain.gain.setValueAtTime(this.volume,this.audio.currentTime);}
 private async sound(span:AudioSpan,start:number,end:number):Promise<Sound[]>{
  const from=Math.max(start,span.timelineStartMs),to=Math.min(end,span.timelineEndMs);
  if(to<=from)return [];
  const sourceStart=(span.sourceStartMs+from-span.timelineStartMs)/1000,sourceEnd=sourceStart+(to-from)/1000;
  const sink=await this.audioSink(span.assetId);if(!sink)return [];
  const result:Sound[]=[];const seen=new Set<number>();
  const add=(sample:WrappedAudioBuffer|null)=>{
   if(!sample||seen.has(sample.timestamp))return;seen.add(sample.timestamp);
   const lo=Math.max(sourceStart,sample.timestamp),hi=Math.min(sourceEnd,sample.timestamp+sample.buffer.duration);
   if(hi<=lo)return;
   result.push({buffer:sample.buffer,at:from+(lo-sourceStart)*1000,offset:lo-sample.timestamp,duration:hi-lo});
  };
  add(await sink.getBuffer(sourceStart));
  for await(const sample of sink.buffers(sourceStart,sourceEnd))add(sample);
  return result;
 }
 private window(index:number):Promise<Window>{
  const ready=this.windows.get(index);if(ready)return Promise.resolve(ready);
  const pending=this.loading.get(index);if(pending)return pending;
  const version=this.version,signal=this.controller.signal,timeline=this.timeline!;
  const start=index*WINDOW_MS,end=Math.min(timeline.durationMs,start+WINDOW_MS);
  const task=(async()=>{
   const frames=new Map<number,WrappedCanvas|null>();
   const groups=new Map<string,{frame:number;seconds:number}[]>();
   // Partition by clip id: timestamps within one clip always increase.
   for(let frame=index*WINDOW_FRAMES;frame<Math.min((index+1)*WINDOW_FRAMES,timeline.frames);frame++){
    const target=frameTarget(timeline,(frame+.00001)*1000/TIMELINE_FPS)!;
    if(!target.clip){frames.set(frame,null);continue;}
    const key=target.clip.id,group=groups.get(key)??[];group.push({frame,seconds:target.sourceMs!/1000});groups.set(key,group);
   }
   for(const [clipId,group] of groups){
    signal.throwIfAborted();const clip=timeline.spans.find(s=>s.clip?.id===clipId)!.clip!;
    const sink=await this.videoSink(clip.assetId);let i=0;
    for await(const sample of sink.canvasesAtTimestamps(group.map(g=>g.seconds))){
     signal.throwIfAborted();const target=group[i++];if(!target)break;
     if(!sample)throw Error("Requested video frame is unavailable.");
     frames.set(target.frame,sample);
    }
    if(i!==group.length)throw Error("Incomplete video frame window.");
   }
   const audio:Sound[]=[];
   for(const span of timeline.audio){signal.throwIfAborted();if(span.timelineStartMs<end&&span.timelineEndMs>start)audio.push(...await this.sound(span,start,end));}
   signal.throwIfAborted();const value={index,frames,audio,start,end};
   if(version!==this.version)throw new DOMException("Timeline changed","AbortError");
   this.windows.set(index,value);this.trimWindows();return value;
  })();
  this.loading.set(index,task);
  void task.finally(()=>{if(this.loading.get(index)===task)this.loading.delete(index);this.trimSources();}).catch(()=>{});
  return task;
 }
 private clearWarm(){if(this.idleWarm!==null){clearTimeout(this.idleWarm);this.idleWarm=null;}}
 private warmWhenIdle(){
  this.clearWarm();if(this.intent||this.dragging||!this.timeline||this.closed||this.position>=this.timeline.durationMs)return;
  const version=this.version,seek=this.seekVersion,index=Math.floor(this.position/WINDOW_MS);
  this.idleWarm=setTimeout(()=>{this.idleWarm=null;if(this.intent||this.dragging||this.loading.size||version!==this.version||seek!==this.seekVersion)return;
   void this.window(index).then(w=>{if(!this.intent&&!this.dragging&&version===this.version&&seek===this.seekVersion&&w.end<this.timeline!.durationMs)return this.window(index+1);}).catch(()=>{});
  },200);
 }
 private trimWindows(){
  const index=Math.floor(this.position/WINDOW_MS);
  for(const key of this.windows.keys())if(key<index-1||key>index+2)this.windows.delete(key);
  while(this.windows.size>FRAME_CACHE_LIMIT)this.windows.delete(this.windows.keys().next().value!);
 }
 private paint(frame:number,sample:WrappedCanvas|null){
  if(this.lastFrame===frame)return;this.lastFrame=frame;
  if(!sample)this.black();else this.context.drawImage(sample.canvas,0,0,this.canvas.width,this.canvas.height);
  this.canvas.dataset.frame=String(frame);this.canvas.dataset.sourceTime=sample?String(sample.timestamp):"";
 }
 private requestFrame(){
  this.frameWanted=true;if(this.pendingFrame||this.closed||!this.timeline)return;
  this.pendingFrame=true;
  void (async()=>{
   while(this.frameWanted&&!this.closed){
    this.frameWanted=false;
    const version=this.version,seek=this.seekVersion,target=frameTarget(this.timeline!,this.position);
    if(!target){this.black();continue;}
    try{
     const ready=this.windows.get(Math.floor(target.frame/WINDOW_FRAMES));
     const sample=ready?.frames.has(target.frame)?ready.frames.get(target.frame)!:target.clip?await (await this.videoSink(target.clip.assetId)).getCanvas(target.sourceMs!/1000):null;
     if(version!==this.version||seek!==this.seekVersion||this.closed||this.running)continue;
     if(target.clip&&!sample)throw Error("Requested video frame is unavailable.");
     this.paint(target.frame,sample);
    }catch(e){if(version===this.version&&seek===this.seekVersion&&!this.closed)this.fail(e);}
   }
  })().finally(()=>{this.pendingFrame=false;this.trimSources();if(this.frameWanted&&!this.closed)this.requestFrame();});
 }
 private outputTime(){
  const ctx=this.audio!;
  // The output timestamp refers to samples actually reaching the audio device,
  // not the ahead-of-output rendering clock.
  const ts=ctx.getOutputTimestamp?.();
  if(ts&&typeof ts.contextTime==="number"&&Number.isFinite(ts.contextTime)&&typeof ts.performanceTime==="number"&&ts.performanceTime>0){
   return Math.min(ctx.currentTime,ts.contextTime+Math.max(0,performance.now()-ts.performanceTime)/1000);
  }
  return Math.max(0,ctx.currentTime-(ctx.outputLatency||ctx.baseLatency||0));
 }
 private stopClock(){
  this.running=false;cancelAnimationFrame(this.raf);
  for(const n of this.scheduled){try{n.stop();}catch{}n.disconnect();}
  this.scheduled.clear();
 }
 private async openAudio(){
  if(!this.audio){this.audio=new AudioContext({latencyHint:"interactive"});this.gain=this.audio.createGain();this.gain.gain.value=this.volume;this.gain.connect(this.audio.destination);}
  if(this.audio.state!=="running")await this.audio.resume();
 }
 async play(){
  if(this.closed||!this.timeline||this.intent)return;this.clearWarm();
  if(this.position>=this.timeline.durationMs)this.seek(0);
  this.intent=true;this.cb.playing(true);
  try{await this.openAudio();if(this.intent&&!this.closed)this.ensureStart();}catch(e){this.fail(e);}
 }
 pause(){this.intent=false;this.seekVersion++;this.stopClock();this.cb.position(this.position);this.setBuffering(false);this.cb.playing(false);this.warmWhenIdle();}
 seek(ms:number){
  if(!this.timeline||!Number.isFinite(ms))return;
  this.clearWarm();this.seekVersion++;this.stopClock();this.position=Math.max(0,Math.min(this.timeline.durationMs,ms));this.lastFrame=-1;
  this.cb.position(this.position);this.trimWindows();this.requestFrame();
  if(this.intent&&!this.dragging)this.ensureStart();else this.warmWhenIdle();
 }
 scrub(value:boolean){if(this.dragging===value)return;this.dragging=value;if(value){this.clearWarm();this.seekVersion++;this.stopClock();}else if(this.intent)this.ensureStart();else this.warmWhenIdle();}
 private schedule(window:Window,from:number){
  const ctx=this.audio!;
  for(const sample of window.audio){
   const start=Math.max(from,sample.at),end=sample.at+sample.duration*1000;if(end<=start)continue;
   const when=this.anchorTime+(start-this.anchorPosition)/1000;
   if(when<ctx.currentTime-.003)throw Error("Audio preview missed its scheduling window.");
   const node=ctx.createBufferSource();node.buffer=sample.buffer;node.connect(this.gain!);
   node.onended=()=>{this.scheduled.delete(node);node.disconnect();};
   this.scheduled.add(node);
   node.start(Math.max(ctx.currentTime,when),sample.offset+(start-sample.at)/1000,(end-start)/1000);
  }
  this.scheduledThrough=window.end;
 }
 private ensureStart(){
  if(this.starting||this.running||!this.intent||this.dragging||!this.timeline||!this.audio||this.audio.state!=="running")return;
  const version=this.version,seek=this.seekVersion,index=Math.floor(this.position/WINDOW_MS);
  if(this.position>=this.timeline.durationMs){this.pause();return;}
  this.starting=true;this.setBuffering(true);
  void (async()=>{
   try{
    const current=await this.window(index);
    if(version!==this.version||seek!==this.seekVersion||!this.intent||this.dragging)return;
    const next=current.end<this.timeline!.durationMs?await this.window(index+1):null;
    if(version!==this.version||seek!==this.seekVersion||!this.intent||this.dragging)return;
    this.anchorTime=this.audio!.currentTime+.08;this.anchorPosition=this.position;
    this.scheduledThrough=this.position;this.schedule(current,this.position);if(next)this.schedule(next,next.start);
    const target=frameTarget(this.timeline!,this.position);if(target&&current.frames.has(target.frame))this.paint(target.frame,current.frames.get(target.frame)!);
    this.running=true;this.setBuffering(false);this.lastPublish=0;this.raf=requestAnimationFrame(this.tick);
   }catch(e){if(version===this.version&&seek===this.seekVersion&&this.intent)this.fail(e);}
   finally{this.starting=false;if(this.intent&&!this.running&&!this.dragging&&!this.closed)this.ensureStart();}
  })();
 }
 private tick=(now:number)=>{
  if(!this.running||!this.intent||!this.timeline||!this.audio||this.closed)return;
  const version=this.version,seek=this.seekVersion,timeline=this.timeline;
  const desired=this.anchorPosition+Math.max(0,this.outputTime()-this.anchorTime)*1000;
  this.position=Math.min(timeline.durationMs,this.scheduledThrough,Math.max(this.position,desired));
  const target=frameTarget(timeline,this.position);
  if(target){const window=this.windows.get(Math.floor(target.frame/WINDOW_FRAMES));if(window?.frames.has(target.frame))this.paint(target.frame,window.frames.get(target.frame)!);}
  if(now-this.lastPublish>=60){this.lastPublish=now;this.cb.position(this.position);}
  if(this.position>=timeline.durationMs){this.cb.position(timeline.durationMs);this.pause();return;}
  if(this.position>=this.scheduledThrough-.001){this.stopClock();this.cb.position(this.position);this.ensureStart();return;}
  if(this.scheduledThrough<timeline.durationMs&&this.scheduledThrough-this.position<1000){
   const index=Math.floor(this.scheduledThrough/WINDOW_MS),ready=this.windows.get(index);
   // Maintain a bounded lookahead; do not schedule late audio against an old anchor.
   if(ready&&this.anchorTime+(ready.start-this.anchorPosition)/1000>this.audio.currentTime+.035){try{this.schedule(ready,ready.start);}catch(e){this.fail(e);return;}}
   else if(!ready&&this.scheduledThrough-this.position<1000){
    void this.window(index).catch(e=>{if(version===this.version&&seek===this.seekVersion&&this.running)this.fail(e);});
   }
  }
  this.trimWindows();this.raf=requestAnimationFrame(this.tick);
 };
 close(){this.clearWarm();this.closed=true;this.intent=false;this.stopClock();this.controller.abort();this.version++;this.seekVersion++;for(const p of this.sources.values())void p.then(s=>s.input.dispose()).catch(()=>{});this.sources.clear();this.windows.clear();this.loading.clear();if(this.audio)void this.audio.close().catch(()=>{});}
}
