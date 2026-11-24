"use client";
import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import Link from "next/link";
import {ChevronDown,ChevronRight,Check,Clock3,Film,FolderOpen,Lock,Unlock,
  Maximize,Minus,MoreHorizontal,Music2,Pause,Pencil,Play,Plus,Redo2,Scissors,
  Search,Trash2,Undo2,Upload,Download,X,Volume2,VolumeX,ZoomIn} from "lucide-react";
import {ensureSession} from "@/lib/client";
import type {MusicAsset,MusicClip,MusicProject,Track,MediaRole} from "@/lib/music-video/core";
import {parseSongTime,validSongRange,moveSongEdge,validSongPlacement,trimSongPlacement,shiftLockedClips,songOffset,songTimelineEnd,MAX_TIMELINE_MS,songTimeToTimeline,timelineToSongTime,parseRelativeSongTime,positionVideoClip,trimVideoClip,transferVideoClip,trimSongAtPlayhead,splitVideoAtPlayhead,snapPlayhead,timelineProgress,setVideoEnd,MEDIA_HOLD_MS,mediaPanAxis,effectiveSongParts,validSongParts,splitSongPart,songPartAt,songPartsEnd,continuousSongParts,type SongRange,type SongPlacement} from "@/lib/music-video/song-range";
import "./music-video.css";

type LipSyncSource={id:string;name:string;durationMs:number;sourceStartMs:number;sourceEndMs:number};
type EditSnapshot={clips:MusicClip[];range:SongPlacement;parts:SongRange[]|null};
type Detail={project:MusicProject;assets:MusicAsset[];clips:MusicClip[]};
type ExportJob={id:string;state:"rendering"|"ready"|"failed";progress:number;resolution?:{width:number;height:number};error?:string};
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
  const [songParts,setSongParts]=useState<SongRange[]|null>(null),partsRef=useRef<SongRange[]|null>(null);
  const [partIndex,setPartIndex]=useState(0),[partStartText,setPartStartText]=useState(""),[partEndText,setPartEndText]=useState("");
  const [songRange,setSongRange]=useState<SongPlacement>({startMs:0,endMs:0,positionMs:0});
  const [startText,setStartText]=useState("00:00.000"),[endText,setEndText]=useState("00:00.000");
  const [positionText,setPositionText]=useState("00:00.000");
  const playheadRef=useRef(0),playingRef=useRef(false);
  const rangeRef=useRef<SongPlacement>({startMs:0,endMs:0,positionMs:0});
  const [selected,setSelected]=useState<string|null>(null),[playhead,setPlayhead]=useState(0);
  const [markerText,setMarkerText]=useState("00:00.000"),[scrubbing,setScrubbing]=useState(false);
  const markerDrag=useRef<{pointer:number;offset:number}|null>(null);
  const trackArea=useRef<HTMLDivElement>(null);
  useEffect(()=>{setMarkerText(time(playhead,true));},[playhead]);
  const [dragTrack,setDragTrack]=useState<Track|null>(null),[dragBlocked,setDragBlocked]=useState(false);
  const videoLanes=useRef<Partial<Record<Track,HTMLDivElement|null>>>({});
  const [clipSongText,setClipSongText]=useState("00:00.000"),[clipTimelineText,setClipTimelineText]=useState("00:00.000");
  const clipTimeMode=useRef<"song"|"timeline">("song");
  const [clipEndText,setClipEndText]=useState("00:00.000"),[clipSongEndText,setClipSongEndText]=useState("00:00.000");
  const clipEndMode=useRef<"song"|"timeline">("timeline"),clipEditKind=useRef<"start"|"end">("start");
  const [armedMedia,setArmedMedia]=useState<string|null>(null);
  const gestureCleanup=useRef<(()=>void)|null>(null);
  useEffect(()=>()=>gestureCleanup.current?.(),[]);
  const [playing,setPlaying]=useState(false),[zoom,setZoom]=useState(44),[snap,setSnap]=useState(true);
  const [libraryOpen,setLibraryOpen]=useState(false),[filter,setFilter]=useState<"All"|"Lip Sync"|"B-Roll"|"AI Video"|"Uploads">("All");
  const [search,setSearch]=useState(""),[addMenu,setAddMenu]=useState<Track|null>(null);
  const [uploadTrack,setUploadTrack]=useState<Track|null>(null),[error,setError]=useState(""),[status,setStatus]=useState("Saved");
  const [lipTrack,setLipTrack]=useState<Track|null>(null),[lipSources,setLipSources]=useState<LipSyncSource[]>([]);
  const [lipLoading,setLipLoading]=useState(false),[lipSearch,setLipSearch]=useState(""),[lipError,setLipError]=useState("");
  const [importing,setImporting]=useState(false);
  const importBusy=useRef(false),roleBusy=useRef(false);
  const [exportJob,setExportJob]=useState<ExportJob|null>(null),[exportError,setExportError]=useState(""),[exportOpen,setExportOpen]=useState(false),[exporting,setExporting]=useState(false);
  const exportAbort=useRef<AbortController|null>(null),exportBusy=useRef(false);
  useEffect(()=>()=>exportAbort.current?.abort(),[]);
  const [inspectorOpen,setInspectorOpen]=useState(true);
  const [roleChanging,setRoleChanging]=useState<string|null>(null),[roleError,setRoleError]=useState("");
  const [wave,setWave]=useState<number[]>([]),[editingName,setEditingName]=useState(false),[newName,setNewName]=useState("");
  const audio=useRef<HTMLAudioElement>(null),video=useRef<HTMLVideoElement>(null),scroll=useRef<HTMLDivElement>(null),fileInput=useRef<HTMLInputElement>(null);
  const revision=useRef(0),latest=useRef<MusicClip[]>([]),dirty=useRef(false),inFlight=useRef<Promise<void>|null>(null);
  const saveTimer=useRef<ReturnType<typeof setTimeout>|null>(null),past=useRef<EditSnapshot[]>([]),future=useRef<EditSnapshot[]>([]);
  const detailRef=useRef<Detail|null>(null);
  const load=useCallback(async()=>{
    const data=await request<Detail>(endpoint+id);
    detailRef.current=data;revision.current=data.project.revision;latest.current=data.clips;dirty.current=false;
    const range={startMs:data.project.songStartMs,endMs:data.project.songEndMs,positionMs:data.project.songPositionMs};
    partsRef.current=data.project.songParts;setSongParts(data.project.songParts);setPartIndex(0);
    rangeRef.current=range;setSongRange(range);setStartText(time(range.startMs,true));setEndText(time(range.endMs,true));setPositionText(time(range.positionMs,true));
    playingRef.current=false;setPlaying(false);audio.current?.pause();video.current?.pause();
    const at=Math.min(playheadRef.current,Math.max(songPartsEnd(range,partsRef.current),...data.clips.map(clipEnd)));
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
    const snapshot=latest.current,range=rangeRef.current,parts=partsRef.current;
    setStatus("Saving…");
    const task=(async()=>{
      const result=await request<Detail>(endpoint+id+"/clips",{method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({revision:revision.current,clips:snapshot,songStartMs:range.startMs,songEndMs:range.endMs,songPositionMs:range.positionMs,songParts:parts})});
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
  function apply(next:MusicClip[],record=true,range=rangeRef.current,parts=partsRef.current){
    if(roleBusy.current)return;
    if(record){past.current.push({clips:latest.current,range:rangeRef.current,parts:partsRef.current});if(past.current.length>40)past.current.shift();future.current=[];}
    const changed=range.startMs!==rangeRef.current.startMs||range.endMs!==rangeRef.current.endMs||range.positionMs!==rangeRef.current.positionMs;
    const partsChanged=parts!==partsRef.current;
    partsRef.current=parts;setSongParts(parts);
    rangeRef.current=range;
    if(changed)displaySong(range);
    const at=timelineProgress(playheadRef.current,Math.max(songPartsEnd(range,parts),...next.map(clipEnd))).positionMs;
    if(changed||partsChanged||at!==Math.round(playheadRef.current)){stopPlayback();setAt(at,range);}
    latest.current=next;setClips(next);setError("");queue();
  }
  function undo(){
    if(roleBusy.current)return;
    const previous=past.current.pop();if(!previous)return;
    future.current.push({clips:latest.current,range:rangeRef.current,parts:partsRef.current});apply(previous.clips,false,previous.range,previous.parts);
  }
  function redo(){
    if(roleBusy.current)return;
    const next=future.current.pop();if(!next)return;
    past.current.push({clips:latest.current,range:rangeRef.current,parts:partsRef.current});apply(next.clips,false,next.range,next.parts);
  }
  function displaySong(range:SongPlacement){
    setSongRange(range);setStartText(time(range.startMs,true));setEndText(time(range.endMs,true));setPositionText(time(range.positionMs,true));
  }
  function commitSongRange(range:SongRange,position?:number){
    if(roleBusy.current)return;
    if(!project||!validSongRange(range.startMs,range.endMs,project.songDurationMs)){displaySong(rangeRef.current);setError("Choose a valid song range of at least 100 ms.");return;}
    const original=rangeRef.current;
    const next=position===undefined?trimSongPlacement(original,range):{...range,positionMs:position};
    if(!validSongPlacement(next,project.songDurationMs)){displaySong(original);setClips(latest.current);setError("Song position is outside the timeline.");return;}
    if(partsRef.current&&!validSongParts(partsRef.current,next)){displaySong(original);setClips(latest.current);setError("Edit the individual song parts or use Reset song first.");return;}
    const moved=shiftLockedClips(latest.current,songOffset(next)-songOffset(original));
    if(!moved){displaySong(original);setClips(latest.current);setError("Cannot move the song: a sync-locked video would overlap another clip or leave the timeline. Unlock or move the conflicting video first.");return;}
    displaySong(next);setClips(moved);
    if(next.startMs!==original.startMs||next.endMs!==original.endMs||next.positionMs!==original.positionMs)
      apply(moved,true,next);
  }
  function submitSongRange(){
    if(partsRef.current){const position=parseSongTime(positionText);if(position===null){setError("Enter a valid timeline position.");return;}commitSongRange(rangeRef.current,position);return;}
    const start=parseSongTime(startText),end=parseSongTime(endText),position=parseSongTime(positionText);
    if(start===null||end===null||position===null){setError("Enter seconds or MM:SS.mmm, for example 00:08.918.");return;}
    commitSongRange({startMs:start,endMs:end},position===rangeRef.current.positionMs?undefined:position);
  }
  // Short swipes pan the viewport, stationary holds arm editing. Do not move media on a scroll.
  function beginMediaGesture(e:React.PointerEvent,media:string,onHold:()=>void,onTap:()=>void,immediate=false){
    if(e.button!==0||!e.isPrimary||importBusy.current||gestureCleanup.current)return;
    e.preventDefault();e.stopPropagation();
    if(immediate&&e.pointerType==="mouse"){setArmedMedia(media);onHold();return;}
    const pointer=e.pointerId,x=e.clientX,y=e.clientY;
    const scroller=scroll.current,startScroll=scroller?.scrollLeft??0,startY=window.scrollY;
    let axis:"x"|"y"|null=null;
    const cleanup=()=>{
      clearTimeout(timer);
      document.removeEventListener("pointermove",move);
      document.removeEventListener("pointerup",up);
      document.removeEventListener("pointercancel",cancel);
      gestureCleanup.current=null;
    };
    const move=(event:PointerEvent)=>{
      if(event.pointerId!==pointer)return;
      const dx=event.clientX-x,dy=event.clientY-y;
      if(!axis){axis=mediaPanAxis(dx,dy);if(axis)clearTimeout(timer);}
      if(axis==="x"&&scroller)scroller.scrollLeft=startScroll-dx;
      if(axis==="y")window.scrollTo(0,startY-dy);
    };
    const up=(event:PointerEvent)=>{if(event.pointerId!==pointer)return;move(event);cleanup();if(!axis)onTap();};
    const cancel=(event:PointerEvent)=>{if(event.pointerId===pointer)cleanup();};
    const timer=setTimeout(()=>{if(axis)return;cleanup();if(importBusy.current)return;setArmedMedia(media);onHold();},MEDIA_HOLD_MS);
    gestureCleanup.current=cleanup;
    document.addEventListener("pointermove",move);
    document.addEventListener("pointerup",up);
    document.addEventListener("pointercancel",cancel);
  }
  function dragSong(e:React.PointerEvent<HTMLDivElement>){
    if(!project||importBusy.current||e.button!==0)return;
    selectSong();e.preventDefault();e.stopPropagation();stopPlayback();
    const original=rangeRef.current,origin=e.clientX,pointer=e.pointerId,initial=latest.current,startScroll=scroll.current?.scrollLeft??0;
    let position=original.positionMs;
    const update=(event:PointerEvent)=>{
      if(event.pointerId!==pointer)return;
      const dx=event.clientX-origin+(scroll.current?.scrollLeft??0)-startScroll;
      if(Math.abs(dx)<3)return;
      let next=Math.round(original.positionMs+dx/zoom*1000);
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
    const cleanup=()=>{document.removeEventListener("pointermove",update);document.removeEventListener("pointerup",finish);document.removeEventListener("pointercancel",cancel);setArmedMedia(null);};
    const finish=(event:PointerEvent)=>{if(event.pointerId!==pointer)return;update(event);cleanup();commitSongRange(original,position);};
    const cancel=(event:PointerEvent)=>{if(event.pointerId!==pointer)return;cleanup();displaySong(original);setClips(initial);};
    document.addEventListener("pointermove",update);document.addEventListener("pointerup",finish);document.addEventListener("pointercancel",cancel);
  }
  function dragSongEdge(e:React.PointerEvent<HTMLButtonElement>,edge:"start"|"end"){
    if(!project||importBusy.current||e.button!==0)return;
    selectSong();e.preventDefault();e.stopPropagation();stopPlayback();
    const original=rangeRef.current,origin=e.clientX,pointer=e.pointerId,startScroll=scroll.current?.scrollLeft??0;
    const duration=project.songDurationMs;
    let range:SongRange=original;
    const update=(event:PointerEvent)=>{
      if(event.pointerId!==pointer)return;
      const delta=(event.clientX-origin+(scroll.current?.scrollLeft??0)-startScroll)/zoom*1000;
      range=moveSongEdge(original,edge,(edge==="start"?original.startMs:original.endMs)+delta,duration);
      displaySong(trimSongPlacement(original,range));
    };
    const cleanup=()=>{
      document.removeEventListener("pointermove",update);
      document.removeEventListener("pointerup",finish);
      document.removeEventListener("pointercancel",cancel);setArmedMedia(null);
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
  const songSelected=!selectedClip||!selectedAsset;
  function selectSong(){setSelected(null);setAddMenu(null);setInspectorOpen(true);}
  useEffect(()=>{setInspectorOpen(true);},[selected,partIndex]);
  const currentParts=effectiveSongParts(songRange,songParts);
  const selectedPart=currentParts[Math.min(partIndex,currentParts.length-1)];
  useEffect(()=>{setPartStartText(time(selectedPart.startMs,true));setPartEndText(time(selectedPart.endMs,true));},[selectedPart.startMs,selectedPart.endMs]);
  function selectPart(i:number){setPartIndex(i);selectSong();}
  function selectVideo(id:string){setSelected(id);setInspectorOpen(true);setAddMenu(null);}
  function editPart(start:number,end:number){
    if(importBusy.current||!partsRef.current)return;
    const list=partsRef.current,i=Math.min(partIndex,list.length-1);
    const next=list.map((p,j)=>j===i?{startMs:start,endMs:end}:p);
    if(!validSongParts(next,rangeRef.current)){setError("Song part must fit between adjacent parts and within the original range.");return;}
    apply(latest.current,true,rangeRef.current,next);
  }
  function trimPartEdge(e:React.PointerEvent<HTMLButtonElement>,i:number,edge:"start"|"end"){
    const list=partsRef.current,range=rangeRef.current;
    if(!list||!list[i]||importBusy.current)return;
    selectPart(i);stopPlayback();e.preventDefault();e.stopPropagation();
    const start=e.clientX,pointer=e.pointerId,startScroll=scroll.current?.scrollLeft??0,part=list[i];
    let next=list;
    const update=(event:PointerEvent)=>{
      if(event.pointerId!==pointer)return;
      const delta=Math.round((event.clientX-start+(scroll.current?.scrollLeft??0)-startScroll)/zoom*1000);
      const p=edge==="start"?{...part,startMs:Math.max(list[i-1]?.endMs??range.startMs,Math.min(part.endMs-100,part.startMs+delta))}:{...part,endMs:Math.min(list[i+1]?.startMs??range.endMs,Math.max(part.startMs+100,part.endMs+delta))};
      next=list.map((item,j)=>j===i?p:item);setSongParts(next);
    };
    const clean=()=>{document.removeEventListener("pointermove",update);document.removeEventListener("pointerup",finish);document.removeEventListener("pointercancel",cancel);setArmedMedia(null);};
    const finish=(event:PointerEvent)=>{if(event.pointerId!==pointer)return;update(event);clean();if(JSON.stringify(next)!==JSON.stringify(list))apply(latest.current,true,range,next);else setSongParts(list);};
    const cancel=(event:PointerEvent)=>{if(event.pointerId!==pointer)return;clean();setSongParts(list);};
    document.addEventListener("pointermove",update);document.addEventListener("pointerup",finish);document.addEventListener("pointercancel",cancel);
  }
  function removeSongPart(){
    if(importBusy.current||!partsRef.current||partsRef.current.length<2)return;
    const i=Math.min(partIndex,partsRef.current.length-1);
    apply(latest.current,true,rangeRef.current,partsRef.current.filter((_,j)=>j!==i));setPartIndex(Math.max(0,i-1));
  }
  function splitSong(){
    if(importBusy.current)return;
    const next=splitSongPart(rangeRef.current,partsRef.current,playheadRef.current);
    if(!next){setError("Place the playhead inside a song part, at least 100 ms from either edge.");return;}
    stopPlayback();apply(latest.current,true,rangeRef.current,next);
    setPartIndex(next.findIndex(p=>p.startMs===timelineToSongTime(Math.round(playheadRef.current),rangeRef.current)));selectSong();
  }
  function resetSongParts(){
    if(importBusy.current)return;
    apply(latest.current,true,rangeRef.current,null);setPartIndex(0);
  }
  const selectedStart=selectedClip?.timelineStartMs;
  const selectedId=selectedClip?.id;
  const selectedEnd=selectedClip?clipEnd(selectedClip):undefined;
  const offset=songOffset(songRange);
  useEffect(()=>{
    if(selectedStart===undefined)return;
    setClipSongText(signedTime(selectedStart-offset));setClipTimelineText(time(selectedStart,true));clipTimeMode.current="song";clipEditKind.current="start";
  },[selectedId,selectedStart,offset]);
  useEffect(()=>{
    if(selectedEnd===undefined)return;
    setClipEndText(time(selectedEnd,true));setClipSongEndText(signedTime(selectedEnd-offset));clipEndMode.current="timeline";
  },[selectedId,selectedEnd,offset]);
  function updateClipEnd(text:string,mode:"song"|"timeline"){
    clipEditKind.current="end";clipEndMode.current=mode;
    if(mode==="timeline"){
      setClipEndText(text);const ms=parseSongTime(text);
      if(ms!==null)setClipSongEndText(signedTime(timelineToSongTime(ms,rangeRef.current)));
    }else{
      setClipSongEndText(text);const ms=parseRelativeSongTime(text);
      if(ms!==null)setClipEndText(signedTime(songTimeToTimeline(ms,rangeRef.current)));
    }
  }
  function submitClipEnd(){
    if(importBusy.current||!selectedClip||!selectedAsset)return;
    const current=latest.current.find(c=>c.id===selectedClip.id);if(!current)return;
    const mode=clipEndMode.current,ms=mode==="song"?parseRelativeSongTime(clipSongEndText):parseSongTime(clipEndText);
    if(ms===null){setError("Enter a valid end time, e.g. 00:08.918.");return;}
    const end=mode==="song"?songTimeToTimeline(ms,rangeRef.current):ms;
    const next=setVideoEnd(latest.current,current,end,sourceLimit(current,selectedAsset));
    if(!next){setError("The requested end does not fit the available video length or free space on this track. The clip was not changed.");return;}
    commitVideoEdit(current,next);setClipEndText(time(end,true));setClipSongEndText(signedTime(timelineToSongTime(end,rangeRef.current)));setError("");
  }
  function updateClipTime(text:string,mode:"song"|"timeline"){
    clipEditKind.current="start";clipTimeMode.current=mode;
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
  const originalClipSongTime=selectedClip&&selectedAsset?.role==="lip-sync"&&selectedAsset.sourceStartMs!==null&&selectedAsset.sourceEndMs!==null&&selectedAsset.sourceStartMs+selectedClip.sourceOutMs<=selectedAsset.sourceEndMs
    ?selectedAsset.sourceStartMs+selectedClip.sourceInMs:null;

  const activeClip=clips.filter(c=>playhead>=c.timelineStartMs&&playhead<clipEnd(c)).sort((a,b)=>b.track-a.track)[0];
  const activeAsset=activeClip?byId.get(activeClip.assetId):null;
  const source=(a:MusicAsset)=>endpoint+id+"/assets/"+a.id;
  const timelineEnd=project?Math.max(songPartsEnd(songRange,songParts),...clips.map(clipEnd)):0;
  const progress=timelineProgress(playhead,timelineEnd);
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
    if(roleBusy.current)return;
    const locked=asset.role==="lip-sync"&&asset.sourceStartMs!==null&&asset.sourceEndMs!==null;
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
    const assetId=e.dataTransfer.getData("application/x-mvasset");
    const a=byId.get(assetId);if(a)addClip(a,track,getDropTime(e));
  }
  function commitVideoEdit(initial:MusicClip,next:MusicClip){
    if(JSON.stringify(initial)!==JSON.stringify(next))
      apply(latest.current.map(c=>c.id===next.id?next:c));
    else setClips(latest.current);
    setSelected(next.id);stopPlayback();setAt(Math.min(playheadRef.current,Math.max(songPartsEnd(rangeRef.current,partsRef.current),...latest.current.map(clipEnd))));
  }
  function switchVideoTrack(){
    if(!selectedClip||importBusy.current)return;
    const current=latest.current.find(c=>c.id===selectedClip.id);if(!current)return;
    const result=transferVideoClip(latest.current,current,current.track===1?2:1,current.timelineStartMs);
    if(result.status!=="ok"){setError("The other track is occupied. The video was not moved.");return;}
    commitVideoEdit(current,result.clip);
  }
  function sourceLimit(clip:MusicClip,asset:MusicAsset){
    return clip.syncLocked&&asset.sourceStartMs!==null&&asset.sourceEndMs!==null
      ?Math.min(asset.durationMs,asset.sourceEndMs-asset.sourceStartMs):asset.durationMs;
  }
  function keyboardTrim(e:React.KeyboardEvent<HTMLButtonElement>,clip:MusicClip,edge:"start"|"end"){
    if(e.key!=="ArrowLeft"&&e.key!=="ArrowRight")return;
    e.preventDefault();e.stopPropagation();
    if(importBusy.current)return;
    const current=latest.current.find(c=>c.id===clip.id),asset=byId.get(clip.assetId);
    if(!current||!asset)return;
    const next=trimVideoClip(latest.current,current,edge,(e.key==="ArrowLeft"?-1:1)*(e.shiftKey?100:1),sourceLimit(current,asset),timelineLimit);
    commitVideoEdit(current,next);
  }
  function movePointer(e:React.PointerEvent,clip:MusicClip,edge:"start"|"end"|"move"){
    if(e.button!==0||importBusy.current)return;
    const asset=byId.get(clip.assetId),initial=latest.current.find(c=>c.id===clip.id);
    if(!asset||!initial||!project)return;
    e.stopPropagation();e.preventDefault();
    selectVideo(clip.id);setError("");stopPlayback();
    const startX=e.clientX,startY=e.clientY,pointer=e.pointerId,startScroll=scroll.current?.scrollLeft??0;
    const startClips=latest.current;
    let dragged=false;
    let next=initial,valid=true;
    const calculate=(event:PointerEvent)=>{
      const dx=event.clientX-startX+(scroll.current?.scrollLeft??0)-startScroll;
      const dy=event.clientY-startY;
      if(Math.abs(dx)>2||Math.abs(dy)>2)dragged=true;
      if(!dragged)return;
      const delta=Math.round(dx/zoom*1000);
      valid=true;
      if(edge==="move"){
        const track=([1,2] as const).find(t=>{const rect=videoLanes.current[t]?.getBoundingClientRect();return !!rect&&event.clientY>=rect.top&&event.clientY<rect.bottom;});
        if(track===undefined){valid=false;setDragTrack(null);setDragBlocked(false);setClips(startClips);return;}
        const position=initial.syncLocked||Math.abs(dx)<=3?initial.timelineStartMs:
          Math.min(MAX_TIMELINE_MS-(initial.sourceOutMs-initial.sourceInMs),Math.max(0,snapped(initial.timelineStartMs+delta,initial)));
        const result=transferVideoClip(startClips,initial,track,position);
        valid=result.status==="ok";setDragTrack(track);setDragBlocked(!valid);
        next=result.status==="ok"?result.clip:initial;
      }else{
        next=trimVideoClip(startClips,initial,edge,delta,sourceLimit(initial,asset),timelineLimit);
      }
      setClips(startClips.map(c=>c.id===next.id?next:c));
    };
    const update=(event:PointerEvent)=>{if(event.pointerId===pointer)calculate(event);};
    const cleanup=()=>{
      document.removeEventListener("pointermove",update);document.removeEventListener("pointerup",finish);document.removeEventListener("pointercancel",cancel);
      setDragTrack(null);setDragBlocked(false);setArmedMedia(null);
    };
    const finish=(event:PointerEvent)=>{
      if(event.pointerId!==pointer)return;
      calculate(event);cleanup();
      if(!valid){setClips(startClips);setError("Drop onto a free position on Video 1 or Video 2. The video was not moved.");return;}
      commitVideoEdit(initial,next);
    };
    const cancel=(event:PointerEvent)=>{if(event.pointerId!==pointer)return;cleanup();setClips(startClips);};
    document.addEventListener("pointermove",update);document.addEventListener("pointerup",finish);document.addEventListener("pointercancel",cancel);
  }
  function split(){
    if(importBusy.current||!selectedClip)return;
    const current=latest.current.find(c=>c.id===selectedClip.id);
    if(!current)return;
    const parts=splitVideoAtPlayhead(current,playheadRef.current,uuid());
    if(!parts){setError("Place the playhead at least 100 ms inside the selected video.");return;}
    if(latest.current.length>=500){setError("The timeline supports up to 500 clips.");return;}
    stopPlayback();apply([...latest.current.filter(c=>c.id!==current.id),...parts]);setSelected(parts[1].id);
  }
  function cutSong(edge:"start"|"end"){
    if(importBusy.current)return;
    if(partsRef.current){const source=timelineToSongTime(Math.round(playheadRef.current),rangeRef.current);const p=partsRef.current[Math.min(partIndex,partsRef.current.length-1)];if(source-p.startMs<100||p.endMs-source<100){setError("Place the playhead inside the selected song part.");return;}editPart(edge==="start"?source:p.startMs,edge==="end"?source:p.endMs);return;}
    const next=trimSongAtPlayhead(rangeRef.current,playheadRef.current,edge);
    if(!next){setError("Place the playhead inside the song, leaving at least 100 ms on either side.");return;}
    commitSongRange(next,next.positionMs);
  }
  function deleteClip(){
    if(roleBusy.current)return;
    if(!selectedClip)return;apply(latest.current.filter(c=>c.id!==selectedClip.id));setSelected(null);
  }
  function toggleLock(){
    if(!selectedClip||!selectedAsset||selectedAsset.role!=="lip-sync"||selectedAsset.sourceStartMs===null||selectedAsset.sourceEndMs===null)return;
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
  async function persistAssetRole(a:MusicAsset,role:MediaRole){
    if(a.role===role)return a;
    const wasBusy=roleBusy.current;roleBusy.current=true;
    let result:Detail;
    try{result=await request<Detail>(endpoint+id+"/assets/"+a.id,{method:"PATCH",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({role,revision:revision.current})});}finally{roleBusy.current=wasBusy;}
    revision.current=result.project.revision;detailRef.current=result;latest.current=result.clips;dirty.current=false;
    setDetail(result);setClips(result.clips);
    // Older edit snapshots can contain locks invalid under the new role.
    past.current=[];future.current=[];
    return result.assets.find(item=>item.id===a.id)!;
  }
  async function changeAssetRole(a:MusicAsset,role:MediaRole){
    if(importBusy.current||a.role===role)return;
    importBusy.current=true;roleBusy.current=true;setImporting(true);setRoleChanging(a.id);setRoleError("");setError("");
    try{
      stopPlayback();
      if(saveTimer.current)clearTimeout(saveTimer.current);
      await saveNow();setStatus("Saving…");
      await persistAssetRole(a,role);
      if(filter==="Lip Sync"||filter==="B-Roll")setFilter(role==="lip-sync"?"Lip Sync":"B-Roll");
      setStatus("Saved");
    }catch(e){setRoleError(e instanceof Error?e.message:"Could not change the video role.");setStatus(dirty.current?"Not saved":"Saved");}
    finally{roleBusy.current=false;importBusy.current=false;setImporting(false);setRoleChanging(null);}
  }
  async function insertLipSync(source:LipSyncSource,track:Track){
    if(importBusy.current)return;
    importBusy.current=true;setImporting(true);setLipError("");
    try{
      if(saveTimer.current)clearTimeout(saveTimer.current);
      await saveNow();
      const existing=detailRef.current?.assets.find(a=>a.sourceKind==="live"&&a.sourceId===source.id);
      const a=existing?await persistAssetRole(existing,"lip-sync"):(await request<{asset:MusicAsset}>(endpoint+id+"/assets",{
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
    if(importBusy.current)return;
    if(!window.confirm("Remove '"+a.name+"' from this project's Library? Original videos in Videos are preserved."))return;
    try{await saveNow();await request(endpoint+id+"/assets/"+a.id,{method:"DELETE"});await load();}
    catch(e){setError(e instanceof Error?e.message:"Could not remove asset.");}
  }
  async function saveName(){
    if(importBusy.current)return;
    if(!newName.trim()||!project)return;
    try{await saveNow();const data=await request<{project:MusicProject}>(endpoint+id,{
      method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:newName})});
      revision.current=data.project.revision;setDetail(prev=>prev?{...prev,project:data.project}:prev);setEditingName(false);
    }catch(e){setError(e instanceof Error?e.message:"Rename failed.");}
  }
  async function exportMp4(){
    if(importBusy.current||exportBusy.current||!latest.current.length)return;
    exportBusy.current=true;importBusy.current=true;setImporting(true);setExporting(true);setExportOpen(true);setExportError("");setExportJob(null);stopPlayback();
    const controller=new AbortController();exportAbort.current=controller;
    try{
      if(saveTimer.current)clearTimeout(saveTimer.current);
      await saveNow();
      let job=await request<ExportJob>(endpoint+id+"/export",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({revision:revision.current}),signal:controller.signal});
      setExportJob(job);
      const deadline=Date.now()+22*60*1000;
      while(job.state==="rendering"){
        await new Promise<void>(resolve=>setTimeout(resolve,1000));
        if(controller.signal.aborted)return;
        if(Date.now()>deadline)throw new Error("Export timed out. Please try again.");
        job=await request<ExportJob>(endpoint+id+"/export/"+job.id,{signal:controller.signal});setExportJob(job);
      }
      if(job.state!=="ready")throw new Error(job.error||"MP4 export failed.");
      const link=document.createElement("a");link.href=endpoint+id+"/export/"+job.id+"?download=1";link.download=(project?.name||"music-video")+".mp4";document.body.appendChild(link);link.click();link.remove();
      setExportOpen(false);
    }catch(e){if(!controller.signal.aborted)setExportError(e instanceof Error?e.message:"Export failed.");}
    finally{exportBusy.current=false;importBusy.current=false;if(!controller.signal.aborted){setImporting(false);setExporting(false);}exportAbort.current=null;}
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
  function submitMarker(){
    const ms=parseSongTime(markerText);
    if(ms===null||ms>timelineEnd){setError("Enter a valid timeline time, for example 00:08.918.");return;}
    seek(ms);setMarkerText(time(ms,true));setError("");
  }
  function scrubMarker(e:React.PointerEvent<HTMLElement>,grab=false){
    if(e.button!==0||markerDrag.current||!trackArea.current)return;
    e.preventDefault();e.stopPropagation();stopPlayback();
    const left=trackArea.current.getBoundingClientRect().left;
    markerDrag.current={pointer:e.pointerId,offset:grab?e.clientX-left-playheadRef.current/1000*zoom:0};
    e.currentTarget.setPointerCapture(e.pointerId);setScrubbing(true);
    if(!grab)updateMarker(e);
  }
  function updateMarker(e:React.PointerEvent<HTMLElement>){
    const drag=markerDrag.current,area=trackArea.current;
    if(!drag||drag.pointer!==e.pointerId||!area)return;
    const raw=(e.clientX-area.getBoundingClientRect().left-drag.offset)/zoom*1000;
    const range=rangeRef.current;
    const markers=[0,timelineEnd,...effectiveSongParts(range,partsRef.current).flatMap(p=>[songTimeToTimeline(p.startMs,range),songTimeToTimeline(p.endMs,range)]),...latest.current.flatMap(c=>[c.timelineStartMs,clipEnd(c)])];
    setAt(snapPlayhead(raw,timelineEnd,snap?markers:[],Math.min(150,5/zoom*1000)));
  }
  function releaseMarker(e:React.PointerEvent<HTMLElement>,cancel=false){
    if(markerDrag.current?.pointer!==e.pointerId)return;
    if(!cancel)updateMarker(e);
    markerDrag.current=null;setScrubbing(false);
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
  }
  function markerKey(e:React.KeyboardEvent<HTMLButtonElement>){
    let next=playheadRef.current;
    if(e.key==="Home")next=0;
    else if(e.key==="End")next=timelineEnd;
    else if(e.key==="ArrowLeft"||e.key==="ArrowRight")next+=(e.key==="ArrowLeft"?-1:1)*(e.shiftKey?100:1);
    else return;
    e.preventDefault();seek(next);
  }
  useEffect(()=>{
    if(!playing)return;
    let frame=0,last=performance.now(),starting=false;
    const tick=(now:number)=>{
      if(!playingRef.current)return;
      const current=audio.current,range=rangeRef.current;
      let at=playheadRef.current;
      const elapsed=Math.max(0,now-last);last=now;
      const part=songPartAt(range,continuousSongParts(range,partsRef.current),at);
      if(part&&current){
        const end=songTimelineEnd(part);
        if(current.ended&&Math.round(current.currentTime*1000)+songOffset(range)>=end-40){at=end;}
        else{
          if(current.paused&&!starting){
            starting=true;current.currentTime=Math.max(part.startMs,at-songOffset(range))/1000;
            void current.play().catch(()=>{stopPlayback();setError("Audio playback was blocked.");}).finally(()=>{starting=false;if(!playingRef.current)current.pause();});
          }
          if(!current.paused)at=Math.max(part.positionMs,Math.round(current.currentTime*1000)+songOffset(range));
          if(at>=end||current.ended){current.pause();at=end;}
        }
      }else{
        current?.pause();
        const next=effectiveSongParts(range,partsRef.current).map(p=>songTimeToTimeline(p.startMs,range)).find(p=>p>at)??timelineEnd;
        at=Math.min(at+elapsed,next,timelineEnd);
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
    if(songPartAt(range,partsRef.current,at)){
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
  const media=assets.filter(a=>(filter==="All"||filter==="Lip Sync"&&a.role==="lip-sync"||filter==="B-Roll"&&a.role==="b-roll"||filter==="AI Video"&&a.kind==="ai-video"||filter==="Uploads"&&a.kind==="imported")&&
    a.name.toLowerCase().includes(search.toLowerCase()));
  if(!detail)return <main className="mv-root"><Link href="/projects">← Projects</Link><p role="status">Loading Music Video Builder…</p><p role="alert">{error}</p></main>;
  const ticks=Array.from({length:Math.floor(pixels/zoom/10)+1},(_,i)=>i*10000);
  return <main id="content" className="mv-root mv-editor">
    <div className="mv-top">
      <div className="mv-name"><Link href="/projects" aria-label="Back to projects">‹</Link>
        {editingName?<form onSubmit={e=>{e.preventDefault();void saveName();}}>
          <input autoFocus maxLength={80} value={newName} onChange={e=>setNewName(e.target.value)}/>
          <button type="submit" aria-label="Save project name"><Check size={17}/></button></form>:
          <button className="mv-project-name-button" title={project!.name+" · Rename project"} aria-label={"Rename project "+project!.name} onClick={()=>setEditingName(true)}><Pencil size={17}/><span>{project!.name}</span></button>}</div>
      <div className="mv-top-actions"><span role="status" className="mv-status">{status}</span>
        <button className="mv-primary mv-export-button" type="button" aria-label="Export MP4" title="Export MP4" disabled={importing||!clips.length} onClick={()=>void exportMp4()}><Download size={17}/><span>{exporting?"Exporting…":"Export"}</span></button></div>
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
        <span className="mv-clock">{time(progress.positionMs,true)} / {time(timelineEnd,true)}</span>
        <div className="mv-progress-wrap">
          <div className="mv-progress-rail" aria-hidden="true"><span style={{width:progress.percent+"%"}}/></div>
          <input className="mv-progress" aria-label="Seek timeline" aria-valuetext={time(progress.positionMs,true)} type="range" min={0} max={Math.max(1,timelineEnd)} step="1" disabled={timelineEnd===0} value={progress.positionMs} onChange={e=>seek(Number(e.target.value))}/>
        </div>
        <button title="Song is the only audio track" aria-label="Song audio only"><Volume2 size={19}/></button>
        <button aria-label="Fullscreen" onClick={()=>{const box=document.querySelector(".mv-video-box");void box?.requestFullscreen?.();}}><Maximize size={19}/></button>
      </div>
    </section>
    <section className="mv-timeline" aria-label="Timeline editor">
      <div className="mv-timeline-toolbar">
        <div><button aria-label="Undo" disabled={!past.current.length} onClick={undo}><Undo2 size={17}/></button>
          <button aria-label="Redo" disabled={!future.current.length} onClick={redo}><Redo2 size={17}/></button>
          <button onClick={split} disabled={importing||!selectedClip||playhead-selectedClip.timelineStartMs<100||clipEnd(selectedClip)-playhead<100} title="Split selected video at playhead"><Scissors size={15}/> Split video</button>
          <button className="mv-split-song" onClick={splitSong} disabled={importing||!splitSongPart(songRange,songParts,playhead)} title="Split song at playhead"><Scissors size={15}/> Split song</button>
          <button onClick={songSelected?removeSongPart:deleteClip} disabled={importing||(songSelected?(!songParts||songParts.length<2):!selectedClip)}><Trash2 size={17}/> Delete</button>
          {selectedAsset?.role==="lip-sync"&&selectedAsset.sourceStartMs!==null&&selectedAsset.sourceEndMs!==null&&<button onClick={toggleLock}>{selectedClip?.syncLocked?<Lock size={16}/>:<Unlock size={16}/>} Sync</button>}
          {selectedClip&&<button title="Move clip to the other video track at the same time" disabled={importing} onClick={switchVideoTrack}>Switch track</button>}</div>
        <div className="mv-timeline-zoom">
          <form className="mv-marker-time" onSubmit={e=>{e.preventDefault();submitMarker();}}>
            <label>Playhead <input aria-label="Playhead timeline time" value={markerText} onFocus={stopPlayback} onChange={e=>setMarkerText(e.target.value)}/></label>
            <button type="submit" onPointerDown={e=>e.preventDefault()} title="Go to exact time" aria-label="Go to exact time"><Check size={15}/></button>
          </form>
          <label><input type="checkbox" checked={snap} onChange={e=>setSnap(e.target.checked)}/> Snap</label>
          <div className="mv-zoom-buttons" role="group" aria-label="Timeline zoom">
            <span><ZoomIn size={14}/> Zoom</span>
            <button type="button" aria-label="Zoom out timeline" title="Zoom out timeline" disabled={zoom<=20} onClick={()=>setZoom(z=>Math.max(20,z-12))}><Minus size={17}/></button>
            <output aria-label="Timeline zoom level">{(zoom/44).toFixed(1)}×</output>
            <button type="button" aria-label="Zoom in timeline" title="Zoom in timeline" disabled={zoom>=140} onClick={()=>setZoom(z=>Math.min(140,z+12))}><Plus size={17}/></button>
          </div></div>
      </div>
      <div className="mv-tracks">
        <div className="mv-track-labels">
          <div className="mv-label mv-ruler-spacer"/>
          {([2,1] as Track[]).map(track=><div className={"mv-label"+(track===1?" mv-main-label":"")} key={track} title={track===1?"Lip Sync · Main video track":"Video 2 · Overlay"}>
            {track===1?<Music2 size={18}/>:<Film size={18}/>}<strong>{track===1?"Lip Sync":"Video 2"}</strong>
          </div>)}
          <div className="mv-label mv-audio-label" title="Song audio"><Volume2 size={18}/><strong>Song</strong><Scissors size={15}/></div>
        </div>
        <div className="mv-scroll" ref={scroll}>
          <div className="mv-track-area" ref={trackArea} style={{width:pixels}}>
            <div className="mv-ruler" onPointerDown={e=>scrubMarker(e)} onPointerMove={updateMarker} onPointerUp={e=>releaseMarker(e)} onPointerCancel={e=>releaseMarker(e,true)} onLostPointerCapture={e=>releaseMarker(e,true)}>
              {ticks.map(t=><span key={t} style={{left:t/1000*zoom}}>{time(t)}</span>)}
            </div>
            {([2,1] as Track[]).map(track=><div className={"mv-lane"+(track===1?" mv-main-lane":"")+(dragTrack===track?(dragBlocked?" is-drop-blocked":" is-drop-target"):"")} key={track} ref={el=>{videoLanes.current[track]=el;}} onDragOver={e=>e.preventDefault()} onDrop={e=>onDrop(e,track)}>
              {clips.filter(c=>c.track===track).map(c=>{
                const a=byId.get(c.assetId);if(!a)return null;
                return <div key={c.id} className={"mv-clip"+(selected===c.id?" is-selected":"")+(c.syncLocked?" is-locked":"")+(armedMedia===c.id?" is-armed":"")}
                    style={{left:c.timelineStartMs/1000*zoom,width:(c.sourceOutMs-c.sourceInMs)/1000*zoom}}
                    tabIndex={0} aria-label={"Select video "+a.name}
                    onKeyDown={e=>{if(e.target===e.currentTarget&&(e.key==="Enter"||e.key===" ")){e.preventDefault();selectVideo(c.id);}}}
                    onContextMenu={e=>e.preventDefault()}
                    onPointerDown={e=>{if(!(e.target as HTMLElement).closest(".mv-handle"))beginMediaGesture(e,c.id,()=>movePointer(e,c,"move"),()=>selectVideo(c.id));}}
                    title={a.name+" · "+time(c.timelineStartMs,true)}>
                  <button type="button" className="mv-handle mv-handle-start" aria-label="Trim clip start" title="Hold to trim or extend start" onPointerDown={e=>beginMediaGesture(e,c.id,()=>movePointer(e,c,"start"),()=>selectVideo(c.id),true)} onKeyDown={e=>keyboardTrim(e,c,"start")}>Ⅱ</button>
                  <span className="mv-clip-title">{a.role==="lip-sync"?"🎤 ":"🎬 "}{a.name}</span>
                  {c.syncLocked&&<Lock className="mv-clip-lock" size={13}/>}
                  <button type="button" className="mv-handle mv-handle-end" aria-label="Trim clip end" title="Hold to trim or extend end" onPointerDown={e=>beginMediaGesture(e,c.id,()=>movePointer(e,c,"end"),()=>selectVideo(c.id),true)} onKeyDown={e=>keyboardTrim(e,c,"end")}>Ⅱ</button>
                </div>;
              })}
            </div>)}
            <div className="mv-song-lane" onPointerDown={e=>{if(e.target===e.currentTarget)seek(msFromX(e.clientX-e.currentTarget.getBoundingClientRect().left));}}>
              {songParts===null?<><div className={"mv-song-block"+(songSelected?" is-selected":"")+(armedMedia==="song"?" is-armed":"")} role="button" tabIndex={0} aria-label="Select song" aria-pressed={songSelected} title="Tap to select song; hold to move; swipe to scroll"
                style={{left:songRange.positionMs/1000*zoom,width:(songRange.endMs-songRange.startMs)/1000*zoom}}
                onContextMenu={e=>e.preventDefault()} onPointerDown={e=>beginMediaGesture(e,"song",()=>dragSong(e),selectSong)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();selectSong();return;}if(e.key!=="ArrowLeft"&&e.key!=="ArrowRight")return;e.preventDefault();selectSong();const r=rangeRef.current;
                  commitSongRange(r,Math.max(0,r.positionMs+(e.key==="ArrowLeft"?-1:1)*(e.shiftKey?100:1)));}}>
                <div className="mv-wave" style={{width:project!.songDurationMs/1000*zoom,left:-songRange.startMs/1000*zoom}}>{(wave.length?wave:Array.from({length:180},()=>0.22)).map((v,i)=>
                  <span key={i} style={{height:Math.max(5,Math.min(100,v*100))+"%"}}/>)}</div>
              </div>
              {(["start","end"] as const).map(edge=><button type="button" key={edge} className={"mv-song-handle "+edge+(songSelected?" is-selected":"")+(armedMedia==="song"?" is-armed":"")}
                style={{left:(edge==="start"?songRange.positionMs:songTimelineEnd(songRange))/1000*zoom}}
                aria-label={"Trim song "+edge} title={time(edge==="start"?songRange.startMs:songRange.endMs,true)}
                onContextMenu={e=>e.preventDefault()} onPointerDown={e=>beginMediaGesture(e,"song",()=>dragSongEdge(e,edge),selectSong,true)}
                onKeyDown={e=>{if(e.key!=="ArrowLeft"&&e.key!=="ArrowRight")return;e.preventDefault();selectSong();const range=rangeRef.current;
                  commitSongRange(moveSongEdge(range,edge,(edge==="start"?range.startMs:range.endMs)+(e.key==="ArrowLeft"?-1:1)*(e.shiftKey?100:1),project!.songDurationMs));}}>Ⅱ</button>)}</>:currentParts.map((p,i)=><div key={i} className={"mv-song-block mv-song-part"+(songSelected&&i===Math.min(partIndex,currentParts.length-1)?" is-selected":"")+(armedMedia==="song-part-"+i?" is-armed":"")} role="button" tabIndex={0} aria-label={"Select song part "+(i+1)} aria-pressed={songSelected&&i===Math.min(partIndex,currentParts.length-1)} style={{left:songTimeToTimeline(p.startMs,songRange)/1000*zoom,width:(p.endMs-p.startMs)/1000*zoom}} onContextMenu={e=>e.preventDefault()} onPointerDown={e=>{if(!(e.target as HTMLElement).closest(".mv-part-edge"))beginMediaGesture(e,"song-part-"+i,()=>{selectPart(i);dragSong(e);},()=>selectPart(i));}} onKeyDown={e=>{if(e.target===e.currentTarget&&(e.key==="Enter"||e.key===" ")){e.preventDefault();selectPart(i);}}}>
                <div className="mv-wave" style={{width:project!.songDurationMs/1000*zoom,left:-p.startMs/1000*zoom}}>{(wave.length?wave:Array.from({length:180},()=>0.22)).map((v,j)=><span key={j} style={{height:Math.max(5,Math.min(100,v*100))+"%"}}/>)}</div>
                <span className="mv-song-part-number">{i+1}</span>
                {songSelected&&i===Math.min(partIndex,currentParts.length-1)&&(["start","end"] as const).map(edge=><button key={edge} type="button" className={"mv-song-handle is-selected mv-part-edge "+edge} aria-label={"Trim song part "+edge} onPointerDown={e=>beginMediaGesture(e,"song-part-"+i,()=>trimPartEdge(e,i,edge),()=>selectPart(i),true)} onKeyDown={e=>{if(e.key!=="ArrowLeft"&&e.key!=="ArrowRight")return;e.preventDefault();e.stopPropagation();const d=(e.key==="ArrowLeft"?-1:1)*(e.shiftKey?100:1);editPart(edge==="start"?p.startMs+d:p.startMs,edge==="end"?p.endMs+d:p.endMs);}}>Ⅱ</button>)}
              </div>)}
            </div>
            <div className={"mv-playhead"+(scrubbing?" is-scrubbing":"")} style={{left:progress.positionMs/1000*zoom}}>
              <button type="button" className="mv-playhead-grip" role="slider" aria-label="Move playhead" aria-valuemin={0} aria-valuemax={timelineEnd} aria-valuenow={Math.round(playhead)} aria-valuetext={time(playhead,true)} title={"Drag playhead · "+time(playhead,true)}
                onPointerDown={e=>scrubMarker(e,true)} onPointerMove={updateMarker} onPointerUp={releaseMarker} onPointerCancel={e=>releaseMarker(e,true)} onLostPointerCapture={e=>releaseMarker(e,true)} onKeyDown={markerKey}/>
            </div>
          </div>
        </div>
        <div className="mv-track-adds" aria-label="Add videos">
          <div className="mv-add-spacer"/>
          {([2,1] as Track[]).map(track=><div className="mv-track-add-row" key={track}>
            <button type="button" className="mv-track-add-button" aria-label={"Add video to track "+track} aria-expanded={addMenu===track} title={track===1?"Add to Lip Sync / Main":"Add to Video 2"} onClick={()=>setAddMenu(addMenu===track?null:track)}><Plus size={15}/></button>
            {addMenu===track&&<div className="mv-add-menu">
              <button disabled={importing} onClick={()=>void openLipSync(track)}><Music2 size={15}/> Insert Lip Sync</button>
              <button disabled={importing} onClick={()=>{setUploadTrack(track);fileInput.current?.click();setAddMenu(null);}}><Upload size={15}/> Upload own video</button>
              <button onClick={()=>{setLibraryOpen(true);setAddMenu(null);}}><FolderOpen size={15}/> Library</button>
              <button disabled title="AI video generation will be added later"><Plus size={15}/> Generate · Soon</button>
            </div>}
          </div>)}
          <div className="mv-track-add-row mv-track-add-audio" aria-hidden="true"/>
        </div>
      </div>
      <button type="button" className="mv-inspector-toggle" aria-expanded={inspectorOpen} onClick={()=>setInspectorOpen(v=>!v)}>{songSelected?<Music2 size={16}/>:<Film size={16}/>}<span>{songSelected?(songParts?"Song part "+(Math.min(partIndex,currentParts.length-1)+1):"Song"):(selectedAsset?.name||"Video")}</span>{inspectorOpen?<ChevronDown size={16}/>:<ChevronRight size={16}/>}</button>
      <div className="mv-inspector-body" hidden={!inspectorOpen}>
      {!songSelected&&selectedClip&&selectedAsset?<form className="mv-song-trim mv-clip-position" onSubmit={e=>{e.preventDefault();if(clipEditKind.current==="end")submitClipEnd();else submitClipTime();}}>
        <strong><Film size={16}/> {selectedClip.track===1?"Lip Sync / Main":"Video 2"}: {selectedAsset.name}</strong>
        <label>Song start time<input aria-label="Video start time in original song" value={clipSongText} onChange={e=>updateClipTime(e.target.value,"song")} placeholder="00:08.918"/></label>
        <label>Timeline start<input aria-label="Video start time on timeline" value={clipTimelineText} onChange={e=>updateClipTime(e.target.value,"timeline")} placeholder="00:08.918"/></label>
        <button type="button" className="mv-primary" disabled={importing} onClick={submitClipTime}>Move video</button>
        <label>Song end time<input aria-label="Video end time in original song" value={clipSongEndText} onChange={e=>updateClipEnd(e.target.value,"song")} placeholder="00:18.918"/></label>
        <label>Timeline end<input aria-label="Video end time on timeline" value={clipEndText} onChange={e=>updateClipEnd(e.target.value,"timeline")} placeholder="00:18.918"/></label>
        <button type="button" className="mv-outline" disabled={importing} onClick={submitClipEnd}>Set end</button>
        <button type="submit" hidden tabIndex={-1} aria-hidden="true">Apply</button>
        {originalClipSongTime!==null&&<button type="button" className="mv-outline" disabled={importing} onClick={()=>moveSelectedClip(songTimeToTimeline(originalClipSongTime,rangeRef.current),true)}><Lock size={14}/> Restore Lip Sync · {time(originalClipSongTime,true)}</button>}
        <span>Duration <b>{time(selectedClip.sourceOutMs-selectedClip.sourceInMs,true)}</b></span>
        <button type="button" className="mv-outline" disabled={importing} onClick={switchVideoTrack}>{selectedClip.track===1?"Move to Video 2":"Move to Lip Sync / Main"}</button>
        <small>Swipe to scroll; hold a clip or handle to edit. Drag the middle between tracks. Song start refers to the original recording; timeline start follows the actual project timeline. Enter MM:SS.mmm or seconds. Clips only move if the full interval is free on this track.{selectedClip.syncLocked?" Sync Lock is enabled.":""}</small>
      </form>:
      <form className="mv-song-trim mv-song-position" onSubmit={e=>{e.preventDefault();submitSongRange();}}>
        <strong><Scissors size={16}/> {songParts?"Song part "+(Math.min(partIndex,currentParts.length-1)+1)+" / "+currentParts.length:"Song trim"}</strong>
        {songParts?<><label>Part source start<input aria-label="Song part start" value={partStartText} onChange={e=>setPartStartText(e.target.value)}/></label><label>Part source end<input aria-label="Song part end" value={partEndText} onChange={e=>setPartEndText(e.target.value)}/></label><button type="button" className="mv-outline" disabled={importing} onClick={()=>{const start=parseSongTime(partStartText),end=parseSongTime(partEndText);if(start===null||end===null){setError("Enter valid song times.");return;}editPart(start,end);}}>Set part</button><button type="button" className="mv-outline" disabled={importing||songParts.length<2} onClick={removeSongPart}><Trash2 size={14}/> Remove part</button><button type="button" className="mv-outline" disabled={importing} onClick={resetSongParts}>Reset splits</button></>:<><label>Source start<input aria-label="Song start time" value={startText} onChange={e=>setStartText(e.target.value)} placeholder="00:08.918"/></label>
        <label>Source end<input aria-label="Song end time" value={endText} onChange={e=>setEndText(e.target.value)} placeholder="00:30.000"/></label></>}
        <label>{songParts?"Song group position":"Timeline position"}<input aria-label="Song timeline position" value={positionText} onChange={e=>setPositionText(e.target.value)} placeholder="00:08.918"/></label>
        <button type="submit" className="mv-outline" disabled={importing}>Apply</button>
        <button type="button" className="mv-outline" disabled={importing||!!songParts} onClick={()=>commitSongRange({startMs:0,endMs:project!.songDurationMs},0)}>Reset</button>
        <span>Duration <b>{time(selectedPart.endMs-selectedPart.startMs,true)}</b></span>
        <button type="button" className="mv-outline" disabled={importing||!trimSongAtPlayhead({...selectedPart,positionMs:songTimeToTimeline(selectedPart.startMs,songRange)},playhead,"start")} onClick={()=>cutSong("start")}><Scissors size={14}/> Trim start at playhead</button>
        <button type="button" className="mv-outline" disabled={importing||!trimSongAtPlayhead({...selectedPart,positionMs:songTimeToTimeline(selectedPart.startMs,songRange)},playhead,"end")} onClick={()=>cutSong("end")}><Scissors size={14}/> Trim end at playhead</button>
        <small>Swipe to scroll; hold the song to move all parts together. Split or trim at the playhead; removing a part leaves silence, preserving lip sync. Enter MM:SS.mmm or seconds.</small>
      </form>}
      </div>
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
        {roleError&&<p className="mv-error" role="alert">{roleError}</p>}
        <p className="mv-role-hint">Choose each video’s role. Lip Sync defaults to the main track; B-Roll to the upper track. Changing role keeps existing clip positions; B-Roll releases Sync Lock. Original source times are preserved.</p>
        <div className="mv-library-tools"><div className="mv-filter">{(["All","Lip Sync","B-Roll","AI Video","Uploads"] as const).map(f=>
          <button key={f} className={filter===f?"active":""} onClick={()=>setFilter(f)}>{f}</button>)}</div>
          <div className="mv-library-search"><Search size={16}/><input placeholder="Search library…" aria-label="Search media" value={search} onChange={e=>setSearch(e.target.value)}/></div>
          <button className="mv-outline" disabled={importing} onClick={()=>{setUploadTrack(null);fileInput.current?.click();}}><Upload size={16}/> Upload video</button>
        </div>
        {media.length?<div className="mv-media-grid">{media.map(a=><article key={a.id} className="mv-media-card"
          draggable onDragStart={e=>e.dataTransfer.setData("application/x-mvasset",a.id)}>
          <div className="mv-media-image"><Film size={32}/><span>{time(a.durationMs)}</span></div>
          <div className="mv-media-info">
            <strong title={a.name}>{a.name}</strong>
            <small>{a.sourceKind==="live"?"SingMotion":a.sourceKind==="uploaded"?"Uploaded video":"Generated video"}</small>
            <div className="mv-media-role" role="group" aria-label={"Role of "+a.name}>
              <button type="button" className={a.role==="lip-sync"?"active":""} aria-pressed={a.role==="lip-sync"} disabled={importing} onClick={()=>void changeAssetRole(a,"lip-sync")}><Music2 size={13}/> Lip Sync</button>
              <button type="button" className={a.role==="b-roll"?"active":""} aria-pressed={a.role==="b-roll"} disabled={importing} onClick={()=>void changeAssetRole(a,"b-roll")}><Film size={13}/> B-Roll</button>
            </div>
            {roleChanging===a.id?<small role="status">Saving role…</small>:a.sourceStartMs!==null&&a.sourceEndMs!==null?<small className="mv-source-time">Source: {time(a.sourceStartMs,true)} – {time(a.sourceEndMs,true)}</small>:a.role==="lip-sync"?<small>Set song time manually on the timeline.</small>:null}
            <div className="mv-media-actions"><button disabled={importing} onClick={()=>addClip(a,a.role==="lip-sync"?1:2,playhead)}><Plus size={14}/> Add to timeline</button>
              <details><summary aria-label={"Options for "+a.name}><MoreHorizontal size={17}/></summary>
                <div><button onClick={()=>addClip(a,1,playhead)}>Add to Lip Sync / Main</button><button onClick={()=>addClip(a,2,playhead)}>Add to Video 2</button><button onClick={()=>void deleteAsset(a)}>Remove from Library</button></div>
              </details></div>
          </div></article>)}</div>:<p className="mv-empty-library">No videos in this Library. Import a video or use Add to Project from Videos.</p>}
      </div>}
    </section>
    {exportJob?.state==="ready"&&!exportOpen&&<div className="mv-export-toast" role="status"><Check size={20}/><div><strong>MP4 ready{exportJob.resolution?" · "+exportJob.resolution.height+"p":""}</strong><small>Download requested. <a href={endpoint+id+"/export/"+exportJob.id+"?download=1"} download>Download again</a></small></div><button type="button" aria-label="Dismiss export notice" onClick={()=>setExportJob(null)}><X size={17}/></button></div>}
    {exportOpen&&<div className="mv-dialog-backdrop"><div className="mv-dialog mv-export-dialog" role="dialog" aria-modal="true" aria-label="Export MP4"><div className="mv-export-symbol"><Download size={32}/></div><h2>{exportError?"Export failed":"Exporting your video…"}</h2><p>{exportError||(exportJob?.resolution?"Preparing "+exportJob.resolution.height+"p MP4 for download.":"Checking source resolution…")}</p>{!exportError&&<><div className="mv-export-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={exportJob?.progress??0}><span style={{width:(exportJob?.progress??0)+"%"}}/></div><strong>{exportJob?.progress??0}%</strong></>}{!exporting&&<button className="mv-outline" onClick={()=>setExportOpen(false)}>Close</button>}</div></div>}
    {lipTrack!==null&&<div className="mv-dialog-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget&&!importing)setLipTrack(null);}}>
      <div className="mv-dialog mv-lip-dialog" role="dialog" aria-modal="true" aria-label="Insert Lip Sync">
        <h2>Insert Lip Sync · {lipTrack===1?"Main track":"Video 2"}</h2>
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
