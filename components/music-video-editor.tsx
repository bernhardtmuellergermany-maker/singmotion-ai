"use client";
import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import Link from "next/link";
import {ChevronDown,ChevronRight,Check,Clock3,Film,FolderOpen,Lock,Unlock,
  Maximize,Minus,MoreHorizontal,Music2,Pause,Pencil,Play,Plus,Redo2,Scissors,
  Search,Trash2,Undo2,Upload,Volume2,VolumeX,ZoomIn} from "lucide-react";
import {ensureSession} from "@/lib/client";
import type {MusicAsset,MusicClip,MusicProject,Track} from "@/lib/music-video/core";
import {parseSongTime,validSongRange,moveSongEdge,validSongPlacement,trimSongPlacement,shiftLockedClips,songOffset,songTimelineEnd,MAX_TIMELINE_MS,songTimeToTimeline,timelineToSongTime,parseRelativeSongTime,positionVideoClip,type SongRange,type SongPlacement} from "@/lib/music-video/song-range";
import "./music-video.css";

type LipSyncSource={id:string;name:string;durationMs:number;sourceStartMs:number;sourceEndMs:number};
type EditSnapshot={clips:MusicClip[];range:SongPlacement};
type Detail={project:MusicProject;assets:MusicAsset[];clips:MusicClip[]};
const endpoint="/api/music-video/";
const uuid=()=>crypto.randomUUID();
const time=(ms:number,precise=false)=>{
  const n=Math.max(0,Math.round(ms));
  return String(Math.floor(n/60000)).padStart(2,"0")+":"+String(Math.floor(n%60000/1000)).padStart(2,"0")+
    (precise?"."+String(n%1000).padStart(3,"0"):"");
};
const signedTime=(ms:number)=>(ms<0?"-":"")+time(Math.abs(ms),true);
async function request<T>(url:string,init?:RequestInit):Promise<T>{
  const response=await fetch(url,{cache:"no-store",credentials:"same-origin",...init});
  const data=await response.json() as T&{error?:string};
  if(!response.ok)throw new Error(data.error||"Request failed.");
  return data;
}
const clipEnd=(c:MusicClip)=>c.timelineStartMs+c.sourceOutMs-c.sourceInMs;
const overlaps=(clips:MusicClip[],target:MusicClip)=>clips.filter(c=>c.id!==target.id&&c.track===target.track&&
  target.timelineStartMs<clipEnd(c)&&clipEnd(target)>c.timelineStartMs);
export function MusicVideoEditor({id}:{id:string}){
  const [detail,setDetail]=useState<Detail|null>(null),[clips,setClips]=useState<MusicClip[]>([]);
  const [songRange,setSongRange]=useState<SongPlacement>({startMs:0,endMs:0,positionMs:0});
  const [startText,setStartText]=useState("00:00.000"),[endText,setEndText]=useState("00:00.000");
  const [positionText,setPositionText]=useState("00:00.000");
  const playheadRef=useRef(0),playingRef=useRef(false);
  const rangeRef=useRef<SongPlacement>({startMs:0,endMs:0,positionMs:0});
  const [selected,setSelected]=useState<string|null>(null),[playhead,setPlayhead]=useState(0);
  const [clipSongText,setClipSongText]=useState("00:00.000"),[clipTimelineText,setClipTimelineText]=useState("00:00.000");
  const clipTimeMode=useRef<"song"|"timeline">("song");
  const [playing,setPlaying]=useState(false),[zoom,setZoom]=useState(44),[snap,setSnap]=useState(true);
  const [libraryOpen,setLibraryOpen]=useState(false),[filter,setFilter]=useState<"All"|"Lip Sync"|"AI Video"|"Uploads">("All");
  const [search,setSearch]=useState(""),[addMenu,setAddMenu]=useState<Track|null>(null);
  const [uploadTrack,setUploadTrack]=useState<Track|null>(null),[error,setError]=useState(""),[status,setStatus]=useState("Saved");
  const [lipTrack,setLipTrack]=useState<Track|null>(null),[lipSources,setLipSources]=useState<LipSyncSource[]>([]);
  const [lipLoading,setLipLoading]=useState(false),[lipSearch,setLipSearch]=useState(""),[lipError,setLipError]=useState("");
  const [importing,setImporting]=useState(false);
  const importBusy=useRef(false);
  const [wave,setWave]=useState<number[]>([]),[editingName,setEditingName]=useState(false),[newName,setNewName]=useState("");
  const audio=useRef<HTMLAudioElement>(null),video=useRef<HTMLVideoElement>(null),scroll=useRef<HTMLDivElement>(null),fileInput=useRef<HTMLInputElement>(null);
  const revision=useRef(0),latest=useRef<MusicClip[]>([]),dirty=useRef(false),inFlight=useRef<Promise<void>|null>(null);
  const saveTimer=useRef<ReturnType<typeof setTimeout>|null>(null),past=useRef<EditSnapshot[]>([]),future=useRef<EditSnapshot[]>([]);
  const detailRef=useRef<Detail|null>(null);
  const load=useCallback(async()=>{
    const data=await request<Detail>(endpoint+id);
    detailRef.current=data;revision.current=data.project.revision;latest.current=data.clips;dirty.current=false;
    const range={startMs:data.project.songStartMs,endMs:data.project.songEndMs,positionMs:data.project.songPositionMs};
    rangeRef.current=range;setSongRange(range);setStartText(time(range.startMs,true));setEndText(time(range.endMs,true));setPositionText(time(range.positionMs,true));
    playingRef.current=false;setPlaying(false);audio.current?.pause();video.current?.pause();
    const at=Math.min(playheadRef.current,Math.max(songTimelineEnd(range),...data.clips.map(clipEnd)));
    playheadRef.current=at;setPlayhead(at);
    if(audio.current&&audio.current.readyState>=1)audio.current.currentTime=Math.max(range.startMs,Math.min(range.endMs,at-songOffset(range)))/1000;
    setDetail(data);setClips(data.clips);setNewName(data.project.name);setError("");
  },[id]);
  useEffect(()=>{void load().catch(e=>setError(e instanceof Error?e.message:"Project unavailable."));},[load]);
  // Generate downsampled waveform from the actual project audio. No beat detection.
  useEffect(()=>{
    if(!detail)return;
    let alive=true;let ctx:AudioContext|null=null;
    void(async()=>{
      try{
        const buffer=await fetch(endpoint+id+"/song",{credentials:"same-origin"}).then(r=>r.arrayBuffer());
        ctx=new AudioContext();
        const decoded=await ctx.decodeAudioData(buffer),channel=decoded.getChannelData(0),bins=240;
        const peaks=Array.from({length:bins},(_,i)=>{
          const from=Math.floor(i*channel.length/bins),to=Math.min(channel.length,Math.floor((i+1)*channel.length/bins));
          let peak=0;for(let j=from;j<to;j+=Math.max(1,Math.floor((to-from)/120)))peak=Math.max(peak,Math.abs(channel[j]));
          return Math.max(0.07,peak);
        });
        if(alive)setWave(peaks);
      }catch{if(alive)setWave([]);}
      finally{if(ctx)await ctx.close().catch(()=>{});}
    })();
    return()=>{alive=false;};
  },[id,detail?.project.id]);
  async function saveNow():Promise<void>{
    if(inFlight.current){await inFlight.current;if(dirty.current)await saveNow();return;}
    if(!dirty.current)return;
    dirty.current=false;
    const snapshot=latest.current,range=rangeRef.current;
    setStatus("Saving…");
    const task=(async()=>{
      const result=await request<Detail>(endpoint+id+"/clips",{method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({revision:revision.current,clips:snapshot,songStartMs:range.startMs,songEndMs:range.endMs,songPositionMs:range.positionMs})});
      revision.current=result.project.revision;detailRef.current={...result,clips:latest.current};
      setDetail(previous=>previous?{...previous,project:result.project}:result);
    })();
    inFlight.current=task;
    try{await task;setStatus(dirty.current?"Saving…":"Saved");}
    catch(e){dirty.current=true;setStatus("Not saved");setError(e instanceof Error?e.message:"Save failed.");throw e;}
    finally{inFlight.current=null;}
    if(dirty.current)await saveNow();
  }
  const queue=()=>{
    dirty.current=true;setStatus("Unsaved");
    if(saveTimer.current)clearTimeout(saveTimer.current);
    saveTimer.current=setTimeout(()=>{void saveNow().catch(()=>{});},600);
  };
  useEffect(()=>()=>{if(saveTimer.current)clearTimeout(saveTimer.current);},[]);
  function apply(next:MusicClip[],record=true,range=rangeRef.current){
    if(record){past.current.push({clips:latest.current,range:rangeRef.current});if(past.current.length>40)past.current.shift();future.current=[];}
    const changed=range.startMs!==rangeRef.current.startMs||range.endMs!==rangeRef.current.endMs||range.positionMs!==rangeRef.current.positionMs;
    rangeRef.current=range;
    if(changed){
      displaySong(range);
      stopPlayback();
      const at=Math.min(playheadRef.current,Math.max(songTimelineEnd(range),...next.map(clipEnd)));
      setAt(at,range);
    }
    latest.current=next;setClips(next);setError("");queue();
  }
  function undo(){
    const previous=past.current.pop();if(!previous)return;
    future.current.push({clips:latest.current,range:rangeRef.current});apply(previous.clips,false,previous.range);
  }
  function redo(){
    const next=future.current.pop();if(!next)return;
    past.current.push({clips:latest.current,range:rangeRef.current});apply(next.clips,false,next.range);
  }
  function displaySong(range:SongPlacement){
    setSongRange(range);setStartText(time(range.startMs,true));setEndText(time(range.endMs,true));setPositionText(time(range.positionMs,true));
  }
  function commitSongRange(range:SongRange,position?:number){
    if(!project||!validSongRange(range.startMs,range.endMs,project.songDurationMs)){displaySong(rangeRef.current);setError("Choose a valid song range of at least 100 ms.");return;}
    const original=rangeRef.current;
    const next=position===undefined?trimSongPlacement(original,range):{...range,positionMs:position};
    if(!validSongPlacement(next,project.songDurationMs)){displaySong(original);setClips(latest.current);setError("Song position is outside the timeline.");return;}
    const moved=shiftLockedClips(latest.current,songOffset(next)-songOffset(original));
    if(!moved){displaySong(original);setClips(latest.current);setError("Cannot move the song: a sync-locked video would overlap another clip or leave the timeline. Unlock or move the conflicting video first.");return;}
    displaySong(next);setClips(moved);
    if(next.startMs!==original.startMs||next.endMs!==original.endMs||next.positionMs!==original.positionMs)
      apply(moved,true,next);
  }
  function submitSongRange(){
    const start=parseSongTime(startText),end=parseSongTime(endText),position=parseSongTime(positionText);
    if(start===null||end===null||position===null){setError("Enter seconds or MM:SS.mmm, for example 00:08.918.");return;}
    commitSongRange({startMs:start,endMs:end},position===rangeRef.current.positionMs?undefined:position);
  }
  function dragSong(e:React.PointerEvent<HTMLDivElement>){
    if(!project||importBusy.current||e.button!==0)return;
    e.preventDefault();e.stopPropagation();stopPlayback();
    const original=rangeRef.current,origin=e.clientX,pointer=e.pointerId,initial=latest.current;
    let position=original.positionMs;
    const update=(event:PointerEvent)=>{
      if(event.pointerId!==pointer)return;
      let next=Math.round(original.positionMs+(event.clientX-origin)/zoom*1000);
      if(snap){
        const markers=[0,playheadRef.current,...initial.filter(c=>!c.syncLocked).flatMap(c=>[c.timelineStartMs,clipEnd(c)])];
        const length=original.endMs-original.startMs;
        const targets=[...markers,...markers.map(m=>m-length)].filter(m=>m>=0);
        const closest=targets.reduce((a,b)=>Math.abs(b-next)<Math.abs(a-next)?b:a,0);
        if(Math.abs(closest-next)<150)next=closest;
      }
      position=Math.max(0,Math.min(MAX_TIMELINE_MS-original.endMs+original.startMs,next));
      const moved=shiftLockedClips(initial,position-original.positionMs);
      if(moved){displaySong({...original,positionMs:position});setClips(moved);}
    };
    const cleanup=()=>{document.removeEventListener("pointermove",update);document.removeEventListener("pointerup",finish);document.removeEventListener("pointercancel",cancel);};
    const finish=(event:PointerEvent)=>{if(event.pointerId!==pointer)return;update(event);cleanup();commitSongRange(original,position);};
    const cancel=(event:PointerEvent)=>{if(event.pointerId!==pointer)return;cleanup();displaySong(original);setClips(initial);};
    document.addEventListener("pointermove",update);document.addEventListener("pointerup",finish);document.addEventListener("pointercancel",cancel);
  }
  function dragSongEdge(e:React.PointerEvent<HTMLButtonElement>,edge:"start"|"end"){
    if(!project||importBusy.current||e.button!==0)return;
    e.preventDefault();e.stopPropagation();stopPlayback();
    const original=rangeRef.current,origin=e.clientX,pointer=e.pointerId;
    const duration=project.songDurationMs;
    let range:SongRange=original;
    const update=(event:PointerEvent)=>{
      if(event.pointerId!==pointer)return;
      const delta=(event.clientX-origin)/zoom*1000;
      range=moveSongEdge(original,edge,(edge==="start"?original.startMs:original.endMs)+delta,duration);
      displaySong(trimSongPlacement(original,range));
    };
    const cleanup=()=>{
      document.removeEventListener("pointermove",update);
      document.removeEventListener("pointerup",finish);
      document.removeEventListener("pointercancel",cancel);
    };
    const finish=(event:PointerEvent)=>{if(event.pointerId!==pointer)return;update(event);cleanup();commitSongRange(range);};
    const cancel=(event:PointerEvent)=>{if(event.pointerId!==pointer)return;cleanup();displaySong(original);};
    document.addEventListener("pointermove",update);
    document.addEventListener("pointerup",finish);
    document.addEventListener("pointercancel",cancel);
  }
  const project=detail?.project,assets=detail?.assets||[];
  const byId=useMemo(()=>new Map(assets.map(a=>[a.id,a])),[assets]);
  const selectedClip=clips.find(c=>c.id===selected);
  const selectedAsset=selectedClip?byId.get(selectedClip.assetId):null;
  const selectedStart=selectedClip?.timelineStartMs;
  const selectedId=selectedClip?.id;
  const offset=songOffset(songRange);
  useEffect(()=>{
    if(selectedStart===undefined)return;
    setClipSongText(signedTime(selectedStart-offset));setClipTimelineText(time(selectedStart,true));clipTimeMode.current="song";
  },[selectedId,selectedStart,offset]);
  function updateClipTime(text:string,mode:"song"|"timeline"){
    clipTimeMode.current=mode;
    if(mode==="song"){
      setClipSongText(text);
      const ms=parseRelativeSongTime(text);
      if(ms!==null)setClipTimelineText(signedTime(songTimeToTimeline(ms,rangeRef.current)));
    }else{
      setClipTimelineText(text);
      const ms=parseSongTime(text);
      if(ms!==null)setClipSongText(signedTime(timelineToSongTime(ms,rangeRef.current)));
    }
  }
  function moveSelectedClip(position:number,restore=false){
    if(importBusy.current||!selectedClip||!selectedAsset)return;
    const current=latest.current.find(c=>c.id===selectedClip.id);
    if(!current)return;
    const result=positionVideoClip(latest.current,current,position);
    if(result.status!=="ok"){
      setError(result.status==="collision"?"That position is occupied on Video "+current.track+". The clip was not moved.":result.status==="locked"?"Sync Lock is enabled. Unlock this clip before moving it away from its original song position.":"The complete clip must fit within the timeline.");
      return;
    }
    const candidate={...result.clip,syncLocked:restore||current.syncLocked};
    if(candidate.timelineStartMs!==current.timelineStartMs||candidate.syncLocked!==current.syncLocked)
      apply(latest.current.map(c=>c.id===current.id?candidate:c));
    setClipSongText(signedTime(timelineToSongTime(position,rangeRef.current)));setClipTimelineText(time(position,true));
    setError("");stopPlayback();setAt(position);
    requestAnimationFrame(()=>{
      const el=scroll.current;if(!el)return;
      const x=position/1000*zoom;
      if(x<el.scrollLeft||x>el.scrollLeft+el.clientWidth-30)el.scrollLeft=Math.max(0,x-30);
    });
  }
  function submitClipTime(){
    const mode=clipTimeMode.current;
    const ms=mode==="song"?parseRelativeSongTime(clipSongText):parseSongTime(clipTimelineText);
    if(ms===null){setError("Enter seconds or MM:SS.mmm, for example 00:08.918.");return;}
    moveSelectedClip(mode==="song"?songTimeToTimeline(ms,rangeRef.current):ms);
  }
  const originalClipSongTime=selectedClip&&selectedAsset?.kind==="lip-sync"&&selectedAsset.sourceStartMs!==null&&selectedAsset.sourceEndMs!==null&&selectedAsset.sourceStartMs+selectedClip.sourceOutMs<=selectedAsset.sourceEndMs
    ?selectedAsset.sourceStartMs+selectedClip.sourceInMs:null;

  const activeClip=clips.filter(c=>playhead>=c.timelineStartMs&&playhead<clipEnd(c)).sort((a,b)=>b.track-a.track)[0];
  const activeAsset=activeClip?byId.get(activeClip.assetId):null;
  const source=(a:MusicAsset)=>endpoint+id+"/assets/"+a.id;
  const timelineEnd=project?Math.max(songTimelineEnd(songRange),...clips.map(clipEnd)):0;
  const pixels=project?Math.max(640,Math.min(MAX_TIMELINE_MS,Math.max(project.songDurationMs,timelineEnd)+10000)/1000*zoom):640;
  const timelineLimit=project?Math.min(MAX_TIMELINE_MS,Math.max(project.songDurationMs,timelineEnd)+10000):0;
  const msFromX=(x:number)=>Math.max(0,Math.round(x/zoom*1000));
  function getDropTime(e:React.DragEvent){
    const rect=e.currentTarget.getBoundingClientRect();
    return msFromX(e.clientX-rect.left);
  }
  function snapped(value:number,c:MusicClip):number{
    if(!snap)return value;
    const markers=[0,playhead,...latest.current.filter(a=>a.id!==c.id).flatMap(a=>[a.timelineStartMs,clipEnd(a)])];
    const closest=markers.reduce((best,n)=>Math.abs(n-value)<Math.abs(best-value)?n:best,markers[0]);
    return Math.abs(closest-value)<250?closest:value;
  }
  function addClip(asset:MusicAsset,track:Track,atMs:number){
    const locked=asset.kind==="lip-sync"&&asset.sourceStartMs!==null&&asset.sourceEndMs!==null;
    const length=locked?Math.min(asset.durationMs,asset.sourceEndMs!-asset.sourceStartMs!):asset.durationMs;
    if(!project||length<=0)return;
    const candidate:MusicClip={id:uuid(),assetId:asset.id,track,
      timelineStartMs:locked?asset.sourceStartMs!+songOffset(rangeRef.current):Math.max(0,Math.round(atMs/100)*100),
      sourceInMs:0,sourceOutMs:length,syncLocked:locked};
    if(candidate.timelineStartMs<0){setError("This Lip Sync clip starts before the timeline. Move the song right first.");return;}
    if(clipEnd(candidate)>timelineLimit){
      if(locked){setError("Lip-sync source cut extends beyond the song.");return;}
      candidate.sourceOutMs=Math.max(0,timelineLimit-candidate.timelineStartMs);
    }
    if(candidate.sourceOutMs<=candidate.sourceInMs){setError("No space before the song ends.");return;}
    let conflicts=overlaps(latest.current,candidate);
    if(conflicts.length){
      const action=window.prompt("Track occupied. Type 'free' to find another space, 'fit' to trim into the available gap, 'replace' to remove conflicting clips, or Cancel.","free");
      if(action===null)return;
      if(action==="replace"){
        if(!window.confirm("Replace "+conflicts.length+" existing timeline clip(s)? Media will remain in the Library."))return;
        apply([...latest.current.filter(c=>!conflicts.some(o=>o.id===c.id)),candidate]);
        setSelected(candidate.id);return;
      }
      if(locked){setError("Sync-locked lip-sync must remain at the original song position. Choose another track or trim another clip.");return;}
      if(action!=="free"&&action!=="fit")return;
      if(action==="free"){
        const sorted=latest.current.filter(c=>c.track===track).sort((a,b)=>a.timelineStartMs-b.timelineStartMs);
        let position=0;
        for(const old of sorted){
          if(position+length<=old.timelineStartMs)break;
          position=Math.max(position,clipEnd(old));
        }
        if(position+length>timelineLimit){setError("No free position for this video.");return;}
        candidate.timelineStartMs=position;
      }else{
        const nextEdge=Math.min(...conflicts.map(c=>c.timelineStartMs).filter(n=>n>candidate.timelineStartMs),timelineLimit);
        candidate.sourceOutMs=Math.min(candidate.sourceOutMs,nextEdge-candidate.timelineStartMs);
        if(candidate.sourceOutMs<=0){setError("No room for trimming here.");return;}
      }
      conflicts=overlaps(latest.current,candidate);
      if(conflicts.length){setError("No collision-free position found.");return;}
    }
    apply([...latest.current,candidate]);setSelected(candidate.id);
  }
  function onDrop(e:React.DragEvent,track:Track){
    e.preventDefault();
    const clipId=e.dataTransfer.getData("application/x-mvclip");
    const assetId=e.dataTransfer.getData("application/x-mvasset");
    const position=getDropTime(e);
    if(clipId){
      const c=latest.current.find(a=>a.id===clipId);if(!c)return;
      if(c.syncLocked&&position!==c.timelineStartMs){setError("Unlock this lip-sync clip before moving it.");return;}
      const next={...c,track,timelineStartMs:c.syncLocked?c.timelineStartMs:Math.max(0,Math.round(position))};
      if(project&&clipEnd(next)>timelineLimit){setError("Clip reaches beyond the song.");return;}
      if(overlaps(latest.current,next).length){setError("Track occupied. Try another position.");return;}
      apply(latest.current.map(a=>a.id===c.id?next:a));setSelected(c.id);
    }else if(assetId){
      const a=byId.get(assetId);if(a)addClip(a,track,position);
    }
  }
  function movePointer(e:React.PointerEvent,clip:MusicClip,edge:"start"|"end"|"move"){
    if(e.button!==0)return;
    setSelected(clip.id);
    if(edge==="move"&&clip.syncLocked)return;
    e.stopPropagation();e.preventDefault();
    const startX=e.clientX,initial={...clip};
    const startClips=latest.current;
    const handler=(event:PointerEvent)=>{
      const delta=Math.round((event.clientX-startX)/zoom*1000/50)*50;
      const asset=byId.get(clip.assetId);if(!asset||!project)return;
      const next={...initial};
      if(edge==="move")next.timelineStartMs=Math.min(timelineLimit-(clip.sourceOutMs-clip.sourceInMs),Math.max(0,snapped(initial.timelineStartMs+delta,clip)));
      if(edge==="start"){
        next.sourceInMs=Math.min(initial.sourceOutMs-100,Math.max(0,initial.sourceInMs+delta));
        next.timelineStartMs=initial.timelineStartMs+(next.sourceInMs-initial.sourceInMs);
      }
      if(edge==="end")next.sourceOutMs=Math.min(asset.durationMs,Math.max(initial.sourceInMs+100,initial.sourceOutMs+delta));
      if(next.timelineStartMs<0||clipEnd(next)>timelineLimit||overlaps(startClips,next).length)return;
      setClips(startClips.map(c=>c.id===next.id?next:c));
    };
    const finish=(event:PointerEvent)=>{
      document.removeEventListener("pointermove",handler);document.removeEventListener("pointerup",finish);
      document.removeEventListener("pointercancel",finish);
      const delta=Math.round((event.clientX-startX)/zoom*1000/50)*50;
      const asset=byId.get(clip.assetId);if(!asset||!project)return;
      const next={...initial};
      if(edge==="move")next.timelineStartMs=Math.min(timelineLimit-(clip.sourceOutMs-clip.sourceInMs),Math.max(0,snapped(initial.timelineStartMs+delta,clip)));
      if(edge==="start"){next.sourceInMs=Math.min(initial.sourceOutMs-100,Math.max(0,initial.sourceInMs+delta));next.timelineStartMs=initial.timelineStartMs+(next.sourceInMs-initial.sourceInMs);}
      if(edge==="end")next.sourceOutMs=Math.min(asset.durationMs,Math.max(initial.sourceInMs+100,initial.sourceOutMs+delta));
      if(next.timelineStartMs<0||clipEnd(next)>timelineLimit||overlaps(startClips,next).length){setClips(startClips);setError("Clip overlaps another clip or exceeds the song.");return;}
      if(JSON.stringify(next)!==JSON.stringify(initial))apply(startClips.map(c=>c.id===next.id?next:c));
    };
    document.addEventListener("pointermove",handler);document.addEventListener("pointerup",finish,{once:true});
    document.addEventListener("pointercancel",finish,{once:true});
  }
  function split(){
    if(!selectedClip||playhead<=selectedClip.timelineStartMs+100||playhead>=clipEnd(selectedClip)-100)return;
    const splitAt=selectedClip.sourceInMs+(Math.round(playhead)-selectedClip.timelineStartMs);
    const left={...selectedClip,sourceOutMs:splitAt};
    const right={...selectedClip,id:uuid(),timelineStartMs:playhead,sourceInMs:splitAt};
    apply([...latest.current.filter(c=>c.id!==selectedClip.id),left,right]);setSelected(right.id);
  }
  function deleteClip(){
    if(!selectedClip)return;apply(latest.current.filter(c=>c.id!==selectedClip.id));setSelected(null);
  }
  function toggleLock(){
    if(!selectedClip||!selectedAsset||selectedAsset.kind!=="lip-sync")return;
    if(selectedClip.syncLocked&&!window.confirm("Unlock song synchronization? Moving this clip can break lip sync."))return;
    const lock=!selectedClip.syncLocked;
    if(lock&&(selectedAsset.sourceStartMs===null||selectedAsset.sourceEndMs===null||selectedClip.timelineStartMs!==selectedAsset.sourceStartMs+selectedClip.sourceInMs+songOffset(rangeRef.current)||clipEnd(selectedClip)>selectedAsset.sourceEndMs+songOffset(rangeRef.current))){
      setError("Move this clip back to its original song position before relocking.");return;
    }
    apply(latest.current.map(c=>c.id===selectedClip.id?{...c,syncLocked:lock}:c));
  }
  async function openLipSync(track:Track){
    setAddMenu(null);setLipTrack(track);setLipSearch("");setLipError("");setLipLoading(true);setLipSources([]);
    try{
      await ensureSession();
      const result=await request<{videos:LipSyncSource[]}>(endpoint+id+"/lip-sync");
      setLipSources(result.videos);
    }catch(e){setLipError(e instanceof Error?e.message:"Unable to load Lip Sync videos.");}
    finally{setLipLoading(false);}
  }
  async function insertLipSync(source:LipSyncSource,track:Track){
    if(importBusy.current)return;
    importBusy.current=true;setImporting(true);setLipError("");
    try{
      if(saveTimer.current)clearTimeout(saveTimer.current);
      await saveNow();
      const existing=detailRef.current?.assets.find(a=>a.sourceKind==="live"&&a.sourceId===source.id);
      const a=existing??(await request<{asset:MusicAsset}>(endpoint+id+"/assets",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({sourceKind:"live",sourceId:source.id})
      })).asset;
      if(!existing)await load();
      setLipTrack(null);setLibraryOpen(true);setFilter("Lip Sync");
      addClip(a,track,source.sourceStartMs);
    }catch(e){setLipError(e instanceof Error?e.message:"Unable to insert Lip Sync video.");}
    finally{importBusy.current=false;setImporting(false);}
  }
  async function uploadVideo(file:File,track:Track|null){
    if(importBusy.current)return;
    if(!/\.(mp4|webm)$/i.test(file.name)||file.size<1||file.size>50*1024*1024){
      setError("Choose an MP4 or WebM video up to 50 MB.");return;
    }
    importBusy.current=true;setImporting(true);setError("");
    try{
      if(saveTimer.current)clearTimeout(saveTimer.current);
      await saveNow();setStatus("Uploading…");
      const form=new FormData();form.set("video",file);
      const result=await request<{asset:MusicAsset}>(endpoint+id+"/assets",{method:"POST",body:form});
      await load();setLibraryOpen(true);setFilter("Uploads");setStatus("Saved");
      if(track!==null)addClip(result.asset,track,playhead);
    }catch(e){setError(e instanceof Error?e.message:"Upload failed.");setStatus("Saved");}
    finally{importBusy.current=false;setImporting(false);}
  }
  async function deleteAsset(a:MusicAsset){
    if(!window.confirm("Remove '"+a.name+"' from this project's Library? Original videos in Videos are preserved."))return;
    try{await saveNow();await request(endpoint+id+"/assets/"+a.id,{method:"DELETE"});await load();}
    catch(e){setError(e instanceof Error?e.message:"Could not remove asset.");}
  }
  async function saveName(){
    if(!newName.trim()||!project)return;
    try{await saveNow();const data=await request<{project:MusicProject}>(endpoint+id,{
      method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:newName})});
      revision.current=data.project.revision;setDetail(prev=>prev?{...prev,project:data.project}:prev);setEditingName(false);
    }catch(e){setError(e instanceof Error?e.message:"Rename failed.");}
  }
  function stopPlayback(){
    playingRef.current=false;setPlaying(false);audio.current?.pause();video.current?.pause();
  }
  function setAt(ms:number,range=rangeRef.current){
    ms=Math.round(ms);playheadRef.current=ms;setPlayhead(ms);
    if(audio.current&&audio.current.readyState>=1)
      audio.current.currentTime=Math.max(range.startMs,Math.min(range.endMs,ms-songOffset(range)))/1000;
  }
  function seek(ms:number){
    if(!project)return;
    stopPlayback();setAt(Math.max(0,Math.min(timelineEnd,ms)));
  }
  useEffect(()=>{
    if(!playing)return;
    let frame=0,last=performance.now(),starting=false;
    const tick=(now:number)=>{
      if(!playingRef.current)return;
      const current=audio.current,range=rangeRef.current,end=songTimelineEnd(range);
      let at=playheadRef.current;
      const elapsed=Math.max(0,now-last);last=now;
      if(at>=range.positionMs&&at<end&&current){
        if(current.ended){at=end;}
        else{
          if(current.paused&&!starting){
            starting=true;current.currentTime=Math.max(range.startMs,at-songOffset(range))/1000;
            void current.play().catch(()=>{stopPlayback();setError("Audio playback was blocked.");}).finally(()=>{starting=false;if(!playingRef.current)current.pause();});
          }
          if(!current.paused)at=Math.max(range.positionMs,Math.round(current.currentTime*1000)+songOffset(range));
          if(at>=end){current.pause();at=end;}
        }
      }else{
        current?.pause();at=Math.min(at+elapsed,at<range.positionMs?range.positionMs:timelineEnd);
      }
      if(at>=timelineEnd){playheadRef.current=timelineEnd;setPlayhead(timelineEnd);stopPlayback();return;}
      playheadRef.current=at;setPlayhead(Math.round(at));frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);
    return()=>cancelAnimationFrame(frame);
  },[playing,timelineEnd]);
  function togglePlayback(){
    if(!audio.current)return;
    if(playingRef.current){stopPlayback();return;}
    if(playheadRef.current>=timelineEnd)setAt(0);
    playingRef.current=true;setPlaying(true);
    const range=rangeRef.current,at=playheadRef.current;
    if(at>=range.positionMs&&at<songTimelineEnd(range)){
      audio.current.currentTime=(at-songOffset(range))/1000;
      void audio.current.play().catch(()=>{stopPlayback();setError("Audio playback was blocked.");});
    }
  }
  useEffect(()=>{
    if(!activeClip||!activeAsset||!video.current)return;
    const expected=(activeClip.sourceInMs+Math.max(0,playhead-activeClip.timelineStartMs))/1000;
    if(video.current.readyState>=1&&Math.abs(video.current.currentTime-expected)>(playing?0.24:0.001)){
      try{video.current.currentTime=expected;}catch{}
    }
    if(playing&&video.current.paused)void video.current.play().catch(()=>{});
    if(!playing)video.current.pause();
  },[playhead,activeClip,activeAsset,playing]);
  const media=assets.filter(a=>(filter==="All"||filter==="Lip Sync"&&a.kind==="lip-sync"||filter==="AI Video"&&a.kind==="ai-video"||filter==="Uploads"&&a.kind==="imported")&&
    a.name.toLowerCase().includes(search.toLowerCase()));
  if(!detail)return <main className="mv-root"><Link href="/projects">← Projects</Link><p role="status">Loading Music Video Builder…</p><p role="alert">{error}</p></main>;
  const ticks=Array.from({length:Math.floor(pixels/zoom/10)+1},(_,i)=>i*10000);
  return <main id="content" className="mv-root mv-editor">
    <div className="mv-top">
      <div className="mv-name"><Link href="/projects" aria-label="Back to projects">‹</Link>
        {editingName?<form onSubmit={e=>{e.preventDefault();void saveName();}}>
          <input autoFocus maxLength={80} value={newName} onChange={e=>setNewName(e.target.value)}/>
          <button type="submit" aria-label="Save project name"><Check size={17}/></button></form>:
          <button title="Rename project" onClick={()=>setEditingName(true)}><Pencil size={17}/>{project!.name}</button>}</div>
      <div className="mv-top-actions"><span role="status" className="mv-status">{status}</span>
        <button className="mv-primary" type="button" title="MP4 Export — Coming Soon" disabled><Upload size={17}/> Export · Coming Soon</button></div>
    </div>
    <section className="mv-preview" aria-label="Music video preview">
      <div className="mv-video-box">
        {activeAsset?<video key={activeAsset.id} ref={video} playsInline muted preload="auto" src={source(activeAsset)}
          onLoadedMetadata={e=>{
            const v=e.currentTarget;const at=activeClip?activeClip.sourceInMs+Math.max(0,playhead-activeClip.timelineStartMs):0;
            try{v.currentTime=at/1000;}catch{}
            if(playing)void v.play().catch(()=>{});
          }}/>:<div className="mv-preview-empty"><Film size={40}/><span>Arrange clips to preview your music video</span></div>}
        <span className="mv-ratio">▣ 16:9</span>
      </div>
      <audio ref={audio} src={endpoint+id+"/song"} preload="metadata"
        onLoadedMetadata={()=>setAt(playheadRef.current)}/>
      <div className="mv-player-controls">
        <button aria-label={playing?"Pause":"Play"} onClick={togglePlayback}>{playing?<Pause size={19}/>:<Play size={19}/>}</button>
        <span className="mv-clock">{time(playhead,true)} / {time(timelineEnd,true)}</span>
        <input className="mv-progress" aria-label="Seek song" type="range" min={0} max={timelineEnd} step="1" value={Math.max(0,Math.min(timelineEnd,playhead))} onChange={e=>seek(Number(e.target.value))}/>
        <button title="Song is the only audio track" aria-label="Song audio only"><Volume2 size={19}/></button>
        <button aria-label="Fullscreen" onClick={()=>{const box=document.querySelector(".mv-video-box");void box?.requestFullscreen?.();}}><Maximize size={19}/></button>
      </div>
    </section>
    <section className="mv-timeline" aria-label="Timeline editor">
      <div className="mv-timeline-toolbar">
        <div><button aria-label="Undo" disabled={!past.current.length} onClick={undo}><Undo2 size={17}/></button>
          <button aria-label="Redo" disabled={!future.current.length} onClick={redo}><Redo2 size={17}/></button>
          <button onClick={split} disabled={!selectedClip}><Scissors size={17}/> Split</button>
          <button onClick={deleteClip} disabled={!selectedClip}><Trash2 size={17}/> Delete</button>
          {selectedAsset?.kind==="lip-sync"&&<button onClick={toggleLock}>{selectedClip?.syncLocked?<Lock size={16}/>:<Unlock size={16}/>} Sync</button>}
          {selectedClip&&<button title="Move clip to the other video track" onClick={()=>{
            const moved={...selectedClip,track:(selectedClip.track===1?2:1) as Track};
            if(overlaps(latest.current,moved).length){setError("The other track is occupied.");return;}
            apply(latest.current.map(c=>c.id===moved.id?moved:c));
          }}>Switch track</button>}</div>
        <div className="mv-timeline-zoom"><strong>{time(playhead,true)}</strong>
          <label><input type="checkbox" checked={snap} onChange={e=>setSnap(e.target.checked)}/> Snap</label>
          <Minus size={15}/><input aria-label="Timeline zoom" type="range" min="20" max="140" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/><ZoomIn size={16}/></div>
      </div>
      <div className="mv-tracks">
        <div className="mv-track-labels">
          <div className="mv-label mv-ruler-spacer"/>
          {([2,1] as Track[]).map(track=><div className="mv-label" key={track}>
            <Film size={18}/><strong>Video {track}</strong><button aria-label={"Add video to track "+track} onClick={()=>setAddMenu(addMenu===track?null:track)}><Plus size={17}/></button>
            {addMenu===track&&<div className="mv-add-menu">
              <button disabled={importing} onClick={()=>void openLipSync(track)}><Music2 size={15}/> Insert Lip Sync</button>
              <button disabled={importing} onClick={()=>{setUploadTrack(track);fileInput.current?.click();setAddMenu(null);}}><Upload size={15}/> Upload own video</button>
              <button onClick={()=>{setLibraryOpen(true);setAddMenu(null);}}><FolderOpen size={15}/> Library</button>
              <button disabled title="AI video generation will be added later"><Plus size={15}/> Generate · Soon</button>
            </div>}
          </div>)}
          <div className="mv-label"><Music2 size={18}/><strong>Song</strong><Scissors size={15}/></div>
        </div>
        <div className="mv-scroll" ref={scroll}>
          <div className="mv-track-area" style={{width:pixels}}>
            <div className="mv-ruler" onPointerDown={e=>seek(msFromX(e.clientX-e.currentTarget.getBoundingClientRect().left))}>
              {ticks.map(t=><span key={t} style={{left:t/1000*zoom}}>{time(t)}</span>)}
            </div>
            {([2,1] as Track[]).map(track=><div className="mv-lane" key={track} onDragOver={e=>e.preventDefault()} onDrop={e=>onDrop(e,track)}>
              {clips.filter(c=>c.track===track).map(c=>{
                const a=byId.get(c.assetId);if(!a)return null;
                return <div key={c.id} className={"mv-clip"+(selected===c.id?" is-selected":"")+(c.syncLocked?" is-locked":"")}
                    style={{left:c.timelineStartMs/1000*zoom,width:(c.sourceOutMs-c.sourceInMs)/1000*zoom}}
                    draggable={!c.syncLocked}
                    onDragStart={e=>e.dataTransfer.setData("application/x-mvclip",c.id)}
                    tabIndex={0} aria-label={"Select video "+a.name}
                    onKeyDown={e=>{if(e.target===e.currentTarget&&(e.key==="Enter"||e.key===" ")){e.preventDefault();setSelected(c.id);seek(c.timelineStartMs);}}}
                    onClick={()=>{setSelected(c.id);seek(c.timelineStartMs);}}
                    onPointerDown={e=>{if(!(e.target as HTMLElement).closest(".mv-handle"))movePointer(e,c,"move");}}
                    title={a.name+" · "+time(c.timelineStartMs,true)}>
                  <button className="mv-handle" aria-label="Trim clip start" onPointerDown={e=>movePointer(e,c,"start")}>Ⅱ</button>
                  <span className="mv-clip-title">{a.kind==="lip-sync"?"🎤 ":"🎬 "}{a.name}</span>
                  {c.syncLocked&&<Lock className="mv-clip-lock" size={13}/>}
                  <button className="mv-handle" aria-label="Trim clip end" onPointerDown={e=>movePointer(e,c,"end")}>Ⅱ</button>
                </div>;
              })}
            </div>)}
            <div className="mv-song-lane" onPointerDown={e=>{if(e.target===e.currentTarget)seek(msFromX(e.clientX-e.currentTarget.getBoundingClientRect().left));}}>
              <div className="mv-song-block" role="button" tabIndex={0} aria-label="Move song on timeline" title="Drag song to move it"
                style={{left:songRange.positionMs/1000*zoom,width:(songRange.endMs-songRange.startMs)/1000*zoom}}
                onPointerDown={dragSong} onKeyDown={e=>{if(e.key!=="ArrowLeft"&&e.key!=="ArrowRight")return;e.preventDefault();const r=rangeRef.current;
                  commitSongRange(r,Math.max(0,r.positionMs+(e.key==="ArrowLeft"?-1:1)*(e.shiftKey?100:1)));}}>
                <div className="mv-wave" style={{width:project!.songDurationMs/1000*zoom,left:-songRange.startMs/1000*zoom}}>{(wave.length?wave:Array.from({length:180},()=>0.22)).map((v,i)=>
                  <span key={i} style={{height:Math.max(5,Math.min(100,v*100))+"%"}}/>)}</div>
              </div>
              {(["start","end"] as const).map(edge=><button type="button" key={edge} className={"mv-song-handle "+edge}
                style={{left:(edge==="start"?songRange.positionMs:songTimelineEnd(songRange))/1000*zoom}}
                aria-label={"Trim song "+edge} title={time(edge==="start"?songRange.startMs:songRange.endMs,true)}
                onPointerDown={e=>dragSongEdge(e,edge)}
                onKeyDown={e=>{if(e.key!=="ArrowLeft"&&e.key!=="ArrowRight")return;e.preventDefault();const range=rangeRef.current;
                  commitSongRange(moveSongEdge(range,edge,(edge==="start"?range.startMs:range.endMs)+(e.key==="ArrowLeft"?-1:1)*(e.shiftKey?100:1),project!.songDurationMs));}}>Ⅱ</button>)}
            </div>
            <div className="mv-playhead" style={{left:playhead/1000*zoom}}><span/></div>
          </div>
        </div>
      </div>
      {selectedClip&&selectedAsset&&<form className="mv-song-trim mv-clip-position" onSubmit={e=>{e.preventDefault();submitClipTime();}}>
        <strong><Film size={16}/> Video {selectedClip.track}: {selectedAsset.name}</strong>
        <label>Song start time<input aria-label="Video start time in original song" value={clipSongText} onChange={e=>updateClipTime(e.target.value,"song")} placeholder="00:08.918"/></label>
        <label>Timeline start<input aria-label="Video start time on timeline" value={clipTimelineText} onChange={e=>updateClipTime(e.target.value,"timeline")} placeholder="00:08.918"/></label>
        <button type="submit" className="mv-primary" disabled={importing}>Move video</button>
        {originalClipSongTime!==null&&<button type="button" className="mv-outline" disabled={importing} onClick={()=>moveSelectedClip(songTimeToTimeline(originalClipSongTime,rangeRef.current),true)}><Lock size={14}/> Restore Lip Sync · {time(originalClipSongTime,true)}</button>}
        <small>Song start refers to the original recording; timeline start follows the actual project timeline. Enter MM:SS.mmm or seconds. Clips only move if the full interval is free on this track.{selectedClip.syncLocked?" Sync Lock is enabled.":""}</small>
      </form>}
      <form className="mv-song-trim" onSubmit={e=>{e.preventDefault();submitSongRange();}}>
        <strong><Scissors size={16}/> Song trim</strong>
        <label>Source start<input aria-label="Song start time" value={startText} onChange={e=>setStartText(e.target.value)} placeholder="00:08.918"/></label>
        <label>Source end<input aria-label="Song end time" value={endText} onChange={e=>setEndText(e.target.value)} placeholder="00:30.000"/></label>
        <label>Timeline position<input aria-label="Song timeline position" value={positionText} onChange={e=>setPositionText(e.target.value)} placeholder="00:08.918"/></label>
        <button type="submit" className="mv-outline" disabled={importing}>Apply</button>
        <button type="button" className="mv-outline" disabled={importing} onClick={()=>commitSongRange({startMs:0,endMs:project!.songDurationMs},0)}>Reset</button>
        <span>Duration <b>{time(songRange.endMs-songRange.startMs,true)}</b></span>
        <small>Drag the song to move it. Sync-locked videos move with it. Enter MM:SS.mmm or seconds.</small>
      </form>
      {error&&<p className="mv-error" role="alert">{error}</p>}
      <input ref={fileInput} hidden type="file" accept=".mp4,.webm,video/mp4,video/webm" onChange={e=>{
        const file=e.target.files?.[0];if(file)void uploadVideo(file,uploadTrack);e.target.value="";
      }}/>
    </section>
    <section className="mv-library">
      <button className="mv-library-heading" aria-expanded={libraryOpen} onClick={()=>setLibraryOpen(!libraryOpen)}>
        {libraryOpen?<ChevronDown size={21}/>:<ChevronRight size={21}/>}<h2>Library</h2><span>{assets.length} videos</span>
      </button>
      {libraryOpen&&<div className="mv-library-content">
        <div className="mv-library-tools"><div className="mv-filter">{(["All","Lip Sync","AI Video","Uploads"] as const).map(f=>
          <button key={f} className={filter===f?"active":""} onClick={()=>setFilter(f)}>{f}</button>)}</div>
          <div className="mv-library-search"><Search size={16}/><input placeholder="Search library…" aria-label="Search media" value={search} onChange={e=>setSearch(e.target.value)}/></div>
          <button className="mv-outline" disabled={importing} onClick={()=>{setUploadTrack(null);fileInput.current?.click();}}><Upload size={16}/> Upload video</button>
        </div>
        {media.length?<div className="mv-media-grid">{media.map(a=><article key={a.id} className="mv-media-card"
          draggable onDragStart={e=>e.dataTransfer.setData("application/x-mvasset",a.id)}>
          <div className="mv-media-image"><Film size={32}/><span>{time(a.durationMs)}</span></div>
          <div className="mv-media-info"><small>{a.kind==="lip-sync"?"🎤 Lip Sync":a.kind==="imported"?"Uploaded video":"🎬 AI Video"}</small>
            <strong title={a.name}>{a.name}</strong>
            <div className="mv-media-actions"><button onClick={()=>addClip(a,1,playhead)}><Plus size={14}/> Add to timeline</button>
              <details><summary aria-label={"Options for "+a.name}><MoreHorizontal size={17}/></summary>
                <div><button onClick={()=>addClip(a,2,playhead)}>Add to Video 2</button><button onClick={()=>void deleteAsset(a)}>Remove from Library</button></div>
              </details></div>
          </div></article>)}</div>:<p className="mv-empty-library">No videos in this Library. Import a video or use Add to Project from Videos.</p>}
      </div>}
    </section>
    {lipTrack!==null&&<div className="mv-dialog-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget&&!importing)setLipTrack(null);}}>
      <div className="mv-dialog mv-lip-dialog" role="dialog" aria-modal="true" aria-label="Insert Lip Sync">
        <h2>Insert Lip Sync · Video {lipTrack}</h2>
        <p>Choose a completed Lip Sync video. It will be placed at its original song time with Sync Lock enabled. Use the same song for accurate synchronization.</p>
        <input autoFocus placeholder="Search completed videos…" aria-label="Search Lip Sync videos" value={lipSearch} onChange={e=>setLipSearch(e.target.value)}/>
        {lipLoading?<p role="status">Loading your videos…</p>:<div className="mv-lip-list">
          {lipSources.filter(s=>s.name.toLowerCase().includes(lipSearch.toLowerCase())).map(s=><button key={s.id} type="button" disabled={importing||s.sourceStartMs>=project!.songDurationMs||s.sourceEndMs>project!.songDurationMs}
            onClick={()=>void insertLipSync(s,lipTrack)}>
            <Music2 size={19}/><span><strong>{s.name}</strong><small>{time(s.sourceStartMs,true)} – {time(s.sourceEndMs,true)} · {time(s.durationMs)}</small></span><Plus size={18}/>
          </button>)}
          {!lipSources.filter(s=>s.name.toLowerCase().includes(lipSearch.toLowerCase())).length&&<p>No matching completed Lip Sync videos.</p>}
        </div>}
        {lipError&&<p role="alert" className="mv-error">{lipError}</p>}
        <div className="mv-dialog-actions"><button type="button" disabled={importing} onClick={()=>setLipTrack(null)}>Close</button></div>
      </div>
    </div>}
  </main>;
}
