"use client";
import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import Link from "next/link";
import {ChevronDown,ChevronRight,Check,Clock3,Film,FolderOpen,Lock,Unlock,
  Maximize,Minus,MoreHorizontal,Music2,Pause,Pencil,Play,Plus,Redo2,Scissors,
  Search,Trash2,Undo2,Upload,Volume2,VolumeX,ZoomIn} from "lucide-react";
import type {MusicAsset,MusicClip,MusicProject,Track} from "@/lib/music-video/core";
import "./music-video.css";

type Detail={project:MusicProject;assets:MusicAsset[];clips:MusicClip[]};
const endpoint="/api/music-video/";
const uuid=()=>crypto.randomUUID();
const time=(ms:number,precise=false)=>{
  const n=Math.max(0,Math.round(ms));
  return String(Math.floor(n/60000)).padStart(2,"0")+":"+String(Math.floor(n%60000/1000)).padStart(2,"0")+
    (precise?"."+String(n%1000).padStart(3,"0"):"");
};
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
  const [selected,setSelected]=useState<string|null>(null),[playhead,setPlayhead]=useState(0);
  const [playing,setPlaying]=useState(false),[zoom,setZoom]=useState(44),[snap,setSnap]=useState(true);
  const [libraryOpen,setLibraryOpen]=useState(false),[filter,setFilter]=useState<"All"|"Lip Sync"|"AI Video">("All");
  const [search,setSearch]=useState(""),[addMenu,setAddMenu]=useState<Track|null>(null);
  const [uploadTrack,setUploadTrack]=useState<Track>(1),[error,setError]=useState(""),[status,setStatus]=useState("Saved");
  const [wave,setWave]=useState<number[]>([]),[editingName,setEditingName]=useState(false),[newName,setNewName]=useState("");
  const audio=useRef<HTMLAudioElement>(null),video=useRef<HTMLVideoElement>(null),scroll=useRef<HTMLDivElement>(null),fileInput=useRef<HTMLInputElement>(null);
  const revision=useRef(0),latest=useRef<MusicClip[]>([]),dirty=useRef(false),inFlight=useRef<Promise<void>|null>(null);
  const saveTimer=useRef<ReturnType<typeof setTimeout>|null>(null),past=useRef<MusicClip[][]>([]),future=useRef<MusicClip[][]>([]);
  const detailRef=useRef<Detail|null>(null);
  const load=useCallback(async()=>{
    const data=await request<Detail>(endpoint+id);
    detailRef.current=data;revision.current=data.project.revision;latest.current=data.clips;dirty.current=false;
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
    const snapshot=latest.current;
    setStatus("Saving…");
    const task=(async()=>{
      const result=await request<Detail>(endpoint+id+"/clips",{method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({revision:revision.current,clips:snapshot})});
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
  function apply(next:MusicClip[],record=true){
    if(record){past.current.push(latest.current);if(past.current.length>40)past.current.shift();future.current=[];}
    latest.current=next;setClips(next);setError("");queue();
  }
  function undo(){
    const previous=past.current.pop();if(!previous)return;
    future.current.push(latest.current);apply(previous,false);
  }
  function redo(){
    const next=future.current.pop();if(!next)return;
    past.current.push(latest.current);apply(next,false);
  }
  const project=detail?.project,assets=detail?.assets||[];
  const byId=useMemo(()=>new Map(assets.map(a=>[a.id,a])),[assets]);
  const selectedClip=clips.find(c=>c.id===selected);
  const selectedAsset=selectedClip?byId.get(selectedClip.assetId):null;
  const activeClip=clips.filter(c=>playhead>=c.timelineStartMs&&playhead<clipEnd(c)).sort((a,b)=>b.track-a.track)[0];
  const activeAsset=activeClip?byId.get(activeClip.assetId):null;
  const source=(a:MusicAsset)=>endpoint+id+"/assets/"+a.id;
  const pixels=project?Math.max(640,project.songDurationMs/1000*zoom):640;
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
      timelineStartMs:locked?asset.sourceStartMs!:Math.max(0,Math.round(atMs/100)*100),
      sourceInMs:0,sourceOutMs:length,syncLocked:locked};
    if(clipEnd(candidate)>project.songDurationMs){
      if(locked){setError("Lip-sync source cut extends beyond the song.");return;}
      candidate.sourceOutMs=Math.max(0,project.songDurationMs-candidate.timelineStartMs);
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
        if(position+length>project.songDurationMs){setError("No free position for this video.");return;}
        candidate.timelineStartMs=position;
      }else{
        const nextEdge=Math.min(...conflicts.map(c=>c.timelineStartMs).filter(n=>n>candidate.timelineStartMs),project.songDurationMs);
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
      if(project&&clipEnd(next)>project.songDurationMs){setError("Clip reaches beyond the song.");return;}
      if(overlaps(latest.current,next).length){setError("Track occupied. Try another position.");return;}
      apply(latest.current.map(a=>a.id===c.id?next:a));setSelected(c.id);
    }else if(assetId){
      const a=byId.get(assetId);if(a)addClip(a,track,position);
    }
  }
  function movePointer(e:React.PointerEvent,clip:MusicClip,edge:"start"|"end"|"move"){
    if(e.button!==0||edge==="move"&&clip.syncLocked)return;
    e.stopPropagation();e.preventDefault();
    const startX=e.clientX,initial={...clip};
    const startClips=latest.current;
    const handler=(event:PointerEvent)=>{
      const delta=Math.round((event.clientX-startX)/zoom*1000/50)*50;
      const asset=byId.get(clip.assetId);if(!asset||!project)return;
      const next={...initial};
      if(edge==="move")next.timelineStartMs=Math.min(project.songDurationMs-(clip.sourceOutMs-clip.sourceInMs),Math.max(0,snapped(initial.timelineStartMs+delta,clip)));
      if(edge==="start"){
        next.sourceInMs=Math.min(initial.sourceOutMs-100,Math.max(0,initial.sourceInMs+delta));
        next.timelineStartMs=initial.timelineStartMs+(next.sourceInMs-initial.sourceInMs);
      }
      if(edge==="end")next.sourceOutMs=Math.min(asset.durationMs,Math.max(initial.sourceInMs+100,initial.sourceOutMs+delta));
      if(clipEnd(next)>project.songDurationMs||overlaps(startClips,next).length)return;
      setClips(startClips.map(c=>c.id===next.id?next:c));
    };
    const finish=(event:PointerEvent)=>{
      document.removeEventListener("pointermove",handler);document.removeEventListener("pointerup",finish);
      document.removeEventListener("pointercancel",finish);
      const delta=Math.round((event.clientX-startX)/zoom*1000/50)*50;
      const asset=byId.get(clip.assetId);if(!asset||!project)return;
      const next={...initial};
      if(edge==="move")next.timelineStartMs=Math.min(project.songDurationMs-(clip.sourceOutMs-clip.sourceInMs),Math.max(0,snapped(initial.timelineStartMs+delta,clip)));
      if(edge==="start"){next.sourceInMs=Math.min(initial.sourceOutMs-100,Math.max(0,initial.sourceInMs+delta));next.timelineStartMs=initial.timelineStartMs+(next.sourceInMs-initial.sourceInMs);}
      if(edge==="end")next.sourceOutMs=Math.min(asset.durationMs,Math.max(initial.sourceInMs+100,initial.sourceOutMs+delta));
      if(clipEnd(next)>project.songDurationMs||overlaps(startClips,next).length){setClips(startClips);setError("Clip overlaps another clip or exceeds the song.");return;}
      if(JSON.stringify(next)!==JSON.stringify(initial))apply(startClips.map(c=>c.id===next.id?next:c));
    };
    document.addEventListener("pointermove",handler);document.addEventListener("pointerup",finish,{once:true});
    document.addEventListener("pointercancel",finish,{once:true});
  }
  function split(){
    if(!selectedClip||playhead<=selectedClip.timelineStartMs+100||playhead>=clipEnd(selectedClip)-100)return;
    const splitAt=selectedClip.sourceInMs+(playhead-selectedClip.timelineStartMs);
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
    if(lock&&selectedAsset.sourceStartMs!==null&&selectedClip.timelineStartMs!==selectedAsset.sourceStartMs+selectedClip.sourceInMs){
      setError("Move this clip back to its original song position before relocking.");return;
    }
    apply(latest.current.map(c=>c.id===selectedClip.id?{...c,syncLocked:lock}:c));
  }
  async function uploadVideo(file:File,track:Track){
    try{
      if(saveTimer.current)clearTimeout(saveTimer.current);
      await saveNow();setStatus("Uploading…");
      const form=new FormData();form.set("video",file);
      const result=await request<{asset:MusicAsset}>(endpoint+id+"/assets",{method:"POST",body:form});
      await load();setLibraryOpen(true);setStatus("Saved");
      if(window.confirm("Video imported. Add it to Video "+track+" now?"))
        addClip(result.asset,track,playhead);
    }catch(e){setError(e instanceof Error?e.message:"Upload failed.");setStatus("Not saved");}
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
  function seek(ms:number){
    if(!project)return;
    const clamped=Math.max(0,Math.min(project.songDurationMs,ms));
    if(audio.current)audio.current.currentTime=clamped/1000;
    setPlayhead(clamped);
  }
  function onAudioTime(){
    const current=audio.current;if(!current)return;
    setPlayhead(Math.round(current.currentTime*1000));
  }
  function togglePlayback(){
    if(!audio.current)return;
    if(audio.current.paused)void audio.current.play().catch(()=>setError("Audio playback was blocked."));
    else audio.current.pause();
  }
  useEffect(()=>{
    if(!activeClip||!activeAsset||!video.current)return;
    const expected=(activeClip.sourceInMs+Math.max(0,playhead-activeClip.timelineStartMs))/1000;
    if(video.current.readyState>=1&&Math.abs(video.current.currentTime-expected)>0.24){
      try{video.current.currentTime=expected;}catch{}
    }
    if(playing&&video.current.paused)void video.current.play().catch(()=>{});
  },[playhead,activeClip,activeAsset,playing]);
  const media=assets.filter(a=>(filter==="All"||filter==="Lip Sync"&&a.kind==="lip-sync"||filter==="AI Video"&&a.kind!=="lip-sync")&&
    a.name.toLowerCase().includes(search.toLowerCase()));
  if(!detail)return <main className="mv-root"><Link href="/projects">← Projects</Link><p role="status">Loading Music Video Builder…</p><p role="alert">{error}</p></main>;
  const ticks=Array.from({length:Math.floor(project!.songDurationMs/10000)+1},(_,i)=>i*10000);
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
        onTimeUpdate={onAudioTime} onEnded={()=>setPlaying(false)}
        onPlay={()=>setPlaying(true)} onPause={()=>{setPlaying(false);video.current?.pause();}}/>
      <div className="mv-player-controls">
        <button aria-label={playing?"Pause":"Play"} onClick={togglePlayback}>{playing?<Pause size={19}/>:<Play size={19}/>}</button>
        <span className="mv-clock">{time(playhead)} / {time(project!.songDurationMs)}</span>
        <input className="mv-progress" aria-label="Seek song" type="range" min="0" max={project!.songDurationMs} step="10" value={playhead} onChange={e=>seek(Number(e.target.value))}/>
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
              <button onClick={()=>{setUploadTrack(track);fileInput.current?.click();setAddMenu(null);}}><Upload size={15}/> Import</button>
              <button onClick={()=>{setLibraryOpen(true);setAddMenu(null);}}><FolderOpen size={15}/> Library</button>
              <button disabled title="AI video generation will be added later"><Plus size={15}/> Generate · Soon</button>
            </div>}
          </div>)}
          <div className="mv-label"><Music2 size={18}/><strong>Song</strong><Lock size={15}/></div>
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
            <div className="mv-song-lane">
              <div className="mv-wave">{(wave.length?wave:Array.from({length:180},()=>0.22)).map((v,i)=>
                <span key={i} style={{height:Math.max(5,Math.min(100,v*100))+"%"}}/>)}</div>
            </div>
            <div className="mv-playhead" style={{left:playhead/1000*zoom}}><span/></div>
          </div>
        </div>
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
        <div className="mv-library-tools"><div className="mv-filter">{(["All","Lip Sync","AI Video"] as const).map(f=>
          <button key={f} className={filter===f?"active":""} onClick={()=>setFilter(f)}>{f}</button>)}</div>
          <div className="mv-library-search"><Search size={16}/><input placeholder="Search library…" aria-label="Search media" value={search} onChange={e=>setSearch(e.target.value)}/></div>
          <button className="mv-outline" onClick={()=>{setUploadTrack(1);fileInput.current?.click();}}><Upload size={16}/> Upload</button>
        </div>
        {media.length?<div className="mv-media-grid">{media.map(a=><article key={a.id} className="mv-media-card"
          draggable onDragStart={e=>e.dataTransfer.setData("application/x-mvasset",a.id)}>
          <div className="mv-media-image"><Film size={32}/><span>{time(a.durationMs)}</span></div>
          <div className="mv-media-info"><small>{a.kind==="lip-sync"?"🎤 Lip Sync":"🎬 AI Video"}</small>
            <strong title={a.name}>{a.name}</strong>
            <div className="mv-media-actions"><button onClick={()=>addClip(a,1,playhead)}><Plus size={14}/> Add to timeline</button>
              <details><summary aria-label={"Options for "+a.name}><MoreHorizontal size={17}/></summary>
                <div><button onClick={()=>addClip(a,2,playhead)}>Add to Video 2</button><button onClick={()=>void deleteAsset(a)}>Remove from Library</button></div>
              </details></div>
          </div></article>)}</div>:<p className="mv-empty-library">No videos in this Library. Import a video or use Add to Project from Videos.</p>}
      </div>}
    </section>
  </main>;
}
