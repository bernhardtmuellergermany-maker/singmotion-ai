"use client";
import {PROJECT_VIDEO_MAX_BYTES,PROJECT_VIDEO_MAX_MIB} from "../lib/music-video/media-limits";
import {memo,useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from "react";
import Link from "next/link";
import {createPortal} from "react-dom";
import {ChevronDown,ChevronRight,Check,Film,Lock,Unlock,Video,Mic,Eye,EyeOff,
  Maximize,Minus,MoreHorizontal,Music2,Pause,Pencil,Play,Plus,Redo2,Scissors,
  Search,Trash2,Undo2,Upload,Download,X,Volume2,VolumeX,RefreshCw,ArrowUpDown,Magnet,ZoomIn,ZoomOut,AudioLines,Info,ListFilter} from "lucide-react";
import {ensureSession} from "@/lib/client";
import {FramePreviewEngine} from "@/lib/music-video/frame-preview-engine";
import {makeFrameTimeline} from "@/lib/music-video/frame-timeline";
import {MIN_TIMELINE_ZOOM,MAX_TIMELINE_ZOOM,clampTimelineZoom,timelineFitZoom,anchoredScroll,timelineGraduations,swipeVelocity,inertiaStep} from "@/lib/music-video/timeline-gestures";
import {validWaveform,waveformShape,timelineWaveformBars,type MediaWaveform} from "@/lib/music-video/waveform";
import type {MusicAsset,MusicClip,MusicProject,Track,MediaRole,AudioTrack,TrackMutes,ProjectAspectRatio} from "@/lib/music-video/core";
import {parseSongTime,validSongRange,moveSongEdge,validSongPlacement,trimSongPlacement,shiftLockedClips,songOffset,songTimelineEnd,MAX_TIMELINE_MS,songTimeToTimeline,timelineToSongTime,parseRelativeSongTime,positionVideoClip,trimVideoClip,planSourceTimeInsertion,rollVideoBoundary,transferVideoClip,splitVideoAtPlayhead,snapPlayhead,timelineProgress,setVideoEnd,MEDIA_HOLD_MS,mediaPanAxis,effectiveSongParts,validSongParts,splitSongPart,songPartsEnd,removeLeadingSongPart,firstVisibleVideo,aspectFromDimensions,type SongRange,type SongPlacement} from "@/lib/music-video/song-range";
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
  if(response.status===401||response.status===403)throw new Error("Project access expired or unavailable. Sign in again with the same account, then retry. Unsaved edits are not yet stored.");
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
const SongWaveform=memo(function SongWaveform({wave,sourceInMs,sourceOutMs,width,bars=false,timelineStartMs=0,gridMs=100}:{wave?:MediaWaveform|null;sourceInMs:number;sourceOutMs:number;width:number;bars?:boolean;timelineStartMs?:number;gridMs?:number}){
  const shape=wave?(bars?timelineWaveformBars(wave,sourceInMs,sourceOutMs,timelineStartMs,gridMs):waveformShape(wave,sourceInMs,sourceOutMs,width)):"";
  return <div className={"mv-clip-waveform"+(bars?" mv-waveform-bars":"")} aria-hidden="true" data-waveform={wave?(wave.hasAudio?"ready":"silent"):"pending"}>
    {wave?.hasAudio&&<svg viewBox="0 0 1000 100" preserveAspectRatio="none" focusable="false">
      {!bars&&<path className="mv-wave-center" d="M0 50H1000"/>}
      {shape&&<path className="mv-wave-shape" d={shape}/>}
    </svg>}
  </div>;
});
export function MusicVideoEditor({id}:{id:string}){
  const [detail,setDetail]=useState<Detail|null>(null),[clips,setClips]=useState<MusicClip[]>([]);
  const [aspectRatio,setAspectRatio]=useState<ProjectAspectRatio>("auto"),ratioRef=useRef<ProjectAspectRatio>("auto");
  const [autoFormat,setAutoFormat]=useState<{assetId:string;ratio:"9:16"|"16:9"}|null>(null);
  const [trackMutes,setTrackMutes]=useState<TrackMutes>(initialMutes),mutesRef=useRef<TrackMutes>(initialMutes);
  const frameCanvas=useRef<HTMLCanvasElement>(null);
  const engine=useRef<FramePreviewEngine<MusicClip>|null>(null);
  const trimmingVideo=useRef(false);
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
  const minimumZoomRef=useRef(MIN_TIMELINE_ZOOM);
  const zoomRef=useRef(44),pendingZoomScroll=useRef<number|null>(null),inertiaFrame=useRef(0);
  const stopInertia=useCallback(()=>{cancelAnimationFrame(inertiaFrame.current);inertiaFrame.current=0;},[]);
  useEffect(()=>()=>stopInertia(),[stopInertia]);
  function glide(scroller:HTMLDivElement,velocity:number){
    stopInertia();
    if(Math.abs(velocity)<.08||window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;
    const start=performance.now();let last=start,position=scroller.scrollLeft;
    const tick=(now:number)=>{
      const step=inertiaStep(velocity,now-last);last=now;velocity=step.velocity;position+=step.delta;
      const max=Math.max(0,scroller.scrollWidth-scroller.clientWidth);
      scroller.scrollLeft=Math.max(0,Math.min(max,position));
      if(now-start<650&&Math.abs(velocity)>.035&&position>0&&position<max)inertiaFrame.current=requestAnimationFrame(tick);
      else inertiaFrame.current=0;
    };
    inertiaFrame.current=requestAnimationFrame(tick);
  }
  const applyZoom=useCallback((value:number,anchorMs:number,viewportX:number)=>{
    const el=scroll.current;if(!el)return;
    const next=Math.max(minimumZoomRef.current,clampTimelineZoom(value)),left=anchoredScroll(anchorMs,next,viewportX);
    stopInertia();
    if(next===zoomRef.current&&pendingZoomScroll.current===null){el.scrollLeft=left;return;}
    zoomRef.current=next;pendingZoomScroll.current=left;setZoom(next);
  },[stopInertia]);
  useLayoutEffect(()=>{if(pendingZoomScroll.current!==null&&scroll.current){scroll.current.scrollLeft=pendingZoomScroll.current;pendingZoomScroll.current=null;}},[zoom]);
  function zoomBy(factor:number){
    const el=scroll.current;if(!el)return;
    const x=el.clientWidth/2;applyZoom(zoomRef.current*factor,(el.scrollLeft+x)*1000/zoomRef.current,x);
  }
  const [libraryOpen,setLibraryOpen]=useState(false),[filter,setFilter]=useState<"All"|"Lip Sync"|"B-Roll"|"AI Video"|"Uploads">("All");
  const [search,setSearch]=useState("");
  const [librarySort,setLibrarySort]=useState<"newest"|"oldest"|"source">("newest"),[libraryRefreshing,setLibraryRefreshing]=useState(false);
  const [libraryPreview,setLibraryPreview]=useState<MusicAsset|null>(null),[libraryPreviewError,setLibraryPreviewError]=useState(false);
  const libraryPreviewDialog=useRef<HTMLDialogElement>(null);
  useLayoutEffect(()=>{
    if(!libraryPreview)return;
    const dialog=libraryPreviewDialog.current;
    if(dialog&&!dialog.open)dialog.showModal();
  },[libraryPreview]);
  const [assetRename,setAssetRename]=useState<{id:string;name:string}|null>(null);
  const [error,setError]=useState(""),[status,setStatus]=useState("Saved");
  const [placementNotice,setPlacementNotice]=useState("");
  const [lipTrack,setLipTrack]=useState<Track|null>(null),[lipSources,setLipSources]=useState<LipSyncSource[]>([]);
  const [lipLoading,setLipLoading]=useState(false),[lipSearch,setLipSearch]=useState(""),[lipError,setLipError]=useState("");
  const [importing,setImporting]=useState(false);
  const importBusy=useRef(false),roleBusy=useRef(false);
  const lipBackdrop=useRef<HTMLDivElement>(null),lipDialog=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    if(lipTrack===null)return;
    const backdrop=lipBackdrop.current,dialog=lipDialog.current;
    if(!backdrop||!dialog)return;
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const viewport=window.visualViewport;
    // The portal escapes transformed/scrolled editor ancestors. Follow the
    // actual visible viewport during zoom and on-screen keyboard changes.
    const fit=()=>{
      if(!viewport)return;
      Object.assign(backdrop.style,{left:viewport.offsetLeft+"px",top:viewport.offsetTop+"px",
        width:viewport.width+"px",height:viewport.height+"px"});
    };
    fit();viewport?.addEventListener("resize",fit);viewport?.addEventListener("scroll",fit);
    dialog.focus({preventScroll:true});
    const key=(event:KeyboardEvent)=>{
      if(event.key==="Escape"&&!importBusy.current){event.preventDefault();setLipTrack(null);}
      if(event.key==="Tab"){
        const items=Array.from(dialog.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled)"));
        const first=items[0],last=items.at(-1);
        if(!first||!last)return;
        if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog)){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
      }
    };
    dialog.addEventListener("keydown",key);
    return()=>{viewport?.removeEventListener("resize",fit);viewport?.removeEventListener("scroll",fit);
      dialog.removeEventListener("keydown",key);if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[lipTrack]);
  const [exportJob,setExportJob]=useState<ExportJob|null>(null),[exportError,setExportError]=useState(""),[exportOpen,setExportOpen]=useState(false),[exporting,setExporting]=useState(false);
  const exportAbort=useRef<AbortController|null>(null),exportBusy=useRef(false);
  useEffect(()=>()=>exportAbort.current?.abort(),[]);
  const [inspectorOpen,setInspectorOpen]=useState(true);
  const [roleChanging,setRoleChanging]=useState<string|null>(null),[roleError,setRoleError]=useState("");
  const [wave,setWave]=useState<MediaWaveform|null>(null),[editingName,setEditingName]=useState(false),[newName,setNewName]=useState("");
  const [videoWaves,setVideoWaves]=useState<Record<string,MediaWaveform>>({});
  const waveCache=useRef<{id:string;items:Record<string,MediaWaveform>}>({id,items:{}});
  const waveAssetKey=useMemo(()=>[...new Set(clips.map(c=>c.assetId))].sort().join(","),[clips]);
  const scroll=useRef<HTMLDivElement>(null),fileInput=useRef<HTMLInputElement>(null);
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
    engine.current?.pause();setBuffering(false);playingRef.current=false;setPlaying(false);
    const at=Math.min(playheadRef.current,songPartsEnd(range,partsRef.current));
    playheadRef.current=at;setPlayhead(at);
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

  // Only compact server-derived peaks; no extra audio/video decoding on the phone.
  // One client request at a time, shared cache across trims, splits, moves and zoom.
  useEffect(()=>{
    if(detail?.project.id!==id)return;
    const controller=new AbortController();
    if(waveCache.current.id!==id){waveCache.current={id,items:{}};setVideoWaves({});setWave(null);}
    const cache=waveCache.current.items;
    const ids=["song",...waveAssetKey.split(",").filter(Boolean)];
    async function loadWaves(){
      for(const key of ids){
        if(controller.signal.aborted)return;
        if(cache[key])continue;
        for(let attempt=0;attempt<3&&!controller.signal.aborted;attempt++){
          try{
            const data=await request<MediaWaveform>(endpoint+id+"/waveform"+(key==="song"?"":"/"+encodeURIComponent(key)),{signal:controller.signal});
            if(controller.signal.aborted)return;
            if(!validWaveform(data))break;
            cache[key]=data;
            if(key==="song")setWave(data);else setVideoWaves(previous=>({...previous,[key]:data}));
            break;
          }catch{
            if(attempt<2&&!controller.signal.aborted)await new Promise(resolve=>setTimeout(resolve,2000*(attempt+1)));
          }
        }
      }
    }
    void loadWaves();
    return()=>controller.abort();
  },[id,detail?.project.id,waveAssetKey]);
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
  useEffect(()=>{
    const protect=(e:BeforeUnloadEvent)=>{if(dirty.current){e.preventDefault();e.returnValue="";}};
    window.addEventListener("beforeunload",protect);
    return()=>{window.removeEventListener("beforeunload",protect);if(saveTimer.current)clearTimeout(saveTimer.current);};
  },[]);
  function apply(next:MusicClip[],record=true,range=rangeRef.current,parts=partsRef.current,mutes=mutesRef.current,ratio=ratioRef.current){
    if(roleBusy.current)return;
    engine.current?.clearTrimPreview();
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
    latest.current=next;setClips(next);setError("");setPlacementNotice("");queue();
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
  function changePreviewVolume(value:number){
    const next=Math.max(0,Math.min(100,value));volumeRef.current=next;setPreviewVolume(next);engine.current?.setVolume(next/100);
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
    if(!moved){displaySong(original);setClips(latest.current);setError("Cannot move the song: a position-locked Lip Sync clip must stay fixed, or a sync-locked clip would overlap or leave the timeline. Unlock the affected clip first.");return;}
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
  function beginMediaGesture(e:React.PointerEvent,media:string,onHold:()=>void,onTap:()=>void,allowHold=true){
    if(e.button!==0||!e.isPrimary||importBusy.current)return;
    e.preventDefault();e.stopPropagation();
    // A new primary press supersedes an abandoned hold (e.g. OS touch cancel).
    gestureCleanup.current?.();
    stopInertia();
    if(e.pointerType==="mouse"&&allowHold){setArmedMedia(media);onHold();return;}
    const pointer=e.pointerId,x=e.clientX,y=e.clientY;
    const scroller=scroll.current,startScroll=scroller?.scrollLeft??0,startY=window.scrollY;
    let axis:"x"|"y"|null=null,velocity=0,lastScroll=startScroll,lastMove=performance.now();
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
      if(axis==="x"&&scroller){scroller.scrollLeft=startScroll-dx;const now=performance.now(),delta=scroller.scrollLeft-lastScroll;if(delta){velocity=swipeVelocity(velocity,delta,Math.max(1,now-lastMove));lastMove=now;lastScroll=scroller.scrollLeft;}}
      if(axis==="y")window.scrollTo(0,startY-dy);
    };
    const up=(event:PointerEvent)=>{if(event.pointerId!==pointer)return;move(event);cleanup();if(!axis)onTap();else if(axis==="x"&&scroller&&performance.now()-lastMove<110)glide(scroller,velocity);};
    const cancel=(event:PointerEvent)=>{if(event.pointerId===pointer)cleanup();};
    const timer=setTimeout(()=>{if(axis||!allowHold)return;cleanup();if(importBusy.current)return;setArmedMedia(media);onHold();},MEDIA_HOLD_MS);
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
  // Capture the second touch before clip dragging or marker scrubbing can
  // interpret it as a new edit. Cancel the first gesture, then preserve the
  // timeline time under the moving midpoint until both fingers are lifted.
  useEffect(()=>{
    const el=scroll.current,tracks=tracksRef.current;if(!el||!tracks)return;
    const touches=new Map<number,{x:number;y:number;target:Element}>();
    let pinch:{distance:number;zoom:number;anchorMs:number}|null=null,blocking=false,cancelling=false;
    const geometry=()=>{const [a,b]=[...touches.values()];return {distance:Math.max(12,Math.hypot(a.x-b.x,a.y-b.y)),x:(a.x+b.x)/2-el.getBoundingClientRect().left};};
    const consume=(event:PointerEvent)=>{event.preventDefault();event.stopImmediatePropagation();};
    const down=(event:PointerEvent)=>{
      if(!(event.target instanceof Element)||!tracks.contains(event.target))return;
      stopInertia();
      if(event.pointerType!=="touch"||(!el.contains(event.target)&&!event.target.closest(".mv-playhead-grip")))return;
      touches.set(event.pointerId,{x:event.clientX,y:event.clientY,target:event.target});
      if(touches.size===2&&!blocking){
        blocking=true;
        const first=[...touches.entries()][0];
        cancelling=true;
        first[1].target.dispatchEvent(new PointerEvent("pointercancel",{bubbles:true,pointerId:first[0],pointerType:"touch",isPrimary:true}));
        cancelling=false;gestureCleanup.current?.();
        const g=geometry();
        pinch={distance:g.distance,zoom:zoomRef.current,anchorMs:(el.scrollLeft+g.x)*1000/zoomRef.current};
      }
      if(blocking){consume(event);try{el.setPointerCapture(event.pointerId);}catch{}}
    };
    const move=(event:PointerEvent)=>{
      const touch=touches.get(event.pointerId);if(!touch)return;
      touch.x=event.clientX;touch.y=event.clientY;
      if(!blocking)return;consume(event);
      if(pinch&&touches.size>=2){const g=geometry();applyZoom(pinch.zoom*g.distance/pinch.distance,pinch.anchorMs,g.x);}
    };
    const end=(event:PointerEvent)=>{
      if(cancelling||!touches.has(event.pointerId))return;
      touches.delete(event.pointerId);
      if(blocking){consume(event);if(touches.size<2)pinch=null;if(!touches.size)blocking=false;}
    };
    document.addEventListener("pointerdown",down,true);
    document.addEventListener("pointermove",move,{capture:true,passive:false});
    document.addEventListener("pointerup",end,true);
    document.addEventListener("pointercancel",end,true);
    el.addEventListener("wheel",stopInertia,{passive:true});
    return()=>{stopInertia();document.removeEventListener("pointerdown",down,true);document.removeEventListener("pointermove",move,true);document.removeEventListener("pointerup",end,true);document.removeEventListener("pointercancel",end,true);el.removeEventListener("wheel",stopInertia);};
  },[project?.id,applyZoom,stopInertia]);
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
  const minimumZoom=timelineFitZoom(timelineLimit,rulerViewport.width);
  // Follow the viewport while fitted, but preserve intentional closer zoom.
  // Only display scale changes; editable duration and media times stay exact.
  useLayoutEffect(()=>{
    const previous=minimumZoomRef.current;
    minimumZoomRef.current=minimumZoom;
    if(zoomRef.current<minimumZoom||(minimumZoom!==previous&&zoomRef.current<=previous)){
      applyZoom(minimumZoom,0,0);
    }
  },[minimumZoom,applyZoom]);
  const waveformGridMs=Math.max(4000/zoom,timelineLimit/1200);
  // Source trim can be extended again, but never displays unused source duration.
  const songPlacementLimit=project?Math.min(MAX_TIMELINE_MS,Math.max(project.songDurationMs,songTimelineEnd(rangeRef.current))):0;
  const selectedClip=clips.find(c=>c.id===selected&&c.timelineStartMs<timelineEnd);
  const selectedAsset=selectedClip?byId.get(selectedClip.assetId):null;
  const songSelected=selected==="song";
  const hasSelection=songSelected||!!(selectedClip&&selectedAsset);
  function clearSelection(){setSelected(null);setArmedMedia(null);}
  function selectSong(){setSelected("song");setInspectorOpen(true);}
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
    if(i===0){
      const next=removeLeadingSongPart(rangeRef.current,partsRef.current,latest.current);
      if(!next)return;
      const at=Math.max(0,playheadRef.current-next.shiftMs);
      apply(next.clips,true,next.range,next.parts);setPartIndex(0);setAt(at,next.range);
      return;
    }
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
    if(current.positionLocked){setError("Unlock the clip position before editing it.");return;}
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
    if(current.positionLocked){setError("Unlock the clip position before moving it.");return;}
    if(position+current.sourceOutMs-current.sourceInMs>timelineLimit){setError("The video must fit within the song.");return;}
    const result=restore?positionVideoClip(latest.current,{...current,syncLocked:false},position):positionVideoClip(latest.current,current,position);
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
  // Keep the committed playback timeline and its decoders stable during a trim gesture.
  const previewClips=trimmingVideo.current?latest.current:clips;
  const frameTimeline=useMemo(()=>makeFrameTimeline(previewClips,songRange,songParts,trackMutes),[previewClips,songRange,songParts,trackMutes]);
  useLayoutEffect(()=>{
    if(!project?.id||!frameCanvas.current)return;
    let disposed=false;
    const sameOrigin=(path:string)=>new URL(path,window.location.origin).href;
    const resolveSource=async(assetId:string,signal:AbortSignal)=>{
      if(assetId==="song")return sameOrigin(endpoint+id+"/song");
      // Always use the existing hardware-compatible, bounded proxy, not a 250MB original.
      const path=endpoint+id+"/preview/"+encodeURIComponent(assetId)+"?mobile=1";
      for(let attempt=0;attempt<24;attempt++){
          signal.throwIfAborted();
          const data=await request<{ready:boolean;unsupported?:boolean}>(path,{method:"POST",signal});
          if(data.ready)return sameOrigin(path);
          if(data.unsupported)throw Error("This clip exceeds the preview length limit.");
          await new Promise<void>(resolve=>setTimeout(resolve,750));
      }
      throw Error("Video preview is still preparing. Tap Play to retry.");
    };
    try{
      const instance=new FramePreviewEngine<MusicClip>(frameCanvas.current,resolveSource,{
        position:at=>{if(disposed)return;const ms=Math.floor(at);playheadRef.current=ms;setPlayhead(ms);setMarkerText(time(ms,true));
          const viewport=viewportRef.current,x=ms/1000*viewport.zoom,viewX=x-viewport.scrollLeft;
          if(playheadLine.current)playheadLine.current.style.left=x+"px";
          if(playheadGrip.current){playheadGrip.current.style.left=(viewport.left+viewX)+"px";playheadGrip.current.style.visibility=viewport.width>0&&viewX>=-.5&&viewX<=viewport.width+.5?"visible":"hidden";}
        },
        playing:value=>{if(!disposed){playingRef.current=value;setPlaying(value);}},
        buffering:value=>{if(!disposed)setBuffering(value);},
        error:message=>{if(!disposed)setError(message);}
      });
      instance.setVolume(volumeRef.current/100);engine.current=instance;
      return()=>{disposed=true;instance.close();if(engine.current===instance)engine.current=null;};
    }catch(e){setError(e instanceof Error?e.message:"Frame preview unavailable.");}
  },[id,project?.id]);
  useLayoutEffect(()=>{
    if(!project?.id||!engine.current)return;
    const mobile=window.matchMedia("(pointer: coarse)").matches||/iPhone|iPad|Android|Mobile/i.test(navigator.userAgent);
    const short=mobile?360:480,long=mobile?640:854;
    engine.current.setTimeline(frameTimeline,previewRatio==="9:16"?short:long,previewRatio==="9:16"?long:short,playheadRef.current);
  },[id,project?.id,frameTimeline,previewRatio]);
  const progress=timelineProgress(playhead,timelineEnd);
  const markerViewportX=progress.positionMs/1000*zoom-rulerViewport.scrollLeft;
  const markerVisible=rulerViewport.width>0&&markerViewportX>=-0.5&&markerViewportX<=rulerViewport.width+0.5;
  useLayoutEffect(()=>{viewportRef.current={zoom,...rulerViewport};},[zoom,rulerViewport]);
  // The last audible song part is the only end of the editable project.
  const pixels=Math.max(rulerViewport.width,project?Math.max(1,timelineLimit/1000*zoom):640);
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
    if(locked){
      // Use the current refs: importing can reload the project before React rerenders.
      const limit=songPartsEnd(rangeRef.current,partsRef.current);
      const plan=planSourceTimeInsertion(latest.current,candidate,limit,atMs);
      if(!plan){setError("Not enough space for the video at its source start (at least 5 seconds, or the actual length if shorter). Unlock or shorten neighboring clips, or extend the song.");return;}
      apply(plan.clips);setSelected(plan.clip.id);
      if(plan.mode==="cut")setPlacementNotice("Inserted from the original source start and shortened neighboring clips. Drag the edges to adjust the transition. Undo restores the previous edit.");
      if(plan.mode==="manual")setPlacementNotice("Original source start is outside the available song range. Inserted from the beginning of the video in a free space, unlocked for manual alignment.");
      if(plan.mode==="alternate")setPlacementNotice("Inserted at the original source time on the other video track.");
      return;
    }
    if(candidate.timelineStartMs<0){setError("The video starts before the timeline.");return;}
    if(clipEnd(candidate)>timelineLimit)candidate.sourceOutMs=Math.max(0,timelineLimit-candidate.timelineStartMs);
    if(candidate.sourceOutMs-candidate.sourceInMs<Math.min(5000,length)){setError("Not enough space for at least 5 seconds of this video before the song ends.");return;}
    let conflicts=overlaps(latest.current,candidate);
    if(conflicts.length){
      const action=window.prompt("Track occupied. Type 'free' to find another space, 'fit' to trim into the available gap, 'replace' to remove conflicting clips, or Cancel.","free");
      if(action===null)return;
      if(action==="replace"){
        if(conflicts.some(c=>c.positionLocked)){setError("Unlock the conflicting video before replacing it.");return;}
        if(!window.confirm("Replace "+conflicts.length+" existing timeline clip(s)? Media will remain in the Library."))return;
        apply([...latest.current.filter(c=>!conflicts.some(o=>o.id===c.id)),candidate]);
        setSelected(candidate.id);return;
      }
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
        if(candidate.sourceOutMs-candidate.sourceInMs<Math.min(5000,length)){setError("Not enough free space for at least 5 seconds of this video.");return;}
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
  function sourceLimit(clip:MusicClip,asset:MusicAsset){
    return clip.syncLocked&&asset.sourceStartMs!==null&&asset.sourceEndMs!==null
      ?Math.min(asset.durationMs,asset.sourceEndMs-asset.sourceStartMs):asset.durationMs;
  }
  function showTrimFrame(clip:MusicClip,edge:"start"|"end"){
    const sourceMs=edge==="start"?clip.sourceInMs:Math.max(clip.sourceInMs,clip.sourceOutMs-1);
    engine.current?.previewTrimFrame(clip.assetId,sourceMs);
  }
  function finishTrimFrame(clip:MusicClip,edge:"start"|"end"){
    const at=edge==="start"?clip.timelineStartMs:Math.max(clip.timelineStartMs,clipEnd(clip)-1);
    setAt(at);showTrimFrame(clip,edge);
  }
  function keyboardTrim(e:React.KeyboardEvent<HTMLButtonElement>,clip:MusicClip,edge:"start"|"end"){
    if(e.key!=="ArrowLeft"&&e.key!=="ArrowRight")return;
    e.preventDefault();e.stopPropagation();
    if(importBusy.current)return;
    const current=latest.current.find(c=>c.id===clip.id),asset=byId.get(clip.assetId);
    if(!current||!asset||current.positionLocked)return;
    const next=trimVideoClip(latest.current,current,edge,(e.key==="ArrowLeft"?-1:1)*(e.shiftKey?100:1),sourceLimit(current,asset),timelineLimit);
    commitVideoEdit(current,next);finishTrimFrame(next,edge);
  }
  function movePointer(e:React.PointerEvent,clip:MusicClip,edge:"start"|"end"|"move"){
    if(e.button!==0||importBusy.current)return;
    const asset=byId.get(clip.assetId),initial=latest.current.find(c=>c.id===clip.id);
    if(!asset||!initial||!project||initial.positionLocked)return;
    e.stopPropagation();e.preventDefault();
    selectVideo(clip.id);setError("");stopPlayback();
    if(edge!=="move"){trimmingVideo.current=true;showTrimFrame(initial,edge);}else engine.current?.clearTrimPreview();
    const startX=e.clientX,startY=e.clientY,pointer=e.pointerId,startScroll=scroll.current?.scrollLeft??0;
    const startClips=latest.current;
    let dragged=false;
    let next=initial,valid=true,rolled:MusicClip[]|null=null;
    const calculate=(event:PointerEvent)=>{
      const dx=event.clientX-startX+(scroll.current?.scrollLeft??0)-startScroll;
      const dy=event.clientY-startY;
      if(Math.abs(dx)>2||Math.abs(dy)>2)dragged=true;
      if(!dragged)return;
      const delta=Math.round(dx/zoom*1000);
      valid=true;rolled=null;
      if(edge==="move"){
        const track=([1,2] as const).find(t=>{const rect=videoLanes.current[t]?.getBoundingClientRect();return !!rect&&event.clientY>=rect.top&&event.clientY<rect.bottom;});
        if(track===undefined){valid=false;setDragTrack(null);setDragBlocked(false);setClips(startClips);return;}
        if(initial.syncLocked&&Math.abs(dx)>3){setError("Sync Lock is active. Tap the clip padlock to unlock before moving horizontally.");}
        const position=initial.syncLocked||Math.abs(dx)<=3?initial.timelineStartMs:
          Math.max(0,Math.min(timelineLimit-(initial.sourceOutMs-initial.sourceInMs),Math.max(0,snapped(initial.timelineStartMs+delta,initial))));
        const result=transferVideoClip(startClips,initial,track,position);
        valid=result.status==="ok"&&clipEnd(result.clip)<=timelineLimit;setDragTrack(track);setDragBlocked(!valid);
        next=valid&&result.status==="ok"?result.clip:initial;
      }else{
        rolled=rollVideoBoundary(startClips,initial,edge,delta,c=>{const a=byId.get(c.assetId);return a?sourceLimit(c,a):c.sourceOutMs;});
        next=rolled?.find(c=>c.id===initial.id)??trimVideoClip(startClips,initial,edge,delta,sourceLimit(initial,asset),timelineLimit);
        showTrimFrame(next,edge);
      }
      setClips(rolled??startClips.map(c=>c.id===next.id?next:c));
    };
    const update=(event:PointerEvent)=>{if(event.pointerId===pointer)calculate(event);};
    const cleanup=()=>{
      document.removeEventListener("pointermove",update);document.removeEventListener("pointerup",finish);document.removeEventListener("pointercancel",cancel);
      setDragTrack(null);setDragBlocked(false);setArmedMedia(null);
    };
    const finish=(event:PointerEvent)=>{
      if(event.pointerId!==pointer)return;
      calculate(event);cleanup();trimmingVideo.current=false;
      if(!valid){setClips(startClips);setError("Drop onto a free position on Video 1 or Video 2. The video was not moved.");return;}
      if(rolled){if(JSON.stringify(rolled)!==JSON.stringify(startClips))apply(rolled);else setClips(latest.current);setSelected(initial.id);stopPlayback();setAt(Math.min(playheadRef.current,timelineLimit));}
      else commitVideoEdit(initial,next);
      if(edge!=="move")finishTrimFrame(next,edge);
    };
    const cancel=(event:PointerEvent)=>{if(event.pointerId!==pointer)return;cleanup();trimmingVideo.current=false;setClips(startClips);if(edge!=="move"){engine.current?.clearTrimPreview();setAt(playheadRef.current);}};
    document.addEventListener("pointermove",update);document.addEventListener("pointerup",finish);document.addEventListener("pointercancel",cancel);
  }
  function split(){
    if(importBusy.current||!selectedClip)return;
    const current=latest.current.find(c=>c.id===selectedClip.id);
    if(!current||current.positionLocked)return;
    const parts=splitVideoAtPlayhead(current,playheadRef.current,uuid());
    if(!parts){setError("Place the playhead at least 100 ms inside the selected video.");return;}
    if(latest.current.length>=500){setError("The timeline supports up to 500 clips.");return;}
    stopPlayback();apply([...latest.current.filter(c=>c.id!==current.id),...parts]);setSelected(parts[1].id);
  }
  function deleteClip(){
    if(importBusy.current||roleBusy.current)return;
    if(!selectedClip||selectedClip.positionLocked)return;apply(latest.current.filter(c=>c.id!==selectedClip.id));setSelected(null);
  }
  // Delete is scoped to this editor; never consume text editing or modal keys.
  useEffect(()=>{
    const onDelete=(e:KeyboardEvent)=>{
      if(e.key!=="Delete"||e.defaultPrevented||e.repeat||e.ctrlKey||e.metaKey||e.altKey||e.shiftKey||importBusy.current||exportOpen||lipTrack!==null||libraryPreview)return;
      const target=e.target;
      if(target instanceof Element&&(target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="dialog"],details[open]')||(!target.closest(".mv-editor")&&target!==document.body)))return;
      if(songSelected){if(!partsRef.current||partsRef.current.length<2)return;e.preventDefault();removeSongPart();}
      else if(selectedClip&&!selectedClip.positionLocked){e.preventDefault();deleteClip();}
    };
    document.addEventListener("keydown",onDelete);
    return()=>document.removeEventListener("keydown",onDelete);
  });
  function clipControlPointer(e:React.PointerEvent<HTMLButtonElement>,clip:MusicClip,action:()=>void){
    e.stopPropagation();
    if(e.pointerType!=="touch")return;
    // Chromium may expand a nearby icon's touch target. A tap still activates
    // the icon, while holding it can move an unlocked clip, just like its body.
    beginMediaGesture(e,clip.id,()=>movePointer(e,clip,"move"),action,!clip.positionLocked);
  }
  function clipControlClick(e:React.MouseEvent<HTMLButtonElement>,action:()=>void){
    e.stopPropagation();
    // Touch activation is handled on pointer-up by beginMediaGesture.
    // Mouse and keyboard activation retain the native button behavior.
    if((e.nativeEvent as PointerEvent).pointerType==="touch")return;
    action();
  }
  function toggleClipDisplay(id:string){
    if(importBusy.current||roleBusy.current)return;
    const current=latest.current.find(c=>c.id===id);if(!current)return;
    apply(latest.current.map(c=>c.id===id?{...c,showVideoName:!current.showVideoName}:c));
  }
  function togglePositionLock(id:string){
    if(importBusy.current||roleBusy.current)return;
    const current=latest.current.find(c=>c.id===id);if(!current)return;
    // The clip padlock must reflect both kinds of movement protection.
    // An explicit unlock also releases Sync Lock immediately.
    const locked=!!(current.positionLocked||current.syncLocked);
    apply(latest.current.map(c=>c.id===current.id?{...c,positionLocked:!locked,syncLocked:locked?false:c.syncLocked}:c));
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
    if(latest.current.some(c=>c.assetId===a.id&&c.positionLocked)){setError("Unlock the clips using this video before changing its role.");return;}
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
    if(latest.current.some(c=>c.assetId===a.id&&c.positionLocked)){setError("Unlock the clips using this video before removing it.");return;}
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
    engine.current?.pause();playingRef.current=false;setPlaying(false);setBuffering(false);
  }
  function setAt(ms:number,_range=rangeRef.current){
    ms=Math.round(ms);playheadRef.current=ms;setPlayhead(ms);setMarkerText(time(ms,true));engine.current?.seek(ms);
  }
  function seek(ms:number){
    if(!project)return;
    seekTransport(Math.max(0,Math.min(timelineEnd,ms)));
  }
  // Seeking changes the position, not the user's play/pause intent.
  function seekTransport(ms:number){setAt(ms);}
  function submitMarker(){
    const ms=parseSongTime(markerText);
    if(ms===null||ms>timelineEnd){setError("Enter a valid timeline time, for example 00:08.918.");return;}
    seek(ms);setMarkerText(time(ms,true));setError("");
  }
  function scrubMarker(e:React.PointerEvent<HTMLElement>,grab=false){
    if(e.button!==0||markerDrag.current||!trackArea.current)return;
    e.preventDefault();e.stopPropagation();
    const left=trackArea.current.getBoundingClientRect().left;
    markerDrag.current={pointer:e.pointerId,offset:grab?e.clientX-left-playheadRef.current/1000*zoom:0};
    e.currentTarget.setPointerCapture(e.pointerId);setScrubbing(true);
    engine.current?.scrub(true);
    if(!grab)updateMarker(e);
  }
  function updateMarker(e:React.PointerEvent<HTMLElement>){
    const drag=markerDrag.current,area=trackArea.current;
    if(!drag||drag.pointer!==e.pointerId||!area)return;
    const raw=(e.clientX-area.getBoundingClientRect().left-drag.offset)/zoom*1000;
    const range=rangeRef.current;
    const markers=[0,timelineEnd,...effectiveSongParts(range,partsRef.current).flatMap(p=>[songTimeToTimeline(p.startMs,range),songTimeToTimeline(p.endMs,range)]),...latest.current.flatMap(c=>[c.timelineStartMs,clipEnd(c)])];
    seekTransport(snapPlayhead(raw,timelineEnd,snap?markers:[],Math.min(150,5/zoom*1000)));
  }
  function releaseMarker(e:React.PointerEvent<HTMLElement>,cancel=false){
    if(markerDrag.current?.pointer!==e.pointerId)return;
    if(!cancel)updateMarker(e);
    markerDrag.current=null;setScrubbing(false);engine.current?.scrub(false);
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
  function togglePlayback(){
    if(playingRef.current){stopPlayback();return;}
    setError("");void engine.current?.play();
  }
  const libraryFilters=["All","Lip Sync","B-Roll","AI Video","Uploads"] as const;
  const matchesLibraryFilter=(a:MusicAsset,filter:typeof libraryFilters[number])=>filter==="All"||filter==="Lip Sync"&&a.role==="lip-sync"||filter==="B-Roll"&&a.role==="b-roll"||filter==="AI Video"&&a.kind==="ai-video"||filter==="Uploads"&&a.kind==="imported";
  const media=useMemo(()=>assets.filter(a=>matchesLibraryFilter(a,filter)&&a.name.toLowerCase().includes(search.trim().toLowerCase())).sort((a,b)=>{
    if(librarySort==="source"){const x=a.sourceStartMs??Infinity,y=b.sourceStartMs??Infinity;return (x===y?0:x-y)||b.createdAt-a.createdAt||a.id.localeCompare(b.id);}
    return (librarySort==="newest"?b.createdAt-a.createdAt:a.createdAt-b.createdAt)||a.id.localeCompare(b.id);
  }),[assets,filter,search,librarySort]);
  const usedAssets=useMemo(()=>new Set(clips.map(c=>c.assetId)),[clips]);
  async function renameProjectAsset(a:MusicAsset){
    if(importBusy.current||!assetRename||assetRename.id!==a.id)return;
    const name=assetRename.name.trim();if(!name||name.length>80)return;
    importBusy.current=true;roleBusy.current=true;setImporting(true);setRoleError("");
    try{
      stopPlayback();if(saveTimer.current)clearTimeout(saveTimer.current);await saveNow();
      const result=await request<Detail>(endpoint+id+"/assets/"+a.id,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,revision:revision.current})});
      revision.current=result.project.revision;detailRef.current=result;latest.current=result.clips;dirty.current=false;
      setDetail(result);setClips(result.clips);setAssetRename(null);setStatus("Saved");
    }catch(e){setRoleError(e instanceof Error?e.message:"Unable to rename video.");}
    finally{importBusy.current=false;roleBusy.current=false;setImporting(false);}
  }
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
  const {step:tickStep,ticks}=timelineGraduations(timelineLimit,zoom,rulerViewport.scrollLeft,rulerViewport.width);
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
    <aside className="mv-experimental-notice mv-experimental-editor" aria-label="Experimental feature"><strong>Experimental · In development</strong><span>Preview and export may change. Keep your original media and download important finished videos.</span></aside>
    <section className="mv-preview" aria-label="Music video preview">
      <div ref={previewBox} className={"mv-video-box"+(previewRatio==="9:16"?" is-portrait":"")}>
        <canvas ref={frameCanvas} className="mv-frame-canvas" data-frame-preview="true" aria-label="Video preview" width={854} height={480}/>
        {!clips.length&&<div className="mv-preview-empty"><Film size={40}/><span>Arrange clips to preview your music video</span></div>}
      </div>
      <div className="mv-format-controls" role="group" aria-label="Project video format">
        <span>Format</span>
        {(["auto","9:16","16:9"] as const).map(ratio=><button key={ratio} type="button" aria-pressed={aspectRatio===ratio} title={ratio==="auto"?"Use the first visible video’s format":ratio==="9:16"?"Portrait":"Landscape"} disabled={importing} onClick={()=>changeAspectRatio(ratio)}>{ratio==="auto"?"Auto":ratio}</button>)}
        {aspectRatio==="auto"&&autoFormat?.assetId===firstAssetId&&<small>{previewRatio}</small>}
      </div>
      <div className="mv-player-controls">
        <button aria-label={playing?"Pause":"Play"} disabled={!timelineEnd} onClick={togglePlayback}>{playing?<Pause size={19}/>:<Play size={19}/>}</button>
        <span className="mv-clock">{time(progress.positionMs,true)} / {time(timelineEnd,true)}</span>
        {buffering&&<span role="status" className="mv-status">Buffering video…</span>}
        <div className="mv-progress-wrap">
          <div className="mv-progress-rail" aria-hidden="true"><span style={{width:progress.percent+"%"}}/></div>
          <input className="mv-progress" aria-label="Seek timeline" aria-valuetext={time(progress.positionMs,true)} type="range" min={0} max={Math.max(1,timelineEnd)} step="1" disabled={timelineEnd===0} value={progress.positionMs} onPointerDown={()=>engine.current?.scrub(true)} onPointerUp={()=>engine.current?.scrub(false)} onPointerCancel={()=>engine.current?.scrub(false)} onBlur={()=>engine.current?.scrub(false)} onChange={e=>seek(Number(e.target.value))}/>
        </div>
        {playerVolumeButton()}
        <button aria-label="Fullscreen" onClick={()=>{const box=document.querySelector(".mv-video-box");void box?.requestFullscreen?.();}}><Maximize size={19}/></button>
      </div>
    </section>
    {volumePopup&&<div ref={volumePanel} id="mv-preview-volume-panel" className="mv-preview-volume-panel" style={{left:volumePopup.left,top:volumePopup.top}}>
      <input type="range" min={0} max={100} step={1} value={previewVolume} aria-label="Preview volume percent" aria-orientation="vertical" aria-valuetext={previewVolume+"%"} onChange={e=>changePreviewVolume(Number(e.target.value))}/>
    </div>}
    <section className="mv-timeline" aria-label="Timeline editor">
      <div className="mv-tracks" ref={tracksRef}>
        <div className="mv-track-labels">
          <div className="mv-label mv-ruler-spacer">
          <form className="mv-marker-time" onSubmit={e=>{e.preventDefault();submitMarker();}}>
            <label title="Playhead time · Enter or checkmark to apply"><input aria-label="Playhead timeline time" enterKeyHint="go" autoComplete="off" spellCheck={false} value={markerText} onFocus={stopPlayback} onChange={e=>setMarkerText(e.target.value)} onKeyDown={e=>{if(e.key==="Escape"){e.preventDefault();setMarkerText(time(playheadRef.current,true));e.currentTarget.blur();}}}/></label>
            <button type="submit" className="mv-marker-confirm" aria-label="Confirm playhead time" title="Confirm playhead time"><Check size={15} aria-hidden="true"/></button>
          </form>
          </div>
          {([2,1] as Track[]).map(track=><div className={"mv-label"+(track===1?" mv-main-label":"")} key={track} title={track===1?"Lip-Sync · Main video track":"Video · Overlay"}>
            {track===1?<Mic size={18}/>:<Video size={18}/>}<strong>{track===1?"Lip-Sync":"Video"}</strong>{muteButton(track,track===1?"Lip-Sync audio":"Video audio")}
          </div>)}
          <div className="mv-label mv-audio-label" title="Song audio"><Music2 size={18}/><strong>Song</strong>{muteButton("song","song")}</div>
        </div>
        <div className="mv-scroll" ref={scroll} onPointerDown={e=>{if(e.target instanceof HTMLElement&&e.target.closest(".mv-lane,.mv-song-lane"))beginMediaGesture(e,"viewport",()=>{},clearSelection,false);}}>
          <div className="mv-track-area" ref={trackArea} style={{width:pixels}}>
            <div className="mv-ruler" style={{overflow:"hidden"}} onPointerDown={e=>scrubMarker(e)} onPointerMove={updateMarker} onPointerUp={e=>releaseMarker(e)} onPointerCancel={e=>releaseMarker(e,true)} onLostPointerCapture={e=>releaseMarker(e,true)}>
              {ticks.map(t=><span key={t.ms} className={t.major?"mv-tick-major":"mv-tick-minor"} aria-hidden={!t.major} style={{left:t.ms/1000*zoom}}>{t.major?<span className="mv-tick-label">{tickStep<1000?time(t.ms,true):time(t.ms)}</span>:null}</span>)}
            </div>
            {([2,1] as Track[]).map(track=><div className={"mv-lane"+(track===1?" mv-main-lane":"")+(trackMutes[track]?" is-audio-muted":"")+(dragTrack===track?(dragBlocked?" is-drop-blocked":" is-drop-target"):"")} key={track} ref={el=>{videoLanes.current[track]=el;}} onDragOver={e=>e.preventDefault()} onDrop={e=>onDrop(e,track)}>
              {clips.filter(c=>c.track===track&&c.timelineStartMs<timelineLimit).sort((a,b)=>a.timelineStartMs-b.timelineStartMs||a.id.localeCompare(b.id)).map((c,i)=>{
                const a=byId.get(c.assetId);if(!a)return null;
                const clipWidth=(Math.min(clipEnd(c),timelineLimit)-c.timelineStartMs)/1000*zoom;
                const movementLocked=!!(c.positionLocked||c.syncLocked);
                return <div key={c.id} className={"mv-clip"+(i%2===0?" mv-clip-alt-a":" mv-clip-alt-b")+(selected===c.id?" is-selected":"")+(c.syncLocked?" is-locked":"")+(c.positionLocked?" is-position-locked":"")+(clipWidth<48?" is-compact":"")+(armedMedia===c.id?" is-armed":"")}
                    style={{left:c.timelineStartMs/1000*zoom,width:(Math.min(clipEnd(c),timelineLimit)-c.timelineStartMs)/1000*zoom}}
                    tabIndex={0} aria-label={"Select video "+a.name}
                    onKeyDown={e=>{if(e.target===e.currentTarget&&(e.key==="Enter"||e.key===" ")){e.preventDefault();selectVideo(c.id);}}}
                    onContextMenu={e=>e.preventDefault()}
                    onPointerDown={e=>{if(!(e.target as HTMLElement).closest(".mv-handle,.mv-clip-position-lock,.mv-clip-display-toggle"))beginMediaGesture(e,c.id,()=>movePointer(e,c,"move"),()=>selectVideo(c.id),!c.positionLocked);}}
                    title={a.name+" · "+time(c.timelineStartMs,true)}>
                  <div className="mv-clip-drag-surface" aria-hidden="true"/>
                  <button type="button" className="mv-handle mv-handle-start" disabled={c.positionLocked} aria-label="Trim clip start" title="Drag with mouse or hold on touch to trim start" onPointerDown={e=>beginMediaGesture(e,c.id,()=>movePointer(e,c,"start"),()=>selectVideo(c.id))} onKeyDown={e=>keyboardTrim(e,c,"start")}/>
                  {c.showVideoName?<span className="mv-clip-title"><span>{a.name}</span></span>:
                    <SongWaveform bars timelineStartMs={c.timelineStartMs} gridMs={waveformGridMs} wave={videoWaves[c.assetId]} sourceInMs={c.sourceInMs} sourceOutMs={Math.min(c.sourceOutMs,c.sourceInMs+timelineLimit-c.timelineStartMs)} width={clipWidth}/> }
                  <button type="button" className="mv-clip-display-toggle" aria-pressed={!!c.showVideoName}
                    aria-label={(c.showVideoName?"Show waveform: ":"Show video name: ")+a.name}
                    title={c.showVideoName?"Show waveform":"Show video name"} disabled={importing}
                    onPointerDown={e=>clipControlPointer(e,c,()=>toggleClipDisplay(c.id))} onKeyDown={e=>e.stopPropagation()}
                    onClick={e=>clipControlClick(e,()=>toggleClipDisplay(c.id))}>
                    {c.showVideoName?<EyeOff size={17}/>:<Eye size={17}/>}
                  </button>
                  <button type="button" className={"mv-clip-position-lock"+(movementLocked?" is-active":"")} aria-pressed={movementLocked}
                    aria-label={(movementLocked?"Unlock clip position: ":"Lock clip position: ")+a.name}
                    title={movementLocked?(c.syncLocked?"Unlock clip and song synchronization":"Unlock clip position"):"Lock clip position"} disabled={importing}
                    onPointerDown={e=>clipControlPointer(e,c,()=>togglePositionLock(c.id))} onKeyDown={e=>e.stopPropagation()}
                    onClick={e=>clipControlClick(e,()=>togglePositionLock(c.id))}>
                    {movementLocked?<Lock size={16}/>:<Unlock size={16}/>}
                  </button>
                  <button type="button" className="mv-handle mv-handle-end" disabled={c.positionLocked} aria-label="Trim clip end" title="Drag with mouse or hold on touch to trim end" onPointerDown={e=>beginMediaGesture(e,c.id,()=>movePointer(e,c,"end"),()=>selectVideo(c.id))} onKeyDown={e=>keyboardTrim(e,c,"end")}/>
                </div>;
              })}
            </div>)}
            <div className={"mv-song-lane"+(trackMutes.song?" is-audio-muted":"")} onPointerDown={e=>{if(e.target===e.currentTarget){const at=msFromX(e.clientX-e.currentTarget.getBoundingClientRect().left);beginMediaGesture(e,"viewport",()=>{},()=>{clearSelection();seek(at);},false);}}}>
              {songParts===null?<><div className={"mv-song-block"+(songSelected?" is-selected":"")+(armedMedia==="song"?" is-armed":"")} role="button" tabIndex={0} aria-label="Select song" aria-pressed={songSelected} title="Click or tap to select; drag with mouse; on touch, hold to move or swipe to scroll"
                style={{left:songRange.positionMs/1000*zoom,width:(songRange.endMs-songRange.startMs)/1000*zoom}}
                onContextMenu={e=>e.preventDefault()} onPointerDown={e=>beginMediaGesture(e,"song",()=>dragSong(e),selectSong)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();selectSong();return;}if(e.key!=="ArrowLeft"&&e.key!=="ArrowRight")return;e.preventDefault();selectSong();const r=rangeRef.current;
                  commitSongRange(r,Math.max(0,r.positionMs+(e.key==="ArrowLeft"?-1:1)*(e.shiftKey?100:1)));}}>
                <SongWaveform bars timelineStartMs={songRange.positionMs} gridMs={waveformGridMs} wave={wave} sourceInMs={songRange.startMs} sourceOutMs={songRange.endMs} width={(songRange.endMs-songRange.startMs)/1000*zoom}/>
                <span className="mv-song-wave-title">{project!.songName||"Song"}</span>
              </div>
              {(["start","end"] as const).map(edge=><button type="button" key={edge} className={"mv-song-handle "+edge+(songSelected?" is-selected":"")+(armedMedia==="song"?" is-armed":"")}
                style={{left:(edge==="start"?songRange.positionMs:songTimelineEnd(songRange))/1000*zoom,width:Math.min(22,(songRange.endMs-songRange.startMs)/1000*zoom/3)}}
                aria-label={"Trim song "+edge} title={time(edge==="start"?songRange.startMs:songRange.endMs,true)}
                onContextMenu={e=>e.preventDefault()} onPointerDown={e=>beginMediaGesture(e,"song",()=>dragSongEdge(e,edge),selectSong)}
                onKeyDown={e=>{if(e.key!=="ArrowLeft"&&e.key!=="ArrowRight")return;e.preventDefault();selectSong();const range=rangeRef.current;
                  commitSongRange(moveSongEdge(range,edge,(edge==="start"?range.startMs:range.endMs)+(e.key==="ArrowLeft"?-1:1)*(e.shiftKey?100:1),project!.songDurationMs));}}/>)}</>:currentParts.map((p,i)=><div key={i} className={"mv-song-block mv-song-part"+(songSelected&&i===Math.min(partIndex,currentParts.length-1)?" is-selected":"")+(armedMedia==="song-part-"+i?" is-armed":"")} role="button" tabIndex={0} aria-label={"Select song part "+(i+1)} aria-pressed={songSelected&&i===Math.min(partIndex,currentParts.length-1)} style={{left:songTimeToTimeline(p.startMs,songRange)/1000*zoom,width:(p.endMs-p.startMs)/1000*zoom}} onContextMenu={e=>e.preventDefault()} onPointerDown={e=>{if(!(e.target as HTMLElement).closest(".mv-part-edge"))beginMediaGesture(e,"song-part-"+i,()=>{selectPart(i);dragSong(e);},()=>selectPart(i));}} onKeyDown={e=>{if(e.target===e.currentTarget&&(e.key==="Enter"||e.key===" ")){e.preventDefault();selectPart(i);}}}>
                <SongWaveform bars timelineStartMs={songTimeToTimeline(p.startMs,songRange)} gridMs={waveformGridMs} wave={wave} sourceInMs={p.startMs} sourceOutMs={p.endMs} width={(p.endMs-p.startMs)/1000*zoom}/>
                <span className="mv-song-wave-title">{project!.songName||"Song"}</span>
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
      <div className="mv-timeline-toolbar">
        <div><button aria-label="Undo" disabled={!past.current.length} onClick={undo}><Undo2 size={17}/></button>
          <button aria-label="Redo" disabled={!future.current.length} onClick={redo}><Redo2 size={17}/></button>
          <button type="button" className="mv-cut-button" onClick={songSelected?splitSong:split} disabled={importing||(songSelected?(!splitSongPart(songRange,songParts,playhead)||playhead<songTimeToTimeline(selectedPart.startMs,songRange)+100||playhead>songTimeToTimeline(selectedPart.endMs,songRange)-100):!selectedClip||selectedClip.positionLocked||playhead-selectedClip.timelineStartMs<100||clipEnd(selectedClip)-playhead<100)} title={songSelected?"Split selected song at playhead":"Split selected video at playhead"} aria-label={songSelected?"Split selected song":"Split selected video"}><Scissors size={18}/></button>
          <button type="button" aria-label="Delete selection" title="Delete selection (Delete)" onClick={songSelected?removeSongPart:deleteClip} disabled={importing||(songSelected?(!songParts||songParts.length<2):!selectedClip||selectedClip.positionLocked)}><Trash2 size={17}/></button>
          <button type="button" className="mv-outline mv-inspector-icon mv-resync" disabled={importing||songSelected||originalClipSongTime===null||!selectedClip||!!selectedClip.positionLocked} onClick={()=>{if(!songSelected&&originalClipSongTime!==null&&selectedClip&&!selectedClip.positionLocked)moveSelectedClip(songTimeToTimeline(originalClipSongTime,rangeRef.current),true);}} title={originalClipSongTime!==null?"Restore Lip Sync · "+time(originalClipSongTime,true):"Select a Lip Sync clip with original song time"} aria-label="Re-Sync"><AudioLines size={16} aria-hidden="true"/><span>Re-Sync</span></button></div>
        <div className="mv-timeline-zoom">
          <button type="button" className="mv-snap-toggle" aria-label="Snap to edges" aria-pressed={snap} title={snap?"Snap to edges: on":"Snap to edges: off"} onClick={()=>setSnap(v=>!v)}><Magnet size={18}/></button>
          <div className="mv-zoom-buttons" role="group" aria-label="Timeline zoom">
            
            <button type="button" aria-label="Zoom out timeline" title="Zoom out timeline" disabled={zoom<=minimumZoom} onClick={()=>zoomBy(1/1.35)}><ZoomOut size={18}/></button>
            <button type="button" aria-label="Zoom in timeline" title="Zoom in timeline" disabled={zoom>=Math.max(MAX_TIMELINE_ZOOM,minimumZoom)} onClick={()=>zoomBy(1.35)}><ZoomIn size={18}/></button>
          </div></div>
      </div>
      {hasSelection&&<><button type="button" className="mv-inspector-toggle" aria-expanded={inspectorOpen} onClick={()=>setInspectorOpen(v=>!v)}>{songSelected?<Music2 size={16}/>:<Film size={16}/>}<span>{songSelected?((project!.songName||"Unnamed song")+(songParts&&currentParts.length>1?" · Part "+(Math.min(partIndex,currentParts.length-1)+1)+" / "+currentParts.length:"")):(selectedAsset?.name||"Video")}</span>{inspectorOpen?<ChevronDown size={16}/>:<ChevronRight size={16}/>}</button>
      <div className="mv-inspector-body" hidden={!inspectorOpen}>
      {!songSelected&&selectedClip&&selectedAsset?<form className="mv-song-trim mv-clip-position" onSubmit={e=>e.preventDefault()}>
        <div className="mv-video-times">
          <div className="mv-time-pair" role="group" aria-label="Original song time">
            <span className="mv-time-pair-heading">Original song time <small>Position in the full, untrimmed song</small></span>
            <InlineTimeField label="Video start time" ariaLabel="Video start time in original song" value={clipSongText} onChange={v=>updateClipTime(v,"song")} onConfirm={()=>submitClipTime("song")} disabled={importing||!!selectedClip.positionLocked} placeholder="00:08.918"/>
            <InlineTimeField label="Video end time" ariaLabel="Video end time in original song" value={clipSongEndText} onChange={v=>updateClipEnd(v,"song")} onConfirm={()=>submitClipEnd("song")} disabled={importing||!!selectedClip.positionLocked} placeholder="00:18.918"/>
          </div>
          <div className="mv-time-pair" role="group" aria-label="Project timeline">
            <span className="mv-time-pair-heading">Project timeline <small>Position in this music video project</small></span>
            <InlineTimeField label="Timeline start" ariaLabel="Video start time on timeline" value={clipTimelineText} onChange={v=>updateClipTime(v,"timeline")} onConfirm={()=>submitClipTime("timeline")} disabled={importing||!!selectedClip.positionLocked} placeholder="00:08.918"/>
            <InlineTimeField label="Timeline end" ariaLabel="Video end time on timeline" value={clipEndText} onChange={v=>updateClipEnd(v,"timeline")} onConfirm={()=>submitClipEnd("timeline")} disabled={importing||!!selectedClip.positionLocked} placeholder="00:18.918"/>
          </div>
        </div>
        <span className="mv-inspector-duration">Duration <b>{time(selectedClip.sourceOutMs-selectedClip.sourceInMs,true)}</b></span>
      </form>:
      <form className="mv-song-trim mv-song-position" onSubmit={e=>e.preventDefault()}>
        <InlineTimeField label={songParts?"Part source start":"Source start"} ariaLabel={songParts?"Song part start":"Song start time"} value={songParts?partStartText:startText} onChange={songParts?setPartStartText:setStartText} onConfirm={()=>submitSongField("start")} disabled={importing} placeholder="00:08.918"/>
        <InlineTimeField label={songParts?"Part source end":"Source end"} ariaLabel={songParts?"Song part end":"Song end time"} value={songParts?partEndText:endText} onChange={songParts?setPartEndText:setEndText} onConfirm={()=>submitSongField("end")} disabled={importing} placeholder="00:30.000"/>
        <span className="mv-inspector-duration">Duration <b>{time(selectedPart.endMs-selectedPart.startMs,true)}</b></span>
      </form>}
      </div></>}
      {placementNotice&&<p className="mv-placement-notice" role="status">{placementNotice}</p>}
      {error&&<div className="mv-error" role="alert"><span>{error}</span>{status==="Not saved"&&<button type="button" onClick={()=>void saveNow().then(()=>{setError("");setClips([...latest.current]);}).catch(()=>{})}>Retry save</button>}</div>}
      <input ref={fileInput} hidden type="file" accept=".mp4,.webm,video/mp4,video/webm" onChange={e=>{
        const file=e.target.files?.[0];if(file)void uploadVideo(file);e.target.value="";
      }}/>
    </section>
    <section className="mv-library">
      <div className="mv-library-header">
        <button className="mv-library-heading" aria-expanded={libraryOpen} onClick={()=>setLibraryOpen(!libraryOpen)}>
          {libraryOpen?<ChevronDown size={21}/>:<ChevronRight size={21}/>}<h2>Library</h2><span>{assets.length} videos</span>
        </button>
        <details className="mv-library-help"><summary aria-label="Library help" title="Library help"><Info size={16}/></summary><p>Choose each video’s role. Lip Sync defaults to the main track; B-Roll to the upper track. Changing role keeps existing clip positions; B-Roll releases Sync Lock. Original source times are preserved.</p></details>
      </div>
      {libraryOpen&&<div className="mv-library-content">
        {roleError&&<p className="mv-error" role="alert">{roleError}</p>}
        <div className="mv-library-tools">
          <div className="mv-browse-toolbar">
            <label className="mv-browse-search"><Search size={16}/><input type="search" placeholder="Search library…" aria-label="Search media" value={search} onChange={e=>setSearch(e.target.value)}/></label>
            <label className="mv-browse-filter mv-library-icon-select" data-active={filter!=="All"} title={"Filter: "+filter}><ListFilter size={17} aria-hidden="true"/><select aria-label="Filter library videos" value={filter} onChange={e=>setFilter(e.target.value as typeof filter)}>
              {libraryFilters.map(f=><option key={f} value={f}>{f==="All"?"All videos":f} ({assets.filter(a=>matchesLibraryFilter(a,f)).length})</option>)}
            </select></label>
            <button type="button" className="mv-browse-control" disabled={importing||libraryRefreshing} onClick={()=>void refreshLibrary()} title="Refresh library" aria-label="Refresh library"><RefreshCw size={15}/></button>
            <label className="mv-browse-filter mv-library-icon-select" data-active={librarySort!=="newest"} title={librarySort==="source"?"Sort: Source Time":librarySort==="newest"?"Sort: Newest first":"Sort: Oldest first"}><ArrowUpDown size={17} aria-hidden="true"/><select aria-label="Sort library videos" value={librarySort} onChange={e=>setLibrarySort(e.target.value as typeof librarySort)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="source">Source Time</option></select></label>
          </div>
          <div className="mv-library-imports">
          <button className="mv-outline" disabled={importing} onClick={()=>void openLipSync(1)}><Music2 size={16}/> Insert Lip Sync</button>
          <button className="mv-outline" disabled={importing} onClick={()=>fileInput.current?.click()} aria-label="Upload video" title="Upload video"><Upload size={16}/> Upload</button>
          </div>
        </div>
        {media.length?<div className="mv-media-grid">{media.map(a=><article key={a.id} className="mv-media-card"
          draggable={assetRename?.id!==a.id} onDragStart={e=>e.dataTransfer.setData("application/x-mvasset",a.id)}>
          <button type="button" className="mv-media-image" aria-label={"Preview "+a.name} title={"Preview "+a.name} onClick={()=>{stopPlayback();setLibraryPreviewError(false);setLibraryPreview(a);}}><Film size={32}/><img src={endpoint+id+"/thumbnail/"+a.id} alt="" loading="lazy" decoding="async" draggable={false} onError={e=>{e.currentTarget.style.display="none";}} onLoad={e=>{e.currentTarget.style.display="block";}}/><span className="mv-media-duration">{time(a.durationMs)}</span>{usedAssets.has(a.id)&&<span className="mv-media-used" title="Used in timeline" aria-label="Used in timeline"><Check size={13}/></span>}<span className="mv-media-play"><Play size={20}/></span></button>
          <div className="mv-media-info">
            {assetRename?.id===a.id?<form className="mv-asset-rename" onSubmit={e=>{e.preventDefault();void renameProjectAsset(a);}}>
              <input autoFocus aria-label="Video name in this project" maxLength={80} value={assetRename.name} onChange={e=>setAssetRename({id:a.id,name:e.target.value})} onKeyDown={e=>{if(e.key==="Escape")setAssetRename(null);}}/>
              <button type="submit" title="Save project video name" aria-label="Save project video name" disabled={importing||!assetRename.name.trim()}><Check size={15}/></button>
              <button type="button" title="Cancel rename" aria-label="Cancel rename" disabled={importing} onClick={()=>setAssetRename(null)}><X size={15}/></button>
            </form>:<div className="mv-asset-name"><strong title={a.name}>{a.name}</strong><button type="button" title="Rename only in this project" aria-label={"Rename "+a.name+" in this project"} disabled={importing} onClick={()=>setAssetRename({id:a.id,name:a.name})}><Pencil size={14}/></button></div>}
            <small>{a.sourceKind==="live"?"SingMotion":a.sourceKind==="uploaded"?"Uploaded video":"Generated video"}</small>
            <div className="mv-media-role" role="group" aria-label={"Role of "+a.name}>
              <button type="button" className={a.role==="lip-sync"?"active":""} aria-pressed={a.role==="lip-sync"} disabled={importing} onClick={()=>void changeAssetRole(a,"lip-sync")}><Music2 size={13}/> Lip Sync</button>
              <button type="button" className={a.role==="b-roll"?"active":""} aria-pressed={a.role==="b-roll"} disabled={importing} onClick={()=>void changeAssetRole(a,"b-roll")}><Film size={13}/> B-Roll</button>
            </div>
            {roleChanging===a.id?<small role="status">Saving role…</small>:a.sourceStartMs!==null&&a.sourceEndMs!==null?<small className="mv-source-time">Source: {time(a.sourceStartMs,true)} – {time(a.sourceEndMs,true)}</small>:null}
            <div className="mv-media-actions"><button disabled={importing} aria-label={"Add "+a.name+" to timeline"} title="Add to timeline" onClick={()=>addClip(a,a.role==="lip-sync"?1:2,playhead)}><Plus size={14}/> Add</button>
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
    {libraryPreview&&<dialog ref={libraryPreviewDialog} className="mv-library-preview-dialog" aria-label={"Preview "+libraryPreview.name} onCancel={e=>{e.preventDefault();setLibraryPreview(null);}} onClose={()=>setLibraryPreview(null)} onClick={e=>{if(e.target===e.currentTarget)setLibraryPreview(null);}}><div className="mv-library-preview-inner"><div className="mv-library-preview-title"><strong>{libraryPreview.name}</strong><button type="button" aria-label="Close video preview" onClick={()=>setLibraryPreview(null)}><X size={20}/></button></div><video controls autoPlay playsInline preload="metadata" src={endpoint+id+"/assets/"+encodeURIComponent(libraryPreview.id)} onError={()=>setLibraryPreviewError(true)}/>{libraryPreviewError&&<p role="alert">Video preview unavailable. Try downloading the original video.</p>}</div></dialog>}
    {exportJob?.state==="ready"&&!exportOpen&&<div className="mv-export-toast" role="status"><Check size={20}/><div><strong>MP4 ready{exportJob.resolution?" · "+Math.min(exportJob.resolution.width,exportJob.resolution.height)+"p":""}</strong><small>Download requested. <a href={endpoint+id+"/export/"+exportJob.id+"?download=1"} download>Download again</a></small></div><button type="button" aria-label="Dismiss export notice" onClick={()=>setExportJob(null)}><X size={17}/></button></div>}
    {exportOpen&&<div className="mv-dialog-backdrop"><div className="mv-dialog mv-export-dialog" role="dialog" aria-modal="true" aria-label="Export MP4"><div className="mv-export-symbol"><Download size={32}/></div><h2>{exportError?"Export failed":"Exporting your video…"}</h2><p>{exportError||(exportJob?.resolution?"Preparing "+Math.min(exportJob.resolution.width,exportJob.resolution.height)+"p MP4 for download.":"Checking source resolution…")}</p>{!exportError&&<><div className="mv-export-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={exportJob?.progress??0}><span style={{width:(exportJob?.progress??0)+"%"}}/></div><strong>{exportJob?.progress??0}%</strong></>}{!exporting&&<button className="mv-outline" onClick={()=>setExportOpen(false)}>Close</button>}</div></div>}
    {lipTrack!==null&&typeof document!=="undefined"&&createPortal(<div ref={lipBackdrop} className="mv-root mv-editor mv-dialog-backdrop mv-lip-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget&&!importing)setLipTrack(null);}}>
      <div ref={lipDialog} tabIndex={-1} className="mv-dialog mv-lip-dialog" role="dialog" aria-modal="true" aria-label="Insert Lip Sync">
        <h2>Insert Lip Sync · {lipTrack===1?"Main track":"Video 2"}</h2>
        <p>Choose a completed Lip Sync video. Original source start is preferred. At least five seconds are inserted when the source permits. Use the same song for accurate synchronization.</p>
        <input type="search" placeholder="Search completed videos…" aria-label="Search Lip Sync videos" value={lipSearch} onChange={e=>setLipSearch(e.target.value)}/>
        {lipLoading?<p role="status">Loading your videos…</p>:<div className="mv-lip-list">
          {lipSources.filter(s=>s.name.toLowerCase().includes(lipSearch.toLowerCase())).map(s=><button key={s.id} type="button" disabled={importing}
            onClick={()=>void insertLipSync(s,lipTrack)}>
            <div className="mv-lip-thumbnail" aria-hidden="true"><Film size={19}/><img src={endpoint+id+"/lip-thumbnail/"+encodeURIComponent(s.id)} alt="" loading="lazy" decoding="async" draggable={false} onError={e=>{e.currentTarget.style.display="none";}}/></div><span><strong>{s.name}</strong><small>{time(s.sourceStartMs,true)} – {time(s.sourceEndMs,true)} · {time(s.durationMs)}</small></span><Plus size={18}/>
          </button>)}
          {!lipSources.filter(s=>s.name.toLowerCase().includes(lipSearch.toLowerCase())).length&&<p>No matching completed Lip Sync videos.</p>}
        </div>}
        {lipError&&<p role="alert" className="mv-error">{lipError}</p>}
        <div className="mv-dialog-actions"><button type="button" disabled={importing} onClick={()=>setLipTrack(null)}>Close</button></div>
      </div>
    </div>,document.body)}
  </main>;
}
