"use client";
import {PROJECT_VIDEO_MAX_BYTES,PROJECT_VIDEO_MAX_MIB} from "../lib/music-video/media-limits";
import {memo,useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from "react";
import Link from "next/link";
import {ChevronDown,ChevronRight,Check,Clock3,Film,Lock,Unlock,Video,Mic,
  Maximize,Minus,MoreHorizontal,Music2,Pause,Pencil,Play,Plus,Redo2,Scissors,
  Search,Trash2,Undo2,Upload,Download,X,Volume2,VolumeX,RefreshCw,ArrowUpDown} from "lucide-react";
import {ensureSession} from "@/lib/client";
import type {MusicAsset,MusicClip,MusicProject,Track,MediaRole,AudioTrack,TrackMutes,ProjectAspectRatio} from "@/lib/music-video/core";
import {parseSongTime,validSongRange,moveSongEdge,validSongPlacement,trimSongPlacement,shiftLockedClips,songOffset,songTimelineEnd,MAX_TIMELINE_MS,songTimeToTimeline,timelineToSongTime,parseRelativeSongTime,positionVideoClip,trimVideoClip,transferVideoClip,splitVideoAtPlayhead,snapPlayhead,timelineProgress,setVideoEnd,MEDIA_HOLD_MS,mediaPanAxis,effectiveSongParts,validSongParts,splitSongPart,songPartAt,songPartsEnd,continuousSongParts,clipSourceTimeMs,mediaSyncDecision,mobileVideoSyncDecision,pictureSyncGate,hasPreviewBuffer,PREVIEW_LOOKAHEAD_MS,songOwnsPreviewClock,previewMediaPlan,nextVisibleClipTransition,publishedPlaybackMs,nativeClipClockStep,nativeClockAction,firstVisibleVideo,aspectFromDimensions,type SongRange,type SongPlacement} from "@/lib/music-video/song-range";
import "./music-video.css";

type LipSyncSource={id:string;name:string;durationMs:number;sourceStartMs:number;sourceEndMs:number};
type EditSnapshot={clips:MusicClip[];range:SongPlacement;parts:SongRange[]|null;mutes:TrackMutes;aspectRatio:ProjectAspectRatio};
const initialMutes:TrackMutes={1:true,2:true,song:false};
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
function InlineTimeField({label,ariaLabel,value,onChange,onConfirm,disabled,placeholder}:{label:string;ariaLabel:string;value:string;onChange:(value:string)=>void;onConfirm:()=>void;disabled:boolean;placeholder?:string}){
  return <div className="mv-inline-time">
    <label>{label}<input aria-label={ariaLabel} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();if(!disabled)onConfirm();}}}/></label>
    <button type="button" className="mv-inline-confirm" disabled={disabled} title={"Confirm "+label.toLowerCase()} aria-label={"Confirm "+ariaLabel.toLowerCase()} onClick={onConfirm}><Check size={15}/></button>
  </div>;
}
const SongWaveform=memo(function SongWaveform({peaks,width,left}:{peaks:number[];width:number;left:number}){
  const bars=peaks.length?peaks:Array.from({length:180},()=>0.22);
  return <div className="mv-wave" style={{width,left}}>{bars.map((v,i)=><span key={i} style={{height:Math.max(5,Math.min(100,v*100))+"%"}}/>)}</div>;
});
export function MusicVideoEditor({id}:{id:string}){
  const [detail,setDetail]=useState<Detail|null>(null),[clips,setClips]=useState<MusicClip[]>([]);
  const [aspectRatio,setAspectRatio]=useState<ProjectAspectRatio>("auto"),ratioRef=useRef<ProjectAspectRatio>("auto");
  const [autoFormat,setAutoFormat]=useState<{assetId:string;ratio:"9:16"|"16:9"}|null>(null);
  const [trackMutes,setTrackMutes]=useState<TrackMutes>(initialMutes),mutesRef=useRef<TrackMutes>(initialMutes);
  const trackAudio1=useRef<HTMLAudioElement>(null),trackAudio2=useRef<HTMLAudioElement>(null);
  const mutedClockRef=useRef<{element:HTMLMediaElement;clipId:string;aligned:boolean;pending:boolean;lastAttempt:number}|null>(null);
  const [mobile,setMobile]=useState<boolean|null>(null),mobileRef=useRef(false);
  const [mobileReady,setMobileReady]=useState<Set<string>>(()=>new Set());
  const mobileReadyRef=useRef<Set<string>>(new Set());
  const [mobileUnavailable,setMobileUnavailable]=useState<Set<string>>(()=>new Set());
  const [mobileRetry,setMobileRetry]=useState(0);
  const mobileFailures=useRef(new Map<string,number>());
  const mobileUnavailableRef=useRef(new Set<string>());
  const mobileOriginalRef=useRef(new Set<string>());
  const mobilePrepareAttempts=useRef(new Map<string,number>());
  const [previewVolume,setPreviewVolume]=useState(100);
  const volumeRef=useRef(100);
  const [volumePopup,setVolumePopup]=useState<{left:number;top:number}|null>(null);
  const volumePanel=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!volumePopup)return;
    const close=(e:PointerEvent)=>{if(e.target instanceof Element&&!volumePanel.current?.contains(e.target)&&!e.target.closest("[data-volume-anchor]"))setVolumePopup(null);};
    const key=(e:KeyboardEvent)=>{if(e.key==="Escape"){setVolumePopup(null);document.querySelector<HTMLButtonElement>('[data-volume-anchor="player"]')?.focus();}};
    const resize=()=>setVolumePopup(null);
    document.addEventListener("pointerdown",close,true);document.addEventListener("keydown",key);
    window.addEventListener("resize",resize);
    return()=>{document.removeEventListener("pointerdown",close,true);document.removeEventListener("keydown",key);window.removeEventListener("resize",resize);};
  },[volumePopup]);
  useEffect(()=>{const value=window.matchMedia("(pointer: coarse)").matches||/iPhone|iPad|Android|Mobile/i.test(navigator.userAgent);mobileRef.current=value;setMobile(value);},[]);
  const lastFollowerSeek=useRef(new WeakMap<HTMLMediaElement,number>());
  const followerPlayPending=useRef(new WeakSet<HTMLMediaElement>());
  const songPlayPending=useRef(false),syncHold=useRef<number|null>(null);
  const [buffering,setBuffering]=useState(false);
  const previewBox=useRef<HTMLDivElement>(null);
  const [songParts,setSongParts]=useState<SongRange[]|null>(null),partsRef=useRef<SongRange[]|null>(null);
  const [partIndex,setPartIndex]=useState(0),[partStartText,setPartStartText]=useState(""),[partEndText,setPartEndText]=useState("");
  const [songRange,setSongRange]=useState<SongPlacement>({startMs:0,endMs:0,positionMs:0});
  const [startText,setStartText]=useState("00:00.000"),[endText,setEndText]=useState("00:00.000");
  const playheadRef=useRef(0),playingRef=useRef(false);
  const rangeRef=useRef<SongPlacement>({startMs:0,endMs:0,positionMs:0});
  const [selected,setSelected]=useState<string|null>(null),[playhead,setPlayhead]=useState(0);
  const [markerText,setMarkerText]=useState("00:00.000"),[scrubbing,setScrubbing]=useState(false);
  const markerDrag=useRef<{pointer:number;offset:number}|null>(null);
  const playheadLine=useRef<HTMLDivElement>(null),playheadGrip=useRef<HTMLButtonElement>(null);
  const viewportRef=useRef({zoom:44,left:0,width:0,scrollLeft:0});
  const previewReadyRef=useRef<Set<string>>(new Set()),playingPreviewRef=useRef<Set<string>>(new Set());
  const [previewReady,setPreviewReady]=useState<Set<string>>(()=>new Set());
  const previewAttempts=useRef(new Map<string,number>());
  const trackArea=useRef<HTMLDivElement>(null);
  const tracksRef=useRef<HTMLDivElement>(null);
  const [rulerViewport,setRulerViewport]=useState({left:0,width:0,scrollLeft:0});
  useEffect(()=>{if(!playingRef.current)setMarkerText(time(playhead,true));},[playhead]);
  const [dragTrack,setDragTrack]=useState<Track|null>(null),[dragBlocked,setDragBlocked]=useState(false);
  const videoLanes=useRef<Partial<Record<Track,HTMLDivElement|null>>>({});
  const [clipSongText,setClipSongText]=useState("00:00.000"),[clipTimelineText,setClipTimelineText]=useState("00:00.000");
  const clipTimeMode=useRef<"song"|"timeline">("song");
  const [clipEndText,setClipEndText]=useState("00:00.000"),[clipSongEndText,setClipSongEndText]=useState("00:00.000");
  const clipEndMode=useRef<"song"|"timeline">("timeline");
  const [armedMedia,setArmedMedia]=useState<string|null>(null);
  const gestureCleanup=useRef<(()=>void)|null>(null);
  useEffect(()=>()=>gestureCleanup.current?.(),[]);
  const [playing,setPlaying]=useState(false),[zoom,setZoom]=useState(44),[snap,setSnap]=useState(true);
  const [libraryOpen,setLibraryOpen]=useState(false),[filter,setFilter]=useState<"All"|"Lip Sync"|"B-Roll"|"AI Video"|"Uploads">("All");
  const [search,setSearch]=useState("");
  const [libraryNewest,setLibraryNewest]=useState(true),[libraryRefreshing,setLibraryRefreshing]=useState(false);
  const [error,setError]=useState(""),[status,setStatus]=useState("Saved");
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
    ratioRef.current=data.project.aspectRatio??"auto";setAspectRatio(ratioRef.current);
    mutesRef.current=data.project.trackMutes??initialMutes;setTrackMutes(mutesRef.current);
    partsRef.current=data.project.songParts;setSongParts(data.project.songParts);setPartIndex(0);
    rangeRef.current=range;setSongRange(range);setStartText(time(range.startMs,true));setEndText(time(range.endMs,true));
    mutedClockRef.current=null;syncHold.current=null;setBuffering(false);playingRef.current=false;setPlaying(false);audio.current?.pause();video.current?.pause();trackAudio1.current?.pause();trackAudio2.current?.pause();
    const at=Math.min(playheadRef.current,songPartsEnd(range,partsRef.current));
    playheadRef.current=at;setPlayhead(at);
    if(audio.current&&audio.current.readyState>=1)audio.current.currentTime=Math.max(range.startMs,Math.min(range.endMs,at-songOffset(range)))/1000;
    setDetail(data);setClips(data.clips);setNewName(data.project.name);setError("");
  },[id]);
  useEffect(()=>{void load().catch(e=>setError(e instanceof Error?e.message:"Project unavailable."));},[load]);
  useEffect(()=>{
    const opened=()=>document.querySelectorAll<HTMLDetailsElement>('.mv-editor .mv-media-actions details[open]');
    const outside=(event:Event)=>{
      const target=event.target;
      if(!(target instanceof Node))return;
      opened().forEach(menu=>{if(!menu.contains(target))menu.open=false;});
    };
    const escape=(event:KeyboardEvent)=>{
      if(event.key!=="Escape")return;
      opened().forEach(menu=>{const focused=menu.contains(document.activeElement);menu.open=false;if(focused)menu.querySelector("summary")?.focus();});
    };
    document.addEventListener("pointerdown",outside,true);
    document.addEventListener("click",outside,true);
    document.addEventListener("keydown",escape);
    return()=>{document.removeEventListener("pointerdown",outside,true);document.removeEventListener("click",outside,true);document.removeEventListener("keydown",escape);};
  },[]);

  // Fetch only 240 precomputed peaks; never download/decode the song twice.
  useEffect(()=>{
    if(!detail?.project.id)return;
    const controller=new AbortController();
    void request<{peaks:number[]}>(endpoint+id+"/waveform",{signal:controller.signal})
      .then(data=>{if(!controller.signal.aborted)setWave(Array.isArray(data.peaks)?data.peaks:[]);})
      .catch(()=>{});
    return()=>controller.abort();
  },[id,detail?.project.id]);
  async function saveNow():Promise<void>{
    if(inFlight.current){await inFlight.current;if(dirty.current)await saveNow();return;}
    if(!dirty.current)return;
    dirty.current=false;
    const snapshot=latest.current,range=rangeRef.current,parts=partsRef.current,mutes=mutesRef.current,ratio=ratioRef.current;
    setStatus("Saving…");
    const task=(async()=>{
      const result=await request<Detail>(endpoint+id+"/clips",{method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({revision:revision.current,clips:snapshot,songStartMs:range.startMs,songEndMs:range.endMs,songPositionMs:range.positionMs,songParts:parts,trackMutes:mutes,aspectRatio:ratio})});
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
  function apply(next:MusicClip[],record=true,range=rangeRef.current,parts=partsRef.current,mutes=mutesRef.current,ratio=ratioRef.current){
    if(roleBusy.current)return;
    if(record){past.current.push({clips:latest.current,range:rangeRef.current,parts:partsRef.current,mutes:mutesRef.current,aspectRatio:ratioRef.current});if(past.current.length>40)past.current.shift();future.current=[];}
    const changed=range.startMs!==rangeRef.current.startMs||range.endMs!==rangeRef.current.endMs||range.positionMs!==rangeRef.current.positionMs;
    ratioRef.current=ratio;setAspectRatio(ratio);
    mutesRef.current=mutes;setTrackMutes(mutes);
    const partsChanged=parts!==partsRef.current;
    partsRef.current=parts;setSongParts(parts);
    rangeRef.current=range;
    if(changed)displaySong(range);
    const at=timelineProgress(playheadRef.current,songPartsEnd(range,parts)).positionMs;
    if(changed||partsChanged||at!==Math.round(playheadRef.current)){stopPlayback();setAt(at,range);}
    latest.current=next;setClips(next);setError("");queue();
  }
  function undo(){
    if(roleBusy.current)return;
    const previous=past.current.pop();if(!previous)return;
    future.current.push({clips:latest.current,range:rangeRef.current,parts:partsRef.current,mutes:mutesRef.current,aspectRatio:ratioRef.current});apply(previous.clips,false,previous.range,previous.parts,previous.mutes,previous.aspectRatio);
  }
  function redo(){
    if(roleBusy.current)return;
    const next=future.current.pop();if(!next)return;
    past.current.push({clips:latest.current,range:rangeRef.current,parts:partsRef.current,mutes:mutesRef.current,aspectRatio:ratioRef.current});apply(next.clips,false,next.range,next.parts,next.mutes,next.aspectRatio);
  }
  function toggleTrackMute(track:AudioTrack){
    if(importBusy.current||roleBusy.current)return;
    apply(latest.current,true,rangeRef.current,partsRef.current,{...mutesRef.current,[track]:!mutesRef.current[track]});
  }
  function applyPreviewVolume(element:HTMLMediaElement|null){
    if(!element)return;
    const gain=volumeRef.current/100;
    if(element.volume!==gain){try{element.volume=gain;}catch{}}
  }
  function changePreviewVolume(value:number){
    const next=Math.max(0,Math.min(100,value));volumeRef.current=next;setPreviewVolume(next);
    applyPreviewVolume(audio.current);applyPreviewVolume(video.current);
    applyPreviewVolume(trackAudio1.current);applyPreviewVolume(trackAudio2.current);
  }
  function muteButton(track:AudioTrack,name:string){
    const muted=trackMutes[track],label=(muted?"Unmute ":"Mute ")+name;
    return <button type="button" className={"mv-track-mute"+(muted?" is-muted":"")} aria-label={label} title={label} aria-pressed={muted} disabled={importing} onClick={()=>toggleTrackMute(track)}>{muted?<VolumeX size={15}/>:<Volume2 size={15}/>}</button>;
  }
  function playerVolumeButton(){
    return <button type="button" className={"mv-player-volume"+(previewVolume===0?" is-muted":"")} aria-label="Preview volume" title="Preview volume" aria-expanded={!!volumePopup} aria-controls={volumePopup?"mv-preview-volume-panel":undefined} data-volume-anchor="player" disabled={importing} onClick={e=>{
      if(volumePopup){setVolumePopup(null);return;}
      const r=e.currentTarget.getBoundingClientRect();
      const above=r.top-142,below=r.bottom+6;
      setVolumePopup({left:Math.max(8,Math.min(window.innerWidth-52,r.left+r.width/2-22)),top:Math.max(8,Math.min(window.innerHeight-144,above>=8?above:below))});
    }}>{previewVolume===0?<VolumeX size={19}/>:<Volume2 size={19}/>}</button>;
  }
  function displaySong(range:SongPlacement){
    setSongRange(range);setStartText(time(range.startMs,true));setEndText(time(range.endMs,true));
  }
  function commitSongRange(range:SongRange,position?:number){
    if(roleBusy.current)return;
    if(!project||!validSongRange(range.startMs,range.endMs,project.songDurationMs)){displaySong(rangeRef.current);setError("Choose a valid song range of at least 100 ms.");return;}
    const original=rangeRef.current;
    const next=position===undefined?trimSongPlacement(original,range):{...range,positionMs:position};
    if(!validSongPlacement(next,project.songDurationMs)||songTimelineEnd(next)>songPlacementLimit){displaySong(original);setClips(latest.current);setError("Song position is outside the timeline.");return;}
    if(partsRef.current&&!validSongParts(partsRef.current,next)){displaySong(original);setClips(latest.current);setError("Edit the individual song parts or use Reset song first.");return;}
    const moved=shiftLockedClips(latest.current,songOffset(next)-songOffset(original));
    if(!moved){displaySong(original);setClips(latest.current);setError("Cannot move the song: a sync-locked video would overlap another clip or leave the timeline. Unlock or move the conflicting video first.");return;}
    displaySong(next);setClips(moved);
    if(next.startMs!==original.startMs||next.endMs!==original.endMs||next.positionMs!==original.positionMs)
      apply(moved,true,next);
  }
  function submitSongField(field:"start"|"end"){
    if(importBusy.current||roleBusy.current)return;
    const range=rangeRef.current,parts=partsRef.current;
    const text=field==="start"?(parts?partStartText:startText):(parts?partEndText:endText);
    const ms=parseSongTime(text);
    if(ms===null){setError("Enter seconds or MM:SS.mmm, for example 00:08.918.");return;}
    if(parts){
      const part=parts[Math.min(partIndex,parts.length-1)];if(!part)return;
      editPart(field==="start"?ms:part.startMs,field==="end"?ms:part.endMs);
      return;
    }
    commitSongRange({startMs:field==="start"?ms:range.startMs,endMs:field==="end"?ms:range.endMs});
  }
  // Mouse editing starts immediately. Touch swipes pan the viewport; stationary holds arm editing.
  function beginMediaGesture(e:React.PointerEvent,media:string,onHold:()=>void,onTap:()=>void){
    if(e.button!==0||!e.isPrimary||importBusy.current||gestureCleanup.current)return;
    e.preventDefault();e.stopPropagation();
    if(e.pointerType==="mouse"){setArmedMedia(media);onHold();return;}
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
      position=Math.max(0,Math.min(songPlacementLimit-original.endMs+original.startMs,next));
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
      const candidate=trimSongPlacement(original,range);
      if(songTimelineEnd(candidate)<=songPlacementLimit)displaySong(candidate);
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
  // The grip sits outside the clipped scroll container, but follows its exact coordinates.
  useLayoutEffect(()=>{
    const tracks=tracksRef.current,scroller=scroll.current,area=trackArea.current;
    if(!tracks||!scroller||!area)return;
    const update=()=>{
      const left=scroller.getBoundingClientRect().left-tracks.getBoundingClientRect().left+scroller.clientLeft;
      const width=scroller.clientWidth,scrollLeft=scroller.scrollLeft;
      setRulerViewport(previous=>previous.left===left&&previous.width===width&&previous.scrollLeft===scrollLeft?previous:{left,width,scrollLeft});
    };
    update();
    scroller.addEventListener("scroll",update,{passive:true});
    const observer=new ResizeObserver(update);
    observer.observe(tracks);observer.observe(scroller);observer.observe(area);
    return()=>{scroller.removeEventListener("scroll",update);observer.disconnect();};
  },[project?.id]);
  const byId=useMemo(()=>new Map(assets.map(a=>[a.id,a])),[assets]);
  const timelineEnd=project?songPartsEnd(songRange,songParts):0;
  const timelineLimit=timelineEnd;
  // Source trim can be extended again, but never displays unused source duration.
  const songPlacementLimit=project?Math.min(MAX_TIMELINE_MS,Math.max(project.songDurationMs,songTimelineEnd(rangeRef.current))):0;
  const selectedClip=clips.find(c=>c.id===selected&&c.timelineStartMs<timelineEnd);
  const selectedAsset=selectedClip?byId.get(selectedClip.assetId):null;
  const songSelected=!selectedClip||!selectedAsset;
  function selectSong(){setSelected(null);setInspectorOpen(true);}
  useEffect(()=>{setInspectorOpen(true);},[selected,partIndex]);
  const currentParts=effectiveSongParts(songRange,songParts);
  const selectedPart=currentParts[Math.min(partIndex,currentParts.length-1)];
  useEffect(()=>{setPartStartText(time(selectedPart.startMs,true));setPartEndText(time(selectedPart.endMs,true));},[selectedPart.startMs,selectedPart.endMs]);
  function selectPart(i:number){setPartIndex(i);selectSong();}
  function selectVideo(id:string){setSelected(id);setInspectorOpen(true);}
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
  const selectedStart=selectedClip?.timelineStartMs;
  const selectedId=selectedClip?.id;
  const selectedEnd=selectedClip?clipEnd(selectedClip):undefined;
  const offset=songOffset(songRange);
  useEffect(()=>{
    if(selectedStart===undefined)return;
    setClipSongText(signedTime(selectedStart-offset));setClipTimelineText(time(selectedStart,true));clipTimeMode.current="song";
  },[selectedId,selectedStart,offset]);
  useEffect(()=>{
    if(selectedEnd===undefined)return;
    setClipEndText(time(selectedEnd,true));setClipSongEndText(signedTime(selectedEnd-offset));clipEndMode.current="timeline";
  },[selectedId,selectedEnd,offset]);
  function updateClipEnd(text:string,mode:"song"|"timeline"){
    clipEndMode.current=mode;
    if(mode==="timeline"){
      setClipEndText(text);const ms=parseSongTime(text);
      if(ms!==null)setClipSongEndText(signedTime(timelineToSongTime(ms,rangeRef.current)));
    }else{
      setClipSongEndText(text);const ms=parseRelativeSongTime(text);
      if(ms!==null)setClipEndText(signedTime(songTimeToTimeline(ms,rangeRef.current)));
    }
  }
  function submitClipEnd(mode=clipEndMode.current){
    if(importBusy.current||!selectedClip||!selectedAsset)return;
    const current=latest.current.find(c=>c.id===selectedClip.id);if(!current)return;
    const ms=mode==="song"?parseRelativeSongTime(clipSongEndText):parseSongTime(clipEndText);
    if(ms===null){setError("Enter a valid end time, e.g. 00:08.918.");return;}
    const end=mode==="song"?songTimeToTimeline(ms,rangeRef.current):ms;
    if(end>timelineLimit){setError("The video must end within the song.");return;}
    const next=setVideoEnd(latest.current,current,end,sourceLimit(current,selectedAsset));
    if(!next){setError("The requested end does not fit the available video length or free space on this track. The clip was not changed.");return;}
    commitVideoEdit(current,next);setClipEndText(time(end,true));setClipSongEndText(signedTime(timelineToSongTime(end,rangeRef.current)));setError("");
  }
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
    if(position+current.sourceOutMs-current.sourceInMs>timelineLimit){setError("The video must fit within the song.");return;}
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
  function submitClipTime(mode=clipTimeMode.current){
    const ms=mode==="song"?parseRelativeSongTime(clipSongText):parseSongTime(clipTimelineText);
    if(ms===null){setError("Enter seconds or MM:SS.mmm, for example 00:08.918.");return;}
    moveSelectedClip(mode==="song"?songTimeToTimeline(ms,rangeRef.current):ms);
  }
  const originalClipSongTime=selectedClip&&selectedAsset?.role==="lip-sync"&&selectedAsset.sourceStartMs!==null&&selectedAsset.sourceEndMs!==null&&selectedAsset.sourceStartMs+selectedClip.sourceOutMs<=selectedAsset.sourceEndMs
    ?selectedAsset.sourceStartMs+selectedClip.sourceInMs:null;

  const activeClip=playhead<timelineEnd?clips.filter(c=>playhead>=c.timelineStartMs&&playhead<clipEnd(c)).sort((a,b)=>b.track-a.track)[0]:undefined;
  const activeAsset=activeClip?byId.get(activeClip.assetId):null;
  const firstAssetId=useMemo(()=>firstVisibleVideo(clips.filter(c=>c.timelineStartMs<timelineEnd))?.assetId,[clips,timelineEnd]);
  useEffect(()=>{
    if(aspectRatio!=="auto"||!firstAssetId)return;
    const controller=new AbortController();
    void request<{width:number;height:number}>(endpoint+id+"/format/"+firstAssetId,{signal:controller.signal})
      .then(size=>{if(!controller.signal.aborted)setAutoFormat({assetId:firstAssetId,ratio:aspectFromDimensions(size)});})
      .catch(()=>{if(!controller.signal.aborted)setAutoFormat(null);});
    return()=>controller.abort();
  },[id,firstAssetId,aspectRatio]);
  const previewRatio=aspectRatio==="auto"?(autoFormat?.assetId===firstAssetId?autoFormat?.ratio??"16:9":"16:9"):aspectRatio;
  function changeAspectRatio(ratio:ProjectAspectRatio){
    if(importBusy.current||roleBusy.current||ratio===ratioRef.current)return;
    apply(latest.current,true,rangeRef.current,partsRef.current,mutesRef.current,ratio);
  }
  const previewPlan=previewMediaPlan(playhead<timelineEnd?clips:[],playhead,trackMutes);
  const activeAudio1=previewPlan.audio1,activeAudio2=previewPlan.audio2;
  const readyForPlayback=playing?playingPreviewRef.current:previewReady;
  const mobileSource=(assetId:string)=>endpoint+id+(mobileOriginalRef.current.has(assetId)?"/assets/"+assetId:"/preview/"+assetId+"?mobile=1");
  const source=(a:MusicAsset)=>mobile?mobileSource(a.id):endpoint+id+(readyForPlayback.has(a.id)?"/preview/":"/assets/")+a.id;
  const mediaBoundaries=useMemo(()=>[...new Set(clips.flatMap(c=>[c.timelineStartMs,clipEnd(c)]))].filter(t=>t<timelineEnd).sort((a,b)=>a-b),[clips,timelineEnd]);
  const nextTransition=useMemo(()=>nextVisibleClipTransition(clips,playhead,mediaBoundaries,trackMutes),[clips,playhead,mediaBoundaries,trackMutes]);
  const nextClip=nextTransition?.clip;
  const nextAsset=nextClip?byId.get(nextClip.assetId):undefined;
  const followingTransition=useMemo(()=>nextTransition?nextVisibleClipTransition(clips,nextTransition.atMs,mediaBoundaries,trackMutes):undefined,[clips,nextTransition,mediaBoundaries,trackMutes]);
  const followingAsset=followingTransition?byId.get(followingTransition.clip.assetId):undefined;
  // Prepare a bounded queue while editing or playing. Never swap the source of a mounted decoder.
  useEffect(()=>{
    if(mobile!==false||importing)return;
    const controller=new AbortController();
    const candidates=[activeAsset,nextAsset,followingAsset].filter((a):a is MusicAsset=>!!a&&a.durationMs<=180000);
    let timer:ReturnType<typeof setTimeout>|undefined;
    const prepare=async()=>{
      for(const a of candidates){
        if(controller.signal.aborted||previewReadyRef.current.has(a.id)||Date.now()-(previewAttempts.current.get(a.id)??0)<4000)continue;
        previewAttempts.current.set(a.id,Date.now());
        try{
          const data=await request<{ready:boolean}>(endpoint+id+"/preview/"+a.id,{method:"POST",signal:controller.signal});
          if(data.ready&&!controller.signal.aborted){
            previewReadyRef.current=new Set([...previewReadyRef.current,a.id]);
            // Future unmounted assets can use the proxy; keep the current media URLs stable.
            const inUse=previewBox.current?.querySelectorAll<HTMLVideoElement>("video[data-asset-id]");
            if(playingRef.current&&!Array.from(inUse??[]).some(v=>v.dataset.assetId===a.id)&&trackAudio1.current?.dataset.assetId!==a.id&&trackAudio2.current?.dataset.assetId!==a.id)playingPreviewRef.current=new Set([...playingPreviewRef.current,a.id]);
            setPreviewReady(previewReadyRef.current);
          }
        }catch{}
      }
      if(!controller.signal.aborted&&candidates.some(a=>!previewReadyRef.current.has(a.id)))timer=setTimeout(()=>void prepare(),4000);
    };
    void prepare();
    return()=>{controller.abort();if(timer)clearTimeout(timer);};
  },[id,activeAsset?.id,nextAsset?.id,followingAsset?.id,importing,mobile]);
  // Mobile never loads originals, and proxy preparation continues during playback.
  useEffect(()=>{
    if(mobile!==true)return;
    const controller=new AbortController();
    const ids=[...new Set([activeAsset?.id,nextAsset?.id,activeAudio1?.assetId,activeAudio2?.assetId,followingAsset?.id].filter((v):v is string=>!!v))];
    let timer:ReturnType<typeof setTimeout>|undefined;
    const prepare=async()=>{
      for(const assetId of ids){
        if(controller.signal.aborted)return;
        if(mobileReadyRef.current.has(assetId)||mobileUnavailableRef.current.has(assetId))continue;
        try{
          const data=await request<{ready:boolean;unsupported?:boolean}>(endpoint+id+"/preview/"+assetId+"?mobile=1",{method:"POST",signal:controller.signal});
          if(controller.signal.aborted)return;
          if(data.ready){mobilePrepareAttempts.current.delete(assetId);mobileReadyRef.current=new Set([...mobileReadyRef.current,assetId]);setMobileReady(mobileReadyRef.current);continue;}
          if(data.unsupported){mobileUnavailableRef.current.add(assetId);setMobileUnavailable(new Set(mobileUnavailableRef.current));continue;}
        }catch{if(controller.signal.aborted)return;}
        const attempts=(mobilePrepareAttempts.current.get(assetId)??0)+1;mobilePrepareAttempts.current.set(assetId,attempts);
        if(attempts>=8){mobileUnavailableRef.current.add(assetId);setMobileUnavailable(new Set(mobileUnavailableRef.current));}
      }
      if(!controller.signal.aborted&&ids.some(a=>!mobileReadyRef.current.has(a)&&!mobileUnavailableRef.current.has(a)))timer=setTimeout(()=>void prepare(),2000);
    };
    void prepare();
    return()=>{controller.abort();if(timer)clearTimeout(timer);};
  },[id,mobile,activeAsset?.id,activeAudio1?.assetId,activeAudio2?.assetId,nextAsset?.id,followingAsset?.id,mobileRetry]);
  function mobilePreviewFailed(assetId:string,visible=true){
    if(!mobileRef.current)return;
    if(mobileOriginalRef.current.has(assetId)){if(visible){stopPlayback();setError("Original video could not be loaded.");}return;}
    const next=new Set(mobileReadyRef.current);next.delete(assetId);mobileReadyRef.current=next;setMobileReady(next);
    const count=(mobileFailures.current.get(assetId)??0)+1;mobileFailures.current.set(assetId,count);
    if(count>=2){mobileUnavailableRef.current.add(assetId);setMobileUnavailable(new Set(mobileUnavailableRef.current));if(visible){stopPlayback();setError("Mobile preview could not be loaded. Retry the preview.");}}
    else setMobileRetry(n=>n+1);
  }
  const mobilePreparing=mobile===true&&!!activeAsset&&!mobileReady.has(activeAsset.id);
  const mobileUnsupported=mobilePreparing&&!!activeAsset&&mobileUnavailable.has(activeAsset.id);
  function retryMobilePreview(assetId:string){mobileFailures.current.delete(assetId);mobilePrepareAttempts.current.delete(assetId);mobileUnavailableRef.current.delete(assetId);setMobileUnavailable(new Set(mobileUnavailableRef.current));setMobileRetry(n=>n+1);setError("");}
  function useOriginalOnMobile(assetId:string){
    stopPlayback();mobileOriginalRef.current.add(assetId);mobileUnavailableRef.current.delete(assetId);setMobileUnavailable(new Set(mobileUnavailableRef.current));
    mobileReadyRef.current=new Set([...mobileReadyRef.current,assetId]);setMobileReady(mobileReadyRef.current);setError("");
  }
  const progress=timelineProgress(playhead,timelineEnd);
  const markerViewportX=progress.positionMs/1000*zoom-rulerViewport.scrollLeft;
  const markerVisible=rulerViewport.width>0&&markerViewportX>=-0.5&&markerViewportX<=rulerViewport.width+0.5;
  useLayoutEffect(()=>{viewportRef.current={zoom,...rulerViewport};},[zoom,rulerViewport]);
  // The last audible song part is the only end of the editable project.
  const pixels=project?Math.max(1,timelineLimit/1000*zoom):640;
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
    setSelected(next.id);stopPlayback();setAt(Math.min(playheadRef.current,songPartsEnd(rangeRef.current,partsRef.current)));
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
          Math.max(0,Math.min(timelineLimit-(initial.sourceOutMs-initial.sourceInMs),Math.max(0,snapped(initial.timelineStartMs+delta,initial))));
        const result=transferVideoClip(startClips,initial,track,position);
        valid=result.status==="ok"&&clipEnd(result.clip)<=timelineLimit;setDragTrack(track);setDragBlocked(!valid);
        next=valid&&result.status==="ok"?result.clip:initial;
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
    setLipTrack(track);setLipSearch("");setLipError("");setLipLoading(true);setLipSources([]);
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
  async function uploadVideo(file:File){
    if(importBusy.current)return;
    if(!/\.(mp4|webm)$/i.test(file.name)||file.size<1||file.size>PROJECT_VIDEO_MAX_BYTES){
      setError("Choose an MP4 or WebM video up to "+PROJECT_VIDEO_MAX_MIB+" MiB.");return;
    }
    importBusy.current=true;setImporting(true);setError("");
    try{
      if(saveTimer.current)clearTimeout(saveTimer.current);
      await saveNow();setStatus("Uploading…");
      const uploaded=await request<{asset:MusicAsset;cloudStored?:boolean;cloudEnabled?:boolean}>(endpoint+id+"/assets",{method:"POST",headers:{"Content-Type":"application/octet-stream","X-Project-Filename":encodeURIComponent(file.name),"X-Project-Bytes":String(file.size)},body:file});
      await load();setLibraryOpen(true);setFilter("Uploads");setStatus(uploaded.cloudStored?"Saved to cloud":"Saved locally");
      if(uploaded.cloudEnabled&&!uploaded.cloudStored)setError("Cloud verification failed. The original is safe locally; retry migration in Projects.");
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
    if(importBusy.current||exportBusy.current||!latest.current.some(c=>c.timelineStartMs<timelineEnd))return;
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
    if(playingRef.current){const at=publishedPlaybackMs(playheadRef.current);playheadRef.current=at;setPlayhead(at);setMarkerText(time(at,true));}
    mutedClockRef.current=null;syncHold.current=null;setBuffering(false);playingRef.current=false;setPlaying(false);audio.current?.pause();video.current?.pause();trackAudio1.current?.pause();trackAudio2.current?.pause();
  }
  function setAt(ms:number,range=rangeRef.current){
    ms=Math.round(ms);playheadRef.current=ms;setPlayhead(ms);
    if(!mutesRef.current.song&&audio.current&&audio.current.readyState>=1)
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
  function mutedPreviewClock(at:number){
    const plan=previewMediaPlan(latest.current,at,mutesRef.current),clip=mobileRef.current?plan.visible:plan.clock;
    const candidate=clip===plan.visible?video.current:clip?.track===1?trackAudio1.current:trackAudio2.current;
    const element=clip&&candidate?.dataset.clipId===clip.id?candidate:null;
    return {clip,element,nextBoundaryMs:plan.nextBoundaryMs};
  }
  function startMutedClock(at:number){
    const clock=mutedPreviewClock(at),{clip,element}=clock;
    if(!clip||!element){mutedClockRef.current=null;return clock;}
    const fresh=mutedClockRef.current?.element!==element||mutedClockRef.current?.clipId!==clip.id;
    if(fresh)mutedClockRef.current={element,clipId:clip.id,aligned:false,pending:false,lastAttempt:-Infinity};
    const state=mutedClockRef.current!;
    const expected=clipSourceTimeMs(clip,at)/1000;
    if(!state.aligned&&element.readyState>=1){
      element.playbackRate=1;
      try{if(Math.abs(element.currentTime-expected)>(element.readyState>=2&&!element.seeking?0.025:0.001))element.currentTime=expected;state.aligned=true;}catch{}
    }
    // EOF belongs to the timeline, not play(): play() on ended media restarts it.
    // Wait for alignment/seek completion; never replay the outgoing decoder.
    const action=nativeClockAction(element,state.aligned);
    if(action==="play"&&!state.pending&&(fresh||performance.now()-state.lastAttempt>=150)){
      state.pending=true;state.lastAttempt=performance.now();
      void element.play().catch(error=>{
        if(error?.name==="AbortError")return;
        if(playingRef.current&&(mutesRef.current.song||mobileRef.current)&&mutedClockRef.current===state){stopPlayback();setError("Video playback was blocked. Tap Play to retry.");}
      }).finally(()=>{state.pending=false;if(!playingRef.current||mutedPreviewClock(playheadRef.current).element!==element)element.pause();});
    }
    return clock;
  }
  function advanceMutedClock(at:number,elapsed:number,limit:number){
    const {clip,element,nextBoundaryMs}=startMutedClock(at);
    const boundary=Math.min(nextBoundaryMs,limit);
    if(!clip)return Math.min(at+elapsed,boundary);
    if(!element)return at; // Wait for the matching media element at a clip transition.
    const action=nativeClockAction(element,!!mutedClockRef.current?.aligned);
    if(action==="ended")return nativeClipClockStep(clip,at,element.currentTime,boundary,true);
    if(action!=="running")return at;
    return nativeClipClockStep(clip,at,element.currentTime,boundary,false);
  }
  // Song remains the 1x master. If the visible decoder cannot supply its frame,
  // hold the transport together and resume at the same timeline position.
  function audibleSongAt(at:number){
    return songOwnsPreviewClock(rangeRef.current,partsRef.current,at,mutesRef.current.song);
  }
  function usesNativeClock(at:number){return mutesRef.current.song||mobileRef.current&&!audibleSongAt(at);}
  function pictureAt(clip:MusicClip){
    if(video.current?.dataset.clipId===clip.id)return video.current;
    return Array.from(previewBox.current?.querySelectorAll<HTMLVideoElement>('video[data-clip-id]')??[]).find(element=>element.dataset.clipId===clip.id)??null;
  }
  function pictureReady(at:number,running:boolean){
    const clip=previewMediaPlan(latest.current,at,mutesRef.current).visible;
    if(!clip)return true;
    const element=pictureAt(clip),expected=clipSourceTimeMs(clip,at)/1000;
    const gate=pictureSyncGate(expected,element,running);
    if(gate==="align"&&element){
      element.pause();element.playbackRate=1;
      if(performance.now()-(lastFollowerSeek.current.get(element)??-Infinity)>=150){
        try{element.currentTime=expected;lastFollowerSeek.current.set(element,performance.now());}catch{}
      }
    }
    if(gate!=="ready"||!element)return false;
    // At startup/resume, fill a short runway instead of starting on just one frame.
    if(!running&&!hasPreviewBuffer(element.buffered,expected,Math.min(clip.sourceOutMs/1000,Number.isFinite(element.duration)?element.duration:Infinity)))return false;
    return true;
  }
  function holdSong(at:number){
    const current=audio.current;
    if(syncHold.current===null){syncHold.current=performance.now();setBuffering(true);}
    current?.pause();video.current?.pause();trackAudio1.current?.pause();trackAudio2.current?.pause();
    const expected=(at-songOffset(rangeRef.current))/1000;
    if(current&&current.readyState>=1&&!current.seeking&&Math.abs(current.currentTime-expected)>0.035){try{current.currentTime=expected;}catch{}}
    if(performance.now()-syncHold.current>45000){stopPlayback();setError("Video preview is taking too long. Tap Play to retry.");}
  }
  function clearSyncHold(){if(syncHold.current!==null){syncHold.current=null;setBuffering(false);}}
  function startSong(at:number){
    const current=audio.current;
    if(!current||songPlayPending.current||!current.paused)return;
    const expected=(at-songOffset(rangeRef.current))/1000;
    if(current.readyState>=1&&!current.seeking&&Math.abs(current.currentTime-expected)>0.025){try{current.currentTime=expected;}catch{}}
    songPlayPending.current=true;
    void current.play().catch(error=>{
      if(error?.name==="AbortError")return;
      if(playingRef.current&&!mutesRef.current.song){stopPlayback();setError("Audio playback was blocked. Tap Play to retry.");}
    }).finally(()=>{songPlayPending.current=false;if(!playingRef.current||mutesRef.current.song||syncHold.current!==null)current.pause();});
  }
  useEffect(()=>{
    if(!playing)return;
    let frame=0,last=performance.now(),lastPaint=0,published=playheadRef.current;
    const tick=(now:number)=>{
      if(!playingRef.current)return;
      const current=audio.current,range=rangeRef.current;
      let at=playheadRef.current;
      const elapsed=Math.max(0,now-last);last=now;
      const part=songPartAt(range,continuousSongParts(range,partsRef.current),at);
      const mobilePlan=mobileRef.current?previewMediaPlan(latest.current,at,mutesRef.current):null;
      const songMaster=!!part&&!mutesRef.current.song;
      const mobileClock=!!mobilePlan?.visible&&!songMaster;
      const before=at;
      if(mobilePlan?.visible&&mobileUnavailableRef.current.has(mobilePlan.visible.assetId)){stopPlayback();setError("Mobile preview unavailable for this clip.");return;}
      if(mobileClock){
        clearSyncHold();
        if(current&&!current.paused)current.pause();
        const nextSong=mutesRef.current.song?timelineEnd:effectiveSongParts(range,partsRef.current).map(p=>songTimeToTimeline(p.startMs,range)).find(p=>p>at)??timelineEnd;
        at=advanceMutedClock(at,elapsed,Math.min(timelineEnd,nextSong));
      }else if(mutesRef.current.song){
        clearSyncHold();
        if(current&&!current.paused)current.pause();
        at=advanceMutedClock(at,elapsed,timelineEnd);
      }else if(part&&current){
        mutedClockRef.current=null;
        if(current.playbackRate!==1)current.playbackRate=1;
        const end=songTimelineEnd(part);
        const running=syncHold.current===null&&!current.paused&&!current.seeking;
        if(running)at=Math.min(end,Math.max(at,part.positionMs,Math.round(current.currentTime*1000)+songOffset(range)));
        if(current.ended||at>=end){clearSyncHold();current.pause();at=end;}
        else{
          // At a cut, the next pre-seeked decoder can already be ready. If not,
          // hold at the exact boundary instead of letting the song run ahead.
          const plan=previewMediaPlan(latest.current,before,mutesRef.current);
          const boundary=plan.nextBoundaryMs;
          if(boundary<=at&&previewMediaPlan(latest.current,boundary,mutesRef.current).visible?.id!==plan.visible?.id&&!pictureReady(boundary,false)){
            at=boundary;holdSong(at);
          }else if(!pictureReady(at,running)){holdSong(at);}
          else{clearSyncHold();startSong(at);}
        }
      }else{
        clearSyncHold();mutedClockRef.current=null;current?.pause();
        const next=effectiveSongParts(range,partsRef.current).map(p=>songTimeToTimeline(p.startMs,range)).find(p=>p>at)??timelineEnd;
        at=Math.min(at+elapsed,next,timelineEnd);
      }
      // When a song-only interval reaches a video, stop exactly at the first media boundary.
      if(mobilePlan&&!mobileClock&&!songMaster)at=Math.min(at,mobilePlan.nextBoundaryMs);
      if(at>=timelineEnd){playheadRef.current=timelineEnd;setPlayhead(timelineEnd);stopPlayback();return;}
      if(mobileRef.current&&at>before){
        const outgoing=mobilePlan?.visible,incoming=previewMediaPlan(latest.current,at,mutesRef.current).visible;
        if(outgoing?.id!==incoming?.id){
          video.current?.pause();mutedClockRef.current=null;
          // A ready incoming decoder is promoted at the boundary.
        }
      }
      if(!playingRef.current)return;
      playheadRef.current=at;
      // Follow the exact audio clock each animation frame, not the throttled React UI.
      if(songMaster){const plan=previewMediaPlan(latest.current,at,mutesRef.current);syncVideo(video.current,plan.visible);syncTrackAudio(trackAudio1.current,plan.audio1,mutesRef.current[1],at,true);syncTrackAudio(trackAudio2.current,plan.audio2,mutesRef.current[2],at,true);}
      // Paint the moving marker directly, without rebuilding the editor on each video frame.
      const viewport=viewportRef.current,x=at/1000*viewport.zoom,viewX=x-viewport.scrollLeft;
      if(playheadLine.current)playheadLine.current.style.left=x+"px";
      if(playheadGrip.current){
        playheadGrip.current.style.left=(viewport.left+viewX)+"px";
        playheadGrip.current.style.visibility=viewport.width>0&&viewX>=-.5&&viewX<=viewport.width+.5?"visible":"hidden";
      }
      const crossed=latest.current.some(c=>(c.timelineStartMs>published&&c.timelineStartMs<=at)||(clipEnd(c)>published&&clipEnd(c)<=at));
      // Media changes are immediate; React controls and millisecond readouts update at 10 Hz.
      if(crossed||(mobileRef.current?now-lastPaint>=250:now-lastPaint>=100)){
        published=at;lastPaint=now;
        const ms=publishedPlaybackMs(at);setPlayhead(ms);setMarkerText(time(ms,true));
      }
      frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);
    return()=>cancelAnimationFrame(frame);
  },[playing,timelineEnd]);
  function togglePlayback(){
    if(!audio.current)return;
    if(playingRef.current){stopPlayback();return;}
    if(playheadRef.current>=timelineEnd)setAt(0);
    if(mobileRef.current){
      const plan=previewMediaPlan(latest.current,playheadRef.current,mutesRef.current);
      if(plan.visible&&!mobileReadyRef.current.has(plan.visible.assetId)){setError("Preparing mobile video preview. Tap Play when ready.");return;}
    }
    playingPreviewRef.current=new Set(previewReadyRef.current);
    playingRef.current=true;setPlaying(true);
    const range=rangeRef.current,at=playheadRef.current;
    // The follower effect and song playing event start the matching clips.
    applyPreviewVolume(audio.current);
    if(usesNativeClock(at)){
      audio.current.pause();startMutedClock(at);syncFollowers();
    }else if(songPartAt(range,partsRef.current,at)){
      if(pictureReady(at,false)){clearSyncHold();startSong(at);syncFollowers();}
      else holdSong(at);
    }
  }
  // Use the song clock only while audible; a muted song must not stall the preview.
  function songClockRunning(at:number){
    if(usesNativeClock(at)){
      const {clip,element}=mutedPreviewClock(at);
      return !clip||!!element&&!element.paused&&!element.seeking&&element.readyState>=2;
    }
    const master=audio.current;
    if(syncHold.current!==null)return false;
    return !songPartAt(rangeRef.current,partsRef.current,at)||
      (!!master&&!master.paused&&!master.seeking&&master.readyState>=3);
  }
  function syncMedia(element:HTMLMediaElement|null,clip:MusicClip|undefined,at:number,run:boolean){
    if(!element)return;
    // Ignore stale media callbacks from the previous clip/source during a handoff.
    if(clip&&element.dataset.clipId!==clip.id)return;
    if(clip)applyPreviewVolume(element);
    if(playingRef.current&&usesNativeClock(at)&&mutedPreviewClock(at).element===element)return;
    if(!clip||at<clip.timelineStartMs||at>=clipEnd(clip)){element.pause();element.playbackRate=1;return;}
    const expected=clipSourceTimeMs(clip,at)/1000;
    if(element.readyState<1)return;
    // While the master buffers, pause followers rather than repeatedly seeking them.
    if(!run&&playingRef.current){element.pause();return;}
    const decision=mobileRef.current&&audibleSongAt(at)&&element instanceof HTMLVideoElement
      ?mobileVideoSyncDecision(expected,element.currentTime,run,element.paused,element.seeking)
      :mediaSyncDecision(expected,element.currentTime,run,element.paused,element.seeking);
    if(element.playbackRate!==decision.rate)element.playbackRate=decision.rate;
    if(decision.seek&&(!run||element.paused||performance.now()-(lastFollowerSeek.current.get(element)??-Infinity)>=(mobileRef.current?750:250))){
      try{element.currentTime=expected;lastFollowerSeek.current.set(element,performance.now());}catch{}
    }
    if(!run){element.pause();return;}
    // One outstanding play request per decoder; never pile up promises during a seek.
    if(element.paused&&!element.ended&&!element.seeking&&!followerPlayPending.current.has(element)){
      followerPlayPending.current.add(element);void element.play().catch(()=>{}).finally(()=>{followerPlayPending.current.delete(element);if(!playingRef.current||syncHold.current!==null)element.pause();});
    }
  }
  // Keep one upcoming decoder paused and seek it to the actual visible boundary,
  // including a lower track returning after an overlay. Reuse that same keyed
  // element when it becomes visible; never start an off-screen clip playing.
  function warmNextVideo(element:HTMLVideoElement,clip:MusicClip,at:number){
    if(element.dataset.clipId!==clip.id||element===video.current||element.readyState<1||element.seeking)return;
    // A queued metadata event can arrive just after the timeline crossed the cut.
    if(previewMediaPlan(latest.current,playheadRef.current,mutesRef.current).visible?.id===clip.id)return;
    element.pause();
    const expected=clipSourceTimeMs(clip,at)/1000;
    if(Math.abs(element.currentTime-expected)>0.015){
      try{element.currentTime=expected;}catch{}
    }
  }
  function syncVideo(element:HTMLVideoElement|null,clip:MusicClip|undefined){
    if(!element||element!==video.current)return;
    const at=playheadRef.current;
    const visible=previewMediaPlan(latest.current,at,mutesRef.current).visible;
    if(clip?.id!==visible?.id||element.dataset.clipId!==visible?.id){element.pause();return;}
    if(clip)applyPreviewVolume(element);
    if(playingRef.current&&usesNativeClock(at)){
      if(mutedPreviewClock(at).element===element){startMutedClock(at);return;}
    }
    syncMedia(element,clip,at,playingRef.current&&songClockRunning(at));
  }
  function syncTrackAudio(element:HTMLAudioElement|null,clip:MusicClip|undefined,muted:boolean,at:number,run:boolean){
    if(!element)return;
    if(muted){element.pause();element.playbackRate=1;return;}
    syncMedia(element,clip,at,run&&songClockRunning(at));
  }
  function pauseFollowers(){
    if(usesNativeClock(playheadRef.current))return;
    video.current?.pause();trackAudio1.current?.pause();trackAudio2.current?.pause();
  }
  function syncFollowers(){
    applyPreviewVolume(audio.current);
    syncVideo(video.current,activeClip);
    syncTrackAudio(trackAudio1.current,activeAudio1,mutesRef.current[1],playheadRef.current,playingRef.current);
    syncTrackAudio(trackAudio2.current,activeAudio2,mutesRef.current[2],playheadRef.current,playingRef.current);
  }
  // Run after React has attached the promoted decoder's ref, before painting.
  // This also starts a preloaded clip which no longer emits a canplay event.
  useLayoutEffect(()=>{syncFollowers();},[activeClip?.id,activeAudio1?.id,activeAudio2?.id,mobileReady,playing,trackMutes]);
  useEffect(()=>{syncFollowers();},[playhead,activeClip,activeAudio1,activeAudio2,trackMutes,playing]);
  const libraryFilters=["All","Lip Sync","B-Roll","AI Video","Uploads"] as const;
  const matchesLibraryFilter=(a:MusicAsset,filter:typeof libraryFilters[number])=>filter==="All"||filter==="Lip Sync"&&a.role==="lip-sync"||filter==="B-Roll"&&a.role==="b-roll"||filter==="AI Video"&&a.kind==="ai-video"||filter==="Uploads"&&a.kind==="imported";
  const media=useMemo(()=>assets.filter(a=>matchesLibraryFilter(a,filter)&&a.name.toLowerCase().includes(search.trim().toLowerCase())).sort((a,b)=>libraryNewest?b.createdAt-a.createdAt:a.createdAt-b.createdAt),[assets,filter,search,libraryNewest]);
  async function refreshLibrary(){
    if(importBusy.current||roleBusy.current||libraryRefreshing)return;
    setLibraryRefreshing(true);setRoleError("");
    try{
      await saveNow();
      const result=await request<Detail>(endpoint+id);
      // Refresh only the media inventory. Do not reset selection, playhead or unsaved edits.
      if(result.project.revision!==revision.current||dirty.current||importBusy.current||roleBusy.current)return;
      if(detailRef.current)detailRef.current={...detailRef.current,assets:result.assets};
      setDetail(previous=>previous?{...previous,assets:result.assets}:previous);
    }catch(e){setRoleError(e instanceof Error?e.message:"Unable to refresh library.");}
    finally{setLibraryRefreshing(false);}
  }
  if(!detail)return <main className="mv-root"><Link href="/projects">← Projects</Link><p role="status">Loading Music Video Builder…</p><p role="alert">{error}</p></main>;
  const ticks=Array.from({length:Math.floor(timelineLimit/10000)+1},(_,i)=>i*10000);
  return <main id="content" className="mv-root mv-editor">
    <div className="mv-top">
      <div className="mv-name"><Link href="/projects" aria-label="Back to projects">‹</Link>
        {editingName?<form onSubmit={e=>{e.preventDefault();void saveName();}}>
          <input autoFocus maxLength={80} value={newName} onChange={e=>setNewName(e.target.value)}/>
          <button type="submit" aria-label="Save project name"><Check size={17}/></button></form>:
          <button className="mv-project-name-button" title={project!.name+" · Rename project"} aria-label={"Rename project "+project!.name} onClick={()=>setEditingName(true)}><Pencil size={17}/><span>{project!.name}</span></button>}</div>
      <div className="mv-top-actions"><span role="status" className="mv-status">{status}</span>
        <button className="mv-primary mv-export-button" type="button" aria-label="Export MP4" title="Export MP4" disabled={importing||!clips.some(c=>c.timelineStartMs<timelineEnd)} onClick={()=>void exportMp4()}><Download size={17}/><span>{exporting?"Exporting…":"Export"}</span></button></div>
    </div>
    <section className="mv-preview" aria-label="Music video preview">
      <div ref={previewBox} className={"mv-video-box"+(previewRatio==="9:16"?" is-portrait":"")}>
        {!activeAsset&&<div className="mv-preview-empty"><Film size={40}/><span>Arrange clips to preview your music video</span></div>}
        {mobilePreparing&&activeAsset&&<div className="mv-preview-empty"><Film size={32}/><span>{mobileUnsupported?"Mobile preview unavailable.":"Preparing mobile preview…"}</span>{mobileUnsupported&&<><button type="button" onClick={()=>retryMobilePreview(activeAsset.id)}>Retry</button><button type="button" onClick={()=>useOriginalOnMobile(activeAsset.id)}>Use original</button></>}</div>}
        {(mobile===null?[]:[
          activeClip&&(!mobile||mobileReady.has(activeClip.assetId))?activeClip:undefined,
          nextClip&&nextAsset&&nextTransition&&nextTransition.atMs-playhead<=PREVIEW_LOOKAHEAD_MS&&(!mobile||mobileReady.has(nextAsset.id))?nextClip:undefined
        ]).filter((c):c is MusicClip=>!!c).map(c=>{
          const a=byId.get(c.assetId);if(!a)return null;
          const visible=c.id===activeClip?.id;
          const warm=(element:HTMLVideoElement)=>{if(nextTransition&&nextTransition.clip.id===c.id)warmNextVideo(element,c,nextTransition.atMs);};
          return <video key={c.id} ref={visible?video:undefined} data-clip-id={c.id} data-asset-id={a.id} playsInline muted={!visible||trackMutes[c.track]} preload="auto" src={source(a)} style={visible?undefined:{visibility:"hidden",pointerEvents:"none"}} aria-hidden={!visible} onError={()=>{if(mobile)mobilePreviewFailed(a.id,visible);else if(visible&&playingRef.current){stopPlayback();setError("Video could not be loaded. Tap Play to retry.");}}}
            onLoadedMetadata={e=>{if(visible)syncVideo(e.currentTarget,c);else warm(e.currentTarget);}} onCanPlay={e=>{if(visible){syncVideo(e.currentTarget,c);}else warm(e.currentTarget);}} onSeeked={e=>{if(visible)syncVideo(e.currentTarget,c);}}/>;
        })}

      </div>
      <audio ref={audio} src={endpoint+id+"/song"} muted={trackMutes.song} preload={trackMutes.song?"none":"auto"}
        onLoadedMetadata={()=>{applyPreviewVolume(audio.current);if(!playingRef.current&&!mutesRef.current.song)setAt(playheadRef.current);}} onWaiting={pauseFollowers} onSeeking={pauseFollowers} onPlaying={syncFollowers}/>
      {activeAudio1&&mobile!==null&&(!mobile||mobileReady.has(activeAudio1.assetId))&&<audio key={"track1-"+activeAudio1.id} ref={trackAudio1} data-clip-id={activeAudio1.id} data-asset-id={activeAudio1.assetId} src={mobile?mobileSource(activeAudio1.assetId):endpoint+id+(readyForPlayback.has(activeAudio1.assetId)?"/preview/":"/assets/")+activeAudio1.assetId} onError={()=>{if(mobile)mobilePreviewFailed(activeAudio1.assetId);}} preload="auto" onLoadedMetadata={()=>syncTrackAudio(trackAudio1.current,activeAudio1,mutesRef.current[1],playheadRef.current,playingRef.current)} onCanPlay={()=>syncTrackAudio(trackAudio1.current,activeAudio1,mutesRef.current[1],playheadRef.current,playingRef.current)} onSeeked={()=>syncTrackAudio(trackAudio1.current,activeAudio1,mutesRef.current[1],playheadRef.current,playingRef.current)}/>}
      {activeAudio2&&mobile!==null&&(!mobile||mobileReady.has(activeAudio2.assetId))&&<audio key={"track2-"+activeAudio2.id} ref={trackAudio2} data-clip-id={activeAudio2.id} data-asset-id={activeAudio2.assetId} src={mobile?mobileSource(activeAudio2.assetId):endpoint+id+(readyForPlayback.has(activeAudio2.assetId)?"/preview/":"/assets/")+activeAudio2.assetId} onError={()=>{if(mobile)mobilePreviewFailed(activeAudio2.assetId);}} preload="auto" onLoadedMetadata={()=>syncTrackAudio(trackAudio2.current,activeAudio2,mutesRef.current[2],playheadRef.current,playingRef.current)} onCanPlay={()=>syncTrackAudio(trackAudio2.current,activeAudio2,mutesRef.current[2],playheadRef.current,playingRef.current)} onSeeked={()=>syncTrackAudio(trackAudio2.current,activeAudio2,mutesRef.current[2],playheadRef.current,playingRef.current)}/>}
      <div className="mv-format-controls" role="group" aria-label="Project video format">
        <span>Format</span>
        {(["auto","9:16","16:9"] as const).map(ratio=><button key={ratio} type="button" aria-pressed={aspectRatio===ratio} title={ratio==="auto"?"Use the first visible video’s format":ratio==="9:16"?"Portrait":"Landscape"} disabled={importing} onClick={()=>changeAspectRatio(ratio)}>{ratio==="auto"?"Auto":ratio}</button>)}
        {aspectRatio==="auto"&&autoFormat?.assetId===firstAssetId&&<small>{previewRatio}</small>}
      </div>
      <div className="mv-player-controls">
        <button aria-label={playing?"Pause":"Play"} disabled={!playing&&(mobile===null||mobilePreparing)} onClick={togglePlayback}>{playing?<Pause size={19}/>:<Play size={19}/>}</button>
        <span className="mv-clock">{time(progress.positionMs,true)} / {time(timelineEnd,true)}</span>
        {buffering&&<span role="status" className="mv-status">Buffering video…</span>}
        <div className="mv-progress-wrap">
          <div className="mv-progress-rail" aria-hidden="true"><span style={{width:progress.percent+"%"}}/></div>
          <input className="mv-progress" aria-label="Seek timeline" aria-valuetext={time(progress.positionMs,true)} type="range" min={0} max={Math.max(1,timelineEnd)} step="1" disabled={timelineEnd===0} value={progress.positionMs} onChange={e=>seek(Number(e.target.value))}/>
        </div>
        {playerVolumeButton()}
        <button aria-label="Fullscreen" onClick={()=>{const box=document.querySelector(".mv-video-box");void box?.requestFullscreen?.();}}><Maximize size={19}/></button>
      </div>
    </section>
    {volumePopup&&<div ref={volumePanel} id="mv-preview-volume-panel" className="mv-preview-volume-panel" style={{left:volumePopup.left,top:volumePopup.top}}>
      <input type="range" min={0} max={100} step={1} value={previewVolume} aria-label="Preview volume percent" aria-orientation="vertical" aria-valuetext={previewVolume+"%"} onChange={e=>changePreviewVolume(Number(e.target.value))}/>
    </div>}
    <section className="mv-timeline" aria-label="Timeline editor">
      <div className="mv-timeline-toolbar">
        <div><button aria-label="Undo" disabled={!past.current.length} onClick={undo}><Undo2 size={17}/></button>
          <button aria-label="Redo" disabled={!future.current.length} onClick={redo}><Redo2 size={17}/></button>
          <button type="button" className="mv-cut-button" onClick={songSelected?splitSong:split} disabled={importing||(songSelected?(!splitSongPart(songRange,songParts,playhead)||playhead<songTimeToTimeline(selectedPart.startMs,songRange)+100||playhead>songTimeToTimeline(selectedPart.endMs,songRange)-100):!selectedClip||playhead-selectedClip.timelineStartMs<100||clipEnd(selectedClip)-playhead<100)} title={songSelected?"Split selected song at playhead":"Split selected video at playhead"} aria-label={songSelected?"Split selected song":"Split selected video"}><Scissors size={18}/></button>
          <button onClick={songSelected?removeSongPart:deleteClip} disabled={importing||(songSelected?(!songParts||songParts.length<2):!selectedClip)}><Trash2 size={17}/> Delete</button>
          {selectedAsset?.role==="lip-sync"&&selectedAsset.sourceStartMs!==null&&selectedAsset.sourceEndMs!==null&&<button onClick={toggleLock}>{selectedClip?.syncLocked?<Lock size={16}/>:<Unlock size={16}/>} Sync</button>}
          {selectedClip&&<button title="Move clip to the other video track at the same time" disabled={importing} onClick={switchVideoTrack}>Switch track</button>}</div>
        <div className="mv-timeline-zoom">
          <form className="mv-marker-time" onSubmit={e=>{e.preventDefault();submitMarker();}}>
            <label>Playhead <input aria-label="Playhead timeline time" value={markerText} onFocus={stopPlayback} onChange={e=>setMarkerText(e.target.value)}/></label>
            <button type="submit" onPointerDown={e=>e.preventDefault()} title="Go to exact time" aria-label="Go to exact time"><Check size={15}/></button>
          </form>
          <label title="Automatically align clips and the playhead to nearby clip edges"><input type="checkbox" checked={snap} onChange={e=>setSnap(e.target.checked)}/> Snap to edges</label>
          <div className="mv-zoom-buttons" role="group" aria-label="Timeline zoom">
            
            <button type="button" aria-label="Zoom out timeline" title="Zoom out timeline" disabled={zoom<=20} onClick={()=>setZoom(z=>Math.max(20,z-12))}><Minus size={17}/></button>
            <output aria-label="Timeline zoom level">{(zoom/44).toFixed(1)}×</output>
            <button type="button" aria-label="Zoom in timeline" title="Zoom in timeline" disabled={zoom>=140} onClick={()=>setZoom(z=>Math.min(140,z+12))}><Plus size={17}/></button>
          </div></div>
      </div>
      <div className="mv-tracks" ref={tracksRef}>
        <div className="mv-track-labels">
          <div className="mv-label mv-ruler-spacer"/>
          {([2,1] as Track[]).map(track=><div className={"mv-label"+(track===1?" mv-main-label":"")} key={track} title={track===1?"Lip-Sync · Main video track":"Video · Overlay"}>
            {track===1?<Mic size={18}/>:<Video size={18}/>}<strong>{track===1?"Lip-Sync":"Video"}</strong>{muteButton(track,track===1?"Lip-Sync audio":"Video audio")}
          </div>)}
          <div className="mv-label mv-audio-label" title="Song audio"><Music2 size={18}/><strong>Song</strong>{muteButton("song","song")}</div>
        </div>
        <div className="mv-scroll" ref={scroll}>
          <div className="mv-track-area" ref={trackArea} style={{width:pixels}}>
            <div className="mv-ruler" style={{overflow:"hidden"}} onPointerDown={e=>scrubMarker(e)} onPointerMove={updateMarker} onPointerUp={e=>releaseMarker(e)} onPointerCancel={e=>releaseMarker(e,true)} onLostPointerCapture={e=>releaseMarker(e,true)}>
              {ticks.map(t=><span key={t} style={{left:t/1000*zoom}}>{time(t)}</span>)}
            </div>
            {([2,1] as Track[]).map(track=><div className={"mv-lane"+(track===1?" mv-main-lane":"")+(trackMutes[track]?" is-audio-muted":"")+(dragTrack===track?(dragBlocked?" is-drop-blocked":" is-drop-target"):"")} key={track} ref={el=>{videoLanes.current[track]=el;}} onDragOver={e=>e.preventDefault()} onDrop={e=>onDrop(e,track)}>
              {clips.filter(c=>c.track===track&&c.timelineStartMs<timelineLimit).map(c=>{
                const a=byId.get(c.assetId);if(!a)return null;
                return <div key={c.id} className={"mv-clip"+(selected===c.id?" is-selected":"")+(c.syncLocked?" is-locked":"")+(armedMedia===c.id?" is-armed":"")}
                    style={{left:c.timelineStartMs/1000*zoom,width:(Math.min(clipEnd(c),timelineLimit)-c.timelineStartMs)/1000*zoom}}
                    tabIndex={0} aria-label={"Select video "+a.name}
                    onKeyDown={e=>{if(e.target===e.currentTarget&&(e.key==="Enter"||e.key===" ")){e.preventDefault();selectVideo(c.id);}}}
                    onContextMenu={e=>e.preventDefault()}
                    onPointerDown={e=>{if(!(e.target as HTMLElement).closest(".mv-handle"))beginMediaGesture(e,c.id,()=>movePointer(e,c,"move"),()=>selectVideo(c.id));}}
                    title={a.name+" · "+time(c.timelineStartMs,true)}>
                  <button type="button" className="mv-handle mv-handle-start" aria-label="Trim clip start" title="Drag with mouse or hold on touch to trim start" onPointerDown={e=>beginMediaGesture(e,c.id,()=>movePointer(e,c,"start"),()=>selectVideo(c.id))} onKeyDown={e=>keyboardTrim(e,c,"start")}/>
                  <span className="mv-clip-title">{c.track===1?<Mic size={12} aria-hidden="true"/>:<Video size={12} aria-hidden="true"/>}<span>{a.name}</span></span>
                  {c.syncLocked&&<Lock className="mv-clip-lock" size={13}/>}
                  <button type="button" className="mv-handle mv-handle-end" aria-label="Trim clip end" title="Drag with mouse or hold on touch to trim end" onPointerDown={e=>beginMediaGesture(e,c.id,()=>movePointer(e,c,"end"),()=>selectVideo(c.id))} onKeyDown={e=>keyboardTrim(e,c,"end")}/>
                </div>;
              })}
            </div>)}
            <div className={"mv-song-lane"+(trackMutes.song?" is-audio-muted":"")} onPointerDown={e=>{if(e.target===e.currentTarget)seek(msFromX(e.clientX-e.currentTarget.getBoundingClientRect().left));}}>
              {songParts===null?<><div className={"mv-song-block"+(songSelected?" is-selected":"")+(armedMedia==="song"?" is-armed":"")} role="button" tabIndex={0} aria-label="Select song" aria-pressed={songSelected} title="Click or tap to select; drag with mouse; on touch, hold to move or swipe to scroll"
                style={{left:songRange.positionMs/1000*zoom,width:(songRange.endMs-songRange.startMs)/1000*zoom}}
                onContextMenu={e=>e.preventDefault()} onPointerDown={e=>beginMediaGesture(e,"song",()=>dragSong(e),selectSong)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();selectSong();return;}if(e.key!=="ArrowLeft"&&e.key!=="ArrowRight")return;e.preventDefault();selectSong();const r=rangeRef.current;
                  commitSongRange(r,Math.max(0,r.positionMs+(e.key==="ArrowLeft"?-1:1)*(e.shiftKey?100:1)));}}>
                <SongWaveform peaks={wave} width={project!.songDurationMs/1000*zoom} left={-songRange.startMs/1000*zoom}/>
              </div>
              {(["start","end"] as const).map(edge=><button type="button" key={edge} className={"mv-song-handle "+edge+(songSelected?" is-selected":"")+(armedMedia==="song"?" is-armed":"")}
                style={{left:(edge==="start"?songRange.positionMs:songTimelineEnd(songRange))/1000*zoom,width:Math.min(22,(songRange.endMs-songRange.startMs)/1000*zoom/3)}}
                aria-label={"Trim song "+edge} title={time(edge==="start"?songRange.startMs:songRange.endMs,true)}
                onContextMenu={e=>e.preventDefault()} onPointerDown={e=>beginMediaGesture(e,"song",()=>dragSongEdge(e,edge),selectSong)}
                onKeyDown={e=>{if(e.key!=="ArrowLeft"&&e.key!=="ArrowRight")return;e.preventDefault();selectSong();const range=rangeRef.current;
                  commitSongRange(moveSongEdge(range,edge,(edge==="start"?range.startMs:range.endMs)+(e.key==="ArrowLeft"?-1:1)*(e.shiftKey?100:1),project!.songDurationMs));}}/>)}</>:currentParts.map((p,i)=><div key={i} className={"mv-song-block mv-song-part"+(songSelected&&i===Math.min(partIndex,currentParts.length-1)?" is-selected":"")+(armedMedia==="song-part-"+i?" is-armed":"")} role="button" tabIndex={0} aria-label={"Select song part "+(i+1)} aria-pressed={songSelected&&i===Math.min(partIndex,currentParts.length-1)} style={{left:songTimeToTimeline(p.startMs,songRange)/1000*zoom,width:(p.endMs-p.startMs)/1000*zoom}} onContextMenu={e=>e.preventDefault()} onPointerDown={e=>{if(!(e.target as HTMLElement).closest(".mv-part-edge"))beginMediaGesture(e,"song-part-"+i,()=>{selectPart(i);dragSong(e);},()=>selectPart(i));}} onKeyDown={e=>{if(e.target===e.currentTarget&&(e.key==="Enter"||e.key===" ")){e.preventDefault();selectPart(i);}}}>
                <SongWaveform peaks={wave} width={project!.songDurationMs/1000*zoom} left={-p.startMs/1000*zoom}/>
                <span className="mv-song-part-number">{i+1}</span>
                {songSelected&&i===Math.min(partIndex,currentParts.length-1)&&(["start","end"] as const).map(edge=><button key={edge} type="button" className={"mv-song-handle is-selected mv-part-edge "+edge} aria-label={"Trim song part "+edge} onPointerDown={e=>beginMediaGesture(e,"song-part-"+i,()=>trimPartEdge(e,i,edge),()=>selectPart(i))} onKeyDown={e=>{if(e.key!=="ArrowLeft"&&e.key!=="ArrowRight")return;e.preventDefault();e.stopPropagation();const d=(e.key==="ArrowLeft"?-1:1)*(e.shiftKey?100:1);editPart(edge==="start"?p.startMs+d:p.startMs,edge==="end"?p.endMs+d:p.endMs);}}/>)}
              </div>)}
            </div>
            <div ref={playheadLine} className={"mv-playhead"+(scrubbing?" is-scrubbing":"")} style={{left:progress.positionMs/1000*zoom}} aria-hidden="true"/>
          </div>
        </div>
        <div className="mv-playhead-overlay">
          <button ref={playheadGrip} type="button" className="mv-playhead-grip" style={{left:rulerViewport.left+markerViewportX,visibility:markerVisible?"visible":"hidden"}} role="slider" aria-label="Move playhead" aria-valuemin={0} aria-valuemax={timelineEnd} aria-valuenow={Math.round(playhead)} aria-valuetext={time(playhead,true)} title={"Drag playhead · "+time(playhead,true)}
                onPointerDown={e=>scrubMarker(e,true)} onPointerMove={updateMarker} onPointerUp={releaseMarker} onPointerCancel={e=>releaseMarker(e,true)} onLostPointerCapture={e=>releaseMarker(e,true)} onKeyDown={markerKey}/>
        </div>
      </div>
      <button type="button" className="mv-inspector-toggle" aria-expanded={inspectorOpen} onClick={()=>setInspectorOpen(v=>!v)}>{songSelected?<Music2 size={16}/>:<Film size={16}/>}<span>{songSelected?((project!.songName||"Unnamed song")+(songParts&&currentParts.length>1?" · Part "+(Math.min(partIndex,currentParts.length-1)+1)+" / "+currentParts.length:"")):(selectedAsset?.name||"Video")}</span>{inspectorOpen?<ChevronDown size={16}/>:<ChevronRight size={16}/>}</button>
      <div className="mv-inspector-body" hidden={!inspectorOpen}>
      {!songSelected&&selectedClip&&selectedAsset?<form className="mv-song-trim mv-clip-position" onSubmit={e=>e.preventDefault()}>
        <div className="mv-video-times">
          <div className="mv-time-pair" role="group" aria-label="Original song time">
            <span className="mv-time-pair-heading">Original song time <small>Position in the full, untrimmed song</small></span>
            <InlineTimeField label="Video start time" ariaLabel="Video start time in original song" value={clipSongText} onChange={v=>updateClipTime(v,"song")} onConfirm={()=>submitClipTime("song")} disabled={importing} placeholder="00:08.918"/>
            <InlineTimeField label="Video end time" ariaLabel="Video end time in original song" value={clipSongEndText} onChange={v=>updateClipEnd(v,"song")} onConfirm={()=>submitClipEnd("song")} disabled={importing} placeholder="00:18.918"/>
          </div>
          <div className="mv-time-pair" role="group" aria-label="Project timeline">
            <span className="mv-time-pair-heading">Project timeline <small>Position in this music video project</small></span>
            <InlineTimeField label="Timeline start" ariaLabel="Video start time on timeline" value={clipTimelineText} onChange={v=>updateClipTime(v,"timeline")} onConfirm={()=>submitClipTime("timeline")} disabled={importing} placeholder="00:08.918"/>
            <InlineTimeField label="Timeline end" ariaLabel="Video end time on timeline" value={clipEndText} onChange={v=>updateClipEnd(v,"timeline")} onConfirm={()=>submitClipEnd("timeline")} disabled={importing} placeholder="00:18.918"/>
          </div>
        </div>
        {originalClipSongTime!==null&&<button type="button" className="mv-outline mv-inspector-icon" disabled={importing} onClick={()=>moveSelectedClip(songTimeToTimeline(originalClipSongTime,rangeRef.current),true)} title={"Restore Lip Sync · "+time(originalClipSongTime,true)} aria-label="Restore Lip Sync"><Lock size={14}/></button>}
        <span className="mv-inspector-duration">Duration <b>{time(selectedClip.sourceOutMs-selectedClip.sourceInMs,true)}</b></span>
      </form>:
      <form className="mv-song-trim mv-song-position" onSubmit={e=>e.preventDefault()}>
        <InlineTimeField label={songParts?"Part source start":"Source start"} ariaLabel={songParts?"Song part start":"Song start time"} value={songParts?partStartText:startText} onChange={songParts?setPartStartText:setStartText} onConfirm={()=>submitSongField("start")} disabled={importing} placeholder="00:08.918"/>
        <InlineTimeField label={songParts?"Part source end":"Source end"} ariaLabel={songParts?"Song part end":"Song end time"} value={songParts?partEndText:endText} onChange={songParts?setPartEndText:setEndText} onConfirm={()=>submitSongField("end")} disabled={importing} placeholder="00:30.000"/>
        <span className="mv-inspector-duration">Duration <b>{time(selectedPart.endMs-selectedPart.startMs,true)}</b></span>
      </form>}
      </div>
      {error&&<p className="mv-error" role="alert">{error}</p>}
      <input ref={fileInput} hidden type="file" accept=".mp4,.webm,video/mp4,video/webm" onChange={e=>{
        const file=e.target.files?.[0];if(file)void uploadVideo(file);e.target.value="";
      }}/>
    </section>
    <section className="mv-library">
      <button className="mv-library-heading" aria-expanded={libraryOpen} onClick={()=>setLibraryOpen(!libraryOpen)}>
        {libraryOpen?<ChevronDown size={21}/>:<ChevronRight size={21}/>}<h2>Library</h2><span>{assets.length} videos</span>
      </button>
      {libraryOpen&&<div className="mv-library-content">
        {roleError&&<p className="mv-error" role="alert">{roleError}</p>}
        <p className="mv-role-hint">Choose each video’s role. Lip Sync defaults to the main track; B-Roll to the upper track. Changing role keeps existing clip positions; B-Roll releases Sync Lock. Original source times are preserved.</p>
        <div className="mv-library-tools">
          <div className="mv-browse-toolbar">
            <label className="mv-browse-search"><Search size={16}/><input type="search" placeholder="Search library…" aria-label="Search media" value={search} onChange={e=>setSearch(e.target.value)}/></label>
            <label className="mv-browse-filter"><select aria-label="Filter library videos" value={filter} onChange={e=>setFilter(e.target.value as typeof filter)}>
              {libraryFilters.map(f=><option key={f} value={f}>{f==="All"?"All videos":f} ({assets.filter(a=>matchesLibraryFilter(a,f)).length})</option>)}
            </select><ChevronDown size={15} aria-hidden="true"/></label>
            <button type="button" className="mv-browse-control" disabled={importing||libraryRefreshing} onClick={()=>void refreshLibrary()} title="Refresh library" aria-label="Refresh library"><RefreshCw size={15}/></button>
            <button type="button" className="mv-browse-control" onClick={()=>setLibraryNewest(v=>!v)} aria-label={libraryNewest?"Sort oldest first":"Sort newest first"}><ArrowUpDown size={15}/><span>{libraryNewest?"Newest first":"Oldest first"}</span></button>
          </div>
          <div className="mv-library-imports">
          <button className="mv-outline" disabled={importing} onClick={()=>void openLipSync(1)}><Music2 size={16}/> Insert Lip Sync</button>
          <button className="mv-outline" disabled={importing} onClick={()=>fileInput.current?.click()}><Upload size={16}/> Upload video</button>
          </div>
        </div>
        {media.length?<div className="mv-media-grid">{media.map(a=><article key={a.id} className="mv-media-card"
          draggable onDragStart={e=>e.dataTransfer.setData("application/x-mvasset",a.id)}>
          <div className="mv-media-image"><Film size={32}/><img src={endpoint+id+"/thumbnail/"+a.id} alt="" loading="lazy" decoding="async" draggable={false} onError={e=>{e.currentTarget.style.display="none";}} onLoad={e=>{e.currentTarget.style.display="block";}}/><span>{time(a.durationMs)}</span></div>
          <div className="mv-media-info">
            <strong title={a.name}>{a.name}</strong>
            <small>{a.sourceKind==="live"?"SingMotion":a.sourceKind==="uploaded"?"Uploaded video":"Generated video"}</small>
            <div className="mv-media-role" role="group" aria-label={"Role of "+a.name}>
              <button type="button" className={a.role==="lip-sync"?"active":""} aria-pressed={a.role==="lip-sync"} disabled={importing} onClick={()=>void changeAssetRole(a,"lip-sync")}><Music2 size={13}/> Lip Sync</button>
              <button type="button" className={a.role==="b-roll"?"active":""} aria-pressed={a.role==="b-roll"} disabled={importing} onClick={()=>void changeAssetRole(a,"b-roll")}><Film size={13}/> B-Roll</button>
            </div>
            {roleChanging===a.id?<small role="status">Saving role…</small>:a.sourceStartMs!==null&&a.sourceEndMs!==null?<small className="mv-source-time">Source: {time(a.sourceStartMs,true)} – {time(a.sourceEndMs,true)}</small>:null}
            <div className="mv-media-actions"><button disabled={importing} onClick={()=>addClip(a,a.role==="lip-sync"?1:2,playhead)}><Plus size={14}/> Add to timeline</button>
              <details onToggle={e=>{
                const menu=e.currentTarget;if(!menu.open)return;
                const anchor=menu.querySelector("summary"),panel=menu.querySelector<HTMLDivElement>(".mv-library-menu");if(!anchor||!panel)return;
                const r=anchor.getBoundingClientRect(),w=panel.offsetWidth,h=panel.offsetHeight,margin=8;
                panel.style.left=Math.max(margin,Math.min(r.right-w,window.innerWidth-w-margin))+"px";
                panel.style.top=Math.max(margin,Math.min(r.bottom+5+h<=window.innerHeight-margin?r.bottom+5:r.top-h-5,window.innerHeight-h-margin))+"px";
              }}><summary aria-label={"Options for "+a.name}><MoreHorizontal size={17}/></summary>
                <div className="mv-library-menu" onClick={e=>{if((e.target as HTMLElement).closest("button,a")){const menu=e.currentTarget.closest("details");if(menu)menu.open=false;}}}>
                  <button type="button" onClick={()=>addClip(a,1,playhead)}><Mic size={14}/> Add to Lip-Sync</button>
                  <button type="button" onClick={()=>addClip(a,2,playhead)}><Video size={14}/> Add to Video</button>
                  <a href={endpoint+id+"/assets/"+a.id+"?download=1"} download><Download size={14}/> Download video</a>
                  <button type="button" onClick={()=>void deleteAsset(a)}><Trash2 size={14}/> Remove from Library</button>
                </div>
              </details></div>
          </div></article>)}</div>:<p className="mv-empty-library">{assets.length?"No matching videos. Try another search or filter.":"No videos in this Library. Import a video or use Add to Project from Videos."}</p>}
      </div>}
    </section>
    {exportJob?.state==="ready"&&!exportOpen&&<div className="mv-export-toast" role="status"><Check size={20}/><div><strong>MP4 ready{exportJob.resolution?" · "+Math.min(exportJob.resolution.width,exportJob.resolution.height)+"p":""}</strong><small>Download requested. <a href={endpoint+id+"/export/"+exportJob.id+"?download=1"} download>Download again</a></small></div><button type="button" aria-label="Dismiss export notice" onClick={()=>setExportJob(null)}><X size={17}/></button></div>}
    {exportOpen&&<div className="mv-dialog-backdrop"><div className="mv-dialog mv-export-dialog" role="dialog" aria-modal="true" aria-label="Export MP4"><div className="mv-export-symbol"><Download size={32}/></div><h2>{exportError?"Export failed":"Exporting your video…"}</h2><p>{exportError||(exportJob?.resolution?"Preparing "+Math.min(exportJob.resolution.width,exportJob.resolution.height)+"p MP4 for download.":"Checking source resolution…")}</p>{!exportError&&<><div className="mv-export-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={exportJob?.progress??0}><span style={{width:(exportJob?.progress??0)+"%"}}/></div><strong>{exportJob?.progress??0}%</strong></>}{!exporting&&<button className="mv-outline" onClick={()=>setExportOpen(false)}>Close</button>}</div></div>}
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
