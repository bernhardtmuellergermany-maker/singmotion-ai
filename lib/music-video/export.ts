import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdtemp,rm,writeFile,stat} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import type {MusicClip,MusicProject} from "./core";
import {effectiveSongParts,songTimeToTimeline,songPartsEnd,type SongPlacement} from "./song-range.ts";

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
  const clip=clips.filter(c=>c.timelineStartMs<=at&&clipEnd(c)>at).sort((a,b)=>b.track-a.track)[0]??null;
  const prev=spans.at(-1);
  if(prev&&prev.clip?.id===clip?.id){prev.endFrame=endFrame;continue;}
  spans.push({startFrame,endFrame,clip,sourceMs:clip?clip.sourceInMs+at-clip.timelineStartMs:0});
 }
 return spans;
}
type Job={id:string;owner:string;projectId:string;name:string;state:"rendering"|"ready"|"failed";created:number;progress:number;folder?:string;error?:string};
const jobs=new Map<string,Job>();
const publicJob=(j:Job)=>({id:j.id,state:j.state,progress:j.progress,error:j.error});
function expire(job:Job){const timer=setTimeout(()=>{jobs.delete(job.id);if(job.folder)void rm(job.folder,{recursive:true,force:true}).catch(()=>{});},30*60*1000);timer.unref();}
async function cleanup(){
 for(const [id,j] of jobs)if(j.state!=="rendering"&&Date.now()-j.created>30*60*1000){jobs.delete(id);if(j.folder)await rm(j.folder,{recursive:true,force:true});}
}
async function ffmpeg(args:string[],timeout=180000){
 await exec("ffmpeg",["-nostdin","-hide_banner","-loglevel","error","-y",...args],{timeout,maxBuffer:1024*1024});
}
async function render(job:Job,project:MusicProject,clips:MusicClip[],files:Map<string,string>,songFile:string){
 const range:SongPlacement={startMs:project.songStartMs,endMs:project.songEndMs,positionMs:project.songPositionMs};
 const parts=effectiveSongParts(range,project.songParts);
 const duration=Math.max(songPartsEnd(range,project.songParts),...clips.map(clipEnd));
 const spans=videoRenderSpans(clips,duration);
 const folder=await mkdtemp(path.join(tmpdir(),"sm-music-export-"));job.folder=folder;
 const started=Date.now(),remaining=()=>Math.max(1,Math.min(180000,20*60*1000-(Date.now()-started)));
 const names:string[]=[];
 for(const [i,span] of spans.entries()){
  if(Date.now()-started>20*60*1000)throw new Error("render timeout");
  const frames=span.endFrame-span.startFrame,name="part-"+i+".mp4",out=path.join(folder,name);
  const input=span.clip?["-ss",seconds(span.sourceMs),"-i",files.get(span.clip.assetId)!]:["-f","lavfi","-i","color=c=black:s=1920x1080:r=30"];
  await ffmpeg([...input,"-map","0:v:0","-an","-sn","-dn","-filter_threads","1",
   "-vf","scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=1",
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
 graph.push(labels.join("")+"concat=n="+labels.length+":v=0:a=1[aout]");
 await ffmpeg(["-f","concat","-safe","1","-i",list,"-i",songFile,"-filter_complex_threads","1","-filter_complex",graph.join(";"),"-map","0:v:0","-map","[aout]","-c:v","copy","-c:a","aac","-b:a","320k","-t",frameSeconds(totalFrames),"-movflags","+faststart",path.join(folder,"result.mp4")],remaining());
 if((await stat(path.join(folder,"result.mp4"))).size<1000)throw new Error("empty export");
 for(const n of [...names,"concat.txt"])await rm(path.join(folder,n),{force:true});
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
