import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdtemp,rm,writeFile,stat} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import type {MusicClip,MusicProject,ProjectAspectRatio} from "./core";
import {effectiveSongParts,songTimeToTimeline,songPartsEnd,clipSourceTimeMs,type SongPlacement} from "./song-range.ts";

const exec=promisify(execFile);
const fps=30, limitMs=600000;
const seconds=(ms:number)=>(ms/1000).toFixed(6);
const frameSeconds=(frames:number)=>(frames/fps).toFixed(9);
const clipEnd=(c:MusicClip)=>c.timelineStartMs+c.sourceOutMs-c.sourceInMs;
export type RenderSpan={startFrame:number;endFrame:number;clip:MusicClip|null;sourceMs:number};
export function videoRenderSpans(clips:MusicClip[],durationMs:number):RenderSpan[]{
 const frames=Math.ceil(durationMs*fps/1000);
 const bounds=[...new Set([0,frames,...clips.flatMap(c=>[c.timelineStartMs,clipEnd(c)].map(ms=>Math.min(frames,Math.ceil(ms*fps/1000))))])].sort((a,b)=>a-b);
 const spans:RenderSpan[]=[];
 for(let i=0;i<bounds.length-1;i++){
  const startFrame=bounds[i],endFrame=bounds[i+1],at=startFrame*1000/fps;
  const clip=clips.filter(c=>Math.ceil(c.timelineStartMs*fps/1000)<=startFrame&&Math.ceil(clipEnd(c)*fps/1000)>startFrame).sort((a,b)=>b.track-a.track)[0]??null;
  const prev=spans.at(-1);
  if(prev&&prev.clip?.id===clip?.id){prev.endFrame=endFrame;continue;}
  spans.push({startFrame,endFrame,clip,sourceMs:clip?clipSourceTimeMs(clip,at):0});
 }
 return spans;
}
/** Select HD or Full HD from visible sources, then orient the project canvas. */
export type ExportResolution={width:1280;height:720}|{width:1920;height:1080}|{width:720;height:1280}|{width:1080;height:1920};
export function chooseExportResolution(sources:readonly {width:number;height:number}[],aspectRatio:ProjectAspectRatio="16:9"):ExportResolution{
 if(!sources.length||sources.some(s=>!Number.isSafeInteger(s.width)||!Number.isSafeInteger(s.height)||s.width<=0||s.height<=0))
  throw new Error("Could not determine source video resolution.");
 const full=sources.some(s=>Math.min(s.width,s.height)>720);
 if(aspectRatio==="9:16")return full?{width:1080,height:1920}:{width:720,height:1280};
 return full?{width:1920,height:1080}:{width:1280,height:720};
}
async function inspectExportResolution(spans:RenderSpan[],files:Map<string,string>,aspectRatio:ProjectAspectRatio):Promise<ExportResolution>{
 const dimensions:{width:number;height:number}[]=[];
 const ids=new Set(spans.flatMap(s=>s.clip?[s.clip.assetId]:[]));
 for(const id of ids){
  const file=files.get(id);if(!file)throw new Error("Source video missing.");
  const {stdout}=await exec("ffprobe",["-v","error","-select_streams","v:0","-show_entries","stream=width,height","-of","json",file],{timeout:15000,maxBuffer:16384});
  const stream=JSON.parse(stdout).streams?.[0];
  dimensions.push({width:Number(stream?.width),height:Number(stream?.height)});
 }
 return chooseExportResolution(dimensions,aspectRatio);
}
type Job={id:string;owner:string;projectId:string;name:string;state:"rendering"|"ready"|"failed";created:number;progress:number;resolution?:ExportResolution;folder?:string;error?:string};
const jobs=new Map<string,Job>();
const publicJob=(j:Job)=>({id:j.id,state:j.state,progress:j.progress,resolution:j.resolution,error:j.error});
function expire(job:Job){const timer=setTimeout(()=>{jobs.delete(job.id);if(job.folder)void rm(job.folder,{recursive:true,force:true}).catch(()=>{});},30*60*1000);timer.unref();}
async function cleanup(){
 for(const [id,j] of jobs)if(j.state!=="rendering"&&Date.now()-j.created>30*60*1000){jobs.delete(id);if(j.folder)await rm(j.folder,{recursive:true,force:true});}
}
async function ffmpeg(args:string[],timeout=180000){
 await exec("ffmpeg",["-nostdin","-hide_banner","-loglevel","error","-y",...args],{timeout,maxBuffer:1024*1024});
}
/** Render original audio from an enabled video lane, including intervals hidden by overlays. */
export function trackAudioSpans(clips:MusicClip[],track:1|2,durationMs:number){
 const ordered=clips.filter(c=>c.track===track).sort((a,b)=>a.timelineStartMs-b.timelineStartMs);
 const spans:{clip:MusicClip|null;startMs:number;durationMs:number}[]=[];
 let cursor=0;
 for(const clip of ordered){
  if(clip.timelineStartMs>=durationMs)break;
  if(clip.timelineStartMs>cursor)spans.push({clip:null,startMs:cursor,durationMs:clip.timelineStartMs-cursor});
  const end=Math.min(durationMs,clipEnd(clip));
  if(end>clip.timelineStartMs)spans.push({clip,startMs:clip.timelineStartMs,durationMs:end-clip.timelineStartMs});
  cursor=end;
 }
 if(cursor<durationMs)spans.push({clip:null,startMs:cursor,durationMs:durationMs-cursor});
 return spans;
}
async function renderTrackAudio(track:1|2,clips:MusicClip[],files:Map<string,string>,durationMs:number,folder:string,remaining:()=>number,started:number){
 const names:string[]=[],hasAudio=new Map<string,boolean>();
 const spans=trackAudioSpans(clips,track,durationMs);
 for(const [i,span] of spans.entries()){
  if(Date.now()-started>20*60*1000)throw new Error("render timeout");
  const file=span.clip?files.get(span.clip.assetId):undefined;
  if(span.clip&&!file)throw new Error("Source video missing.");
  if(file&&!hasAudio.has(file)){
   const {stdout}=await exec("ffprobe",["-v","error","-select_streams","a:0","-show_entries","stream=index","-of","csv=p=0",file],{timeout:15000,maxBuffer:16384});
   hasAudio.set(file,stdout.trim().length>0);
  }
  const input=file&&hasAudio.get(file)?["-ss",seconds(span.clip!.sourceInMs),"-i",file]:["-f","lavfi","-i","anullsrc=r=48000:cl=stereo"];
  const name="audio-"+track+"-"+i+".wav";
  await ffmpeg([...input,"-map","0:a:0","-vn","-sn","-dn","-af","aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo,apad","-t",seconds(span.durationMs),"-c:a","pcm_s16le",path.join(folder,name)],remaining());
  names.push(name);
 }
 const list=path.join(folder,"audio-"+track+".txt");
 await writeFile(list,names.map(n=>"file '"+n+"'").join("\n")+"\n");
 return {list,names:[...names,"audio-"+track+".txt"]};
}
async function render(job:Job,project:MusicProject,clips:MusicClip[],files:Map<string,string>,songFile:string){
 const range:SongPlacement={startMs:project.songStartMs,endMs:project.songEndMs,positionMs:project.songPositionMs};
 const parts=effectiveSongParts(range,project.songParts);
 const duration=Math.max(songPartsEnd(range,project.songParts),...clips.map(clipEnd));
 const spans=videoRenderSpans(clips,duration);
 const resolution=await inspectExportResolution(spans,files,project.aspectRatio);job.resolution=resolution;
 const {width,height}=resolution;
 const folder=await mkdtemp(path.join(tmpdir(),"sm-music-export-"));job.folder=folder;
 const started=Date.now(),remaining=()=>Math.max(1,Math.min(180000,20*60*1000-(Date.now()-started)));
 const names:string[]=[];
 for(const [i,span] of spans.entries()){
  if(Date.now()-started>20*60*1000)throw new Error("render timeout");
  const frames=span.endFrame-span.startFrame,name="part-"+i+".mp4",out=path.join(folder,name);
  const input=span.clip?["-ss",seconds(span.sourceMs),"-i",files.get(span.clip.assetId)!]:["-f","lavfi","-i","color=c=black:s="+width+"x"+height+":r=30"];
  await ffmpeg([...input,"-map","0:v:0","-an","-sn","-dn","-filter_threads","1",
   "-vf","scale="+width+":"+height+":force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,pad="+width+":"+height+":(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=1",
   "-frames:v",String(frames),"-c:v","libx264","-threads","2","-preset","veryfast","-crf","20","-pix_fmt","yuv420p","-video_track_timescale","30000",out],remaining());
  const {stdout}=await exec("ffprobe",["-v","error","-select_streams","v:0","-show_entries","stream=nb_frames","-of","default=nw=1:nk=1",out],{timeout:15000,maxBuffer:1024});
  if(Number(stdout.trim())!==frames)throw new Error("incomplete video span");
  names.push(name);job.progress=Math.floor(span.endFrame/spans.at(-1)!.endFrame*90);
 }
 const list=path.join(folder,"concat.txt");
 await writeFile(list,names.map((n,i)=>"file '"+n+"'\nduration "+frameSeconds(spans[i].endFrame-spans[i].startFrame)).join("\n")+"\n");
 // Audio uses the original song clock. Removed parts and spaces are silence, never ripple edits.
 const graph:string[]=[],labels:string[]=[];
 if(parts.length>1)graph.push("[1:a:0]asplit="+parts.length+parts.map((_,i)=>"[src"+i+"]").join(""));
 let cursor=0;
 function silence(ms:number){
  if(ms<=0)return;
  const label="a"+labels.length;graph.push("anullsrc=r=48000:cl=stereo,atrim=duration="+seconds(ms)+"["+label+"]");labels.push("["+label+"]");
 }
 for(const [i,p] of parts.entries()){
  const position=songTimeToTimeline(p.startMs,range),length=p.endMs-p.startMs;
  silence(position-cursor);
  const label="a"+labels.length;
  graph.push((parts.length>1?"[src"+i+"]":"[1:a:0]")+"atrim=start="+seconds(p.startMs)+":end="+seconds(p.endMs)+",asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=duration="+seconds(length)+"["+label+"]");
  labels.push("["+label+"]");cursor=position+length;
 }
 const totalFrames=spans.at(-1)!.endFrame;
 silence(totalFrames*1000/fps-cursor);
 const mutes=project.trackMutes??{1:true,2:true,song:false};
 graph.push(labels.join("")+"concat=n="+labels.length+":v=0:a=1[song]");
 const audioInputs:string[]=[],audioTemp:string[]=[],mixLabels:string[]=[];
 if(!mutes.song)mixLabels.push("[song]");
 else graph.push("[song]anullsink");
 for(const track of [1,2] as const){
  if(mutes[track]||!clips.some(c=>c.track===track))continue;
  const rendered=await renderTrackAudio(track,clips,files,totalFrames*1000/fps,folder,remaining,started);
  const index=2+audioInputs.length/6;
  audioInputs.push("-f","concat","-safe","1","-i",rendered.list);
  audioTemp.push(...rendered.names);
  graph.push("["+index+":a:0]asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo[t"+track+"]");
  mixLabels.push("[t"+track+"]");
 }
 if(mixLabels.length===0)graph.push("anullsrc=r=48000:cl=stereo,atrim=duration="+frameSeconds(totalFrames)+"[aout]");
 else if(mixLabels.length===1)graph.push(mixLabels[0]+"anull[aout]");
 else graph.push(mixLabels.join("")+"amix=inputs="+mixLabels.length+":duration=longest:normalize=0,alimiter=limit=0.95:level=0:latency=1[aout]");
 await ffmpeg(["-f","concat","-safe","1","-i",list,"-i",songFile,...audioInputs,"-filter_complex_threads","1","-filter_complex",graph.join(";"),"-map","0:v:0","-map","[aout]","-c:v","copy","-c:a","aac","-b:a","320k","-t",frameSeconds(totalFrames),"-movflags","+faststart",path.join(folder,"result.mp4")],remaining());
 if((await stat(path.join(folder,"result.mp4"))).size<1000)throw new Error("empty export");
 for(const n of [...names,"concat.txt",...audioTemp])await rm(path.join(folder,n),{force:true});
}
export async function startMusicExport(owner:string,project:MusicProject,clips:MusicClip[],files:Map<string,string>,songFile:string){
 await cleanup();
 const range={startMs:project.songStartMs,endMs:project.songEndMs,positionMs:project.songPositionMs};
 const duration=Math.max(songPartsEnd(range,project.songParts),...clips.map(clipEnd));
 if(!clips.length)throw new Error("Add at least one video before exporting.");
 if(duration>limitMs||videoRenderSpans(clips,duration).length>120)throw new Error("MP4 export currently supports up to 10 minutes and 120 video sections.");
 if([...jobs.values()].some(j=>j.state==="rendering"))throw new Error("An export is already rendering. Try again after it finishes.");
 if(jobs.size>=4)throw new Error("Export capacity is temporarily full. Try again later.");
 const job:Job={id:randomUUID(),owner,projectId:project.id,name:project.name,state:"rendering",created:Date.now(),progress:0};
 jobs.set(job.id,job);
 void render(job,project,clips,files,songFile).then(()=>{job.state="ready";job.progress=100;job.created=Date.now();expire(job);}).catch(async()=>{
  job.state="failed";job.error="MP4 rendering failed. Check that all source videos are available and try again.";job.created=Date.now();expire(job);
  if(job.folder)await rm(job.folder,{recursive:true,force:true}).catch(()=>{});
 });
 return publicJob(job);
}
export async function musicExportStatus(owner:string,projectId:string,id:string){
 await cleanup();const job=jobs.get(id);
 return job?.owner===owner&&job.projectId===projectId?publicJob(job):null;
}
export async function musicExportFile(owner:string,projectId:string,id:string){
 await cleanup();const job=jobs.get(id);
 if(!job||job.owner!==owner||job.projectId!==projectId||job.state!=="ready"||!job.folder)return null;
 return {file:path.join(job.folder,"result.mp4"),name:job.name};
}
