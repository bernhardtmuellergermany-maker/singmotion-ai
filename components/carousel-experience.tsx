"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Search, X, ArrowRight, CloudUpload, LogIn, Music2, UserRound, Volume2, VolumeX, Play, AlertCircle, LoaderCircle, CheckCircle2 } from "lucide-react";
import { GlobalMenu } from "./home-collection";
import { api, ensureSession, resetSession, upload } from "@/lib/client";
import { validateFile, type Asset, type Job } from "@/lib/domain";
import type { StudioProject } from "@/lib/live/studio";
import { showcase } from "@/lib/showcase";

type Tile = { id:string; name:string; href:string; imageId?:string; state:string; created:number; videoUrl?:string; seconds:number };
type Draft = { id:string; artistName:string; selection:{ songId?:string; imageId?:string; start:number; end:number } };
const cleanTitle=(name:string)=>!name.trim()||/^(?:[a-f0-9]{8}-[a-f0-9-]{20,}|(?:live_|job_|draft_)[a-f0-9-]{8,})$/i.test(name.trim())?"Untitled Project":name.trim();
const queryCard=()=>{if(typeof window==="undefined")return "home";const explicit=new URLSearchParams(location.search).get("card");if(explicit)return explicit;const returned=sessionStorage.getItem("singmotion-carousel-return");if(returned){sessionStorage.removeItem("singmotion-carousel-return");return returned;}return "home";};
export function CarouselExperience(){
  const [tiles,setTiles]=useState<Tile[]>([]);
  const [publishedShowcase,setPublishedShowcase]=useState<{title:string;videoUrl:string}|null>(null);
  // Public showcase selection is independent of the visitor's login/session.
  useEffect(()=>{
    let mounted=true;
    fetch("/api/showcase",{cache:"no-store"})
      .then(async r=>r.ok?await r.json():null)
      .then(data=>{if(mounted&&data)setPublishedShowcase({title:data.title||showcase.title,videoUrl:data.videoUrl||showcase.videoUrl});})
      .catch(()=>{});
    return()=>{mounted=false;};
  },[]);
  const [current,setCurrent]=useState("home");
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [audio,setAudio]=useState<Asset|null>(null);
  const [uploading,setUploading]=useState(false);
  const [uploadError,setUploadError]=useState("");
  const [dragging,setDragging]=useState(0);
  const [hoveredSide,setHoveredSide]=useState<string|null>(null);
  const [searchOpen,setSearchOpen]=useState(false);
  const [searchText,setSearchText]=useState("");
  const [searchQuery,setSearchQuery]=useState("");
  const priorCard=useRef("home");
  const searchInput=useRef<HTMLInputElement>(null);
  const searchButton=useRef<HTMLButtonElement>(null);
  const searchContainer=useRef<HTMLDivElement>(null);
  const touch=useRef<{x:number;y:number;t:number}|null>(null);
  const currentRef=useRef("home");
  const searching=searchOpen && searchQuery.trim().length>0;
  const searchCards=[
    {id:"showcase",keywords:"showcase example demo sample video singmotion ai featured watch preview"},
    {id:"home",keywords:"home start create video generate upload music song audio new project studio"},
    {id:"login",keywords:"login log in sign in sign out logout log out account profile user register"}
  ];
  const projectSearchText=(tile:Tile)=>{
    const raw=tile.created;
    const date=raw ? new Date(raw<1e11?raw*1000:raw) : null;
    const dates=date&&!Number.isNaN(date.getTime())?[
      date.toLocaleDateString("en-GB"),
      date.toLocaleDateString("de-DE"),
      date.toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"}),
      date.toISOString().slice(0,10),
      date.toISOString().slice(0,7),
      String(date.getFullYear())
    ].join(" "):"";
    return (tile.name+" "+dates).toLocaleLowerCase();
  };
  const term=searchQuery.trim().toLocaleLowerCase();
  const matches=searching?tiles.filter(t=>projectSearchText(t).includes(term)):tiles;
  const ids=searching?[
    ...searchCards.filter(card=>card.keywords.includes(term)).map(card=>card.id),
    ...matches.map(t=>t.id)
  ]:["showcase","home","login",...tiles.map(t=>t.id)];
  const showcaseProject=tiles.find(t=>t.name.trim().toLocaleLowerCase()==="varkai"&&!!t.videoUrl&&(t.state.toLowerCase()==="completed"||t.id.startsWith("live_"))) || tiles.find(t=>!!t.videoUrl&&(t.state.toLowerCase()==="completed"||t.id.startsWith("live_")));
  const activeIndex=Math.max(0,ids.indexOf(current));
  useEffect(()=>{const timer=setTimeout(()=>setSearchQuery(searchText),250);return()=>clearTimeout(timer);},[searchText]);
  useEffect(()=>{if(searchOpen)searchInput.current?.focus();},[searchOpen]);
  useEffect(()=>{if(new URLSearchParams(window.location.search).get("search")==="1"){priorCard.current="home";setSearchOpen(true);const url=new URL(window.location.href);url.searchParams.delete("search");window.history.replaceState(window.history.state,"",url.pathname+url.search+url.hash);}},[]);
  useEffect(()=>{
    if(!searchOpen)return;
    const onOutside=(event:PointerEvent)=>{
      if(searchContainer.current && !searchContainer.current.contains(event.target as Node) && !(event.target as Element).closest?.(".home-gallery-account"))closeSearch();
    };
    document.addEventListener("pointerdown",onOutside);
    return()=>document.removeEventListener("pointerdown",onOutside);
  },[searchOpen,tiles]);
  const closeSearch=()=>{const hadFilter=searchQuery.trim().length>0;setSearchOpen(false);setSearchText("");setSearchQuery("");if(hadFilter){const restore=priorCard.current;navigate(["showcase","home","login"].includes(restore)||tiles.some(t=>t.id===restore)?restore:"home");}searchButton.current?.focus();};
  const navigate=useCallback((id:string,replace=false)=>{
    currentRef.current=id;setCurrent(id);
    const u=new URL(window.location.href);
    if(id==="home")u.searchParams.delete("card");else u.searchParams.set("card",id);
    window.history[replace?"replaceState":"pushState"]({ ...window.history.state, carouselCard:id },"",u.pathname+u.search+u.hash);
  },[]);
  useEffect(()=>{
    if(!searching)return;
    if(ids.length && !ids.includes(current))navigate(ids[0],true);
  },[searchQuery,tiles,searchOpen]);
  useEffect(()=>{
    const id=queryCard();currentRef.current=id;setCurrent(id);
    const onPop=()=>{const next=queryCard();currentRef.current=next;setCurrent(next);};
    window.addEventListener("popstate",onPop);
    return ()=>window.removeEventListener("popstate",onPop);
  },[]);
  useEffect(()=>{
    let mounted=true;
    async function refresh(){
      try{
        await ensureSession();
        const results=await Promise.allSettled([api<Job[]>("jobs"),api<{projects:StudioProject[]}>("studio-live"),api<Draft[]>("studio-drafts")]);
        if(!mounted)return;
        if(results.every(r=>r.status==="rejected"))throw new Error("Your private projects could not be loaded.");
        const jobs=results[0].status==="fulfilled"?results[0].value:[];
        const live=results[1].status==="fulfilled"?results[1].value.projects:[];
        const drafts=results[2].status==="fulfilled"?results[2].value:[];
        const cards:Tile[]=[
          ...live.map(p=>({id:"live_"+p.id,name:cleanTitle(p.artistName||""),href:"/projects/live_"+encodeURIComponent(p.id),imageId:p.imageId,seconds:p.durationSeconds,created:p.createdAt,state:p.state,videoUrl:p.outputReady?"/api/studio-live?id="+encodeURIComponent(p.id)+"&video=1":undefined})),
          ...jobs.map(j=>({id:"job_"+j.id,name:cleanTitle(j.artistName||""),href:"/projects/"+encodeURIComponent(j.id),imageId:j.imageId,seconds:j.end-j.start,created:j.created,state:j.status,videoUrl:j.status==="completed"&&j.outputId?"/api/assets/"+encodeURIComponent(j.outputId):undefined})),
          ...drafts.filter(d=>d.selection.songId&&d.selection.imageId).map(d=>({id:"draft_"+d.id,name:cleanTitle(d.artistName||""),href:"/studio?draft="+encodeURIComponent(d.id),imageId:d.selection.imageId,seconds:d.selection.end-d.selection.start,created:0,state:"prepared"}))
        ].sort((a,b)=>b.created-a.created);
        setTiles(cards);setError("");
      }catch(e){if(mounted)setError((e as Error).message);}
      finally{if(mounted)setLoading(false);}
    }
    void refresh();
    const interval=window.setInterval(()=>{if(!document.hidden)void refresh();},30000);
    return()=>{mounted=false;window.clearInterval(interval);};
  },[]);
  useEffect(()=>{
    if(!loading&&!searching&&!ids.includes(current)){
      navigate("home",true);
    }
  },[loading,tiles,current,navigate,searching]);
  const step=(offset:number)=>{
    const i=Math.max(0,ids.indexOf(currentRef.current));
    const target=ids[Math.max(0,Math.min(ids.length-1,i+offset))];
    if(target)navigate(target);
  };
  async function selectAudio(file?:File){
    if(!file||uploading)return;
    setUploading(true);setUploadError("");
    try{
      validateFile(file.name,file.size,"audio");
      await ensureSession();
      const result=await upload(file,"audio") as Asset;
      setAudio(result);
    }catch(e){setUploadError((e as Error).message||"Audio upload failed. Try again.");}
    finally{setUploading(false);}
  }
  async function disconnectDemoWorkspace(){
    try{
      await api("session/logout",{method:"POST"});
      resetSession();
      setTiles([]);
      navigate("home");
      setError("");
    }catch(e){setError((e as Error).message||"Could not disconnect this browser's demo session.");}
  }
  function continueToStudio(){
    if(!audio)return;
    sessionStorage.setItem("singmotion-home-audio-handoff",JSON.stringify(audio));
    window.location.assign("/studio?new=1&audio=1");
  }
  function onTouchStart(e:React.TouchEvent){
    const t=e.touches[0];if(t)touch.current={x:t.clientX,y:t.clientY,t:Date.now()};
  }
  function onTouchMove(e:React.TouchEvent){
    if(!touch.current)return;const t=e.touches[0];if(!t)return;
    if(Math.abs(t.clientX-touch.current.x)>Math.abs(t.clientY-touch.current.y)*1.4)setDragging(Math.max(-90,Math.min(90,t.clientX-touch.current.x)));
  }
  function onTouchEnd(e:React.TouchEvent){
    if(!touch.current)return;const delta=e.changedTouches[0]?.clientX-touch.current.x||0;
    const velocity=Math.abs(delta)/Math.max(1,Date.now()-touch.current.t);
    touch.current=null;setDragging(0);
    if(Math.abs(delta)>55||(Math.abs(delta)>25&&velocity>.5))step(delta<0?1:-1);
  }
  return <div className="sm-carousel-page">
    <header className="home-gallery-header sm-carousel-header">
      <a href="/" className="sm-wordmark" aria-label="SingMotion AI home" onClick={e=>{e.preventDefault();navigate("home");}}>SingMotion <span>AI</span></a>
      <div className="sm-header-actions">
        <div ref={searchContainer} className={"sm-inline-search"+(searchOpen?" is-open":"")}>
          <button ref={searchButton} type="button" className="sm-inline-search-icon" aria-label="Search projects" aria-expanded={searchOpen} onClick={()=>{if(searchOpen){searchInput.current?.focus();return;}priorCard.current=current;setSearchOpen(true);}}><Search size={19}/></button>
          <input ref={searchInput} type="search" tabIndex={searchOpen?0:-1} placeholder="Search cards, projects, dates..." aria-label="Search projects" value={searchText} onChange={e=>setSearchText(e.target.value)} onKeyDown={e=>{if(e.key==="Escape"){e.preventDefault();closeSearch();}if(e.key==="Enter"&&ids.length){navigate(ids[0]);}}}/>
          <button type="button" className="sm-inline-search-close" aria-label="Close search" tabIndex={searchOpen?0:-1} onClick={closeSearch}><X size={16}/></button>
        </div>
        <GlobalMenu/>
        <a href="/?card=login" className="home-gallery-account" aria-label="Login or account" title="Login or account" onClick={e=>{e.preventDefault();setSearchOpen(false);setSearchText("");setSearchQuery("");currentRef.current="login";navigate("login");}}><UserRound size={21}/></a>
      </div>
    </header>
    {searching&&ids.length===0&&<div className="sm-carousel-search-empty" role="status"><strong>No matching cards or projects</strong><span>Try another name.</span></div>}
    <main id="content" className="sm-carousel-main">
      {error&&<p className="sm-carousel-error" role="alert">{error}</p>}
      <div className="sm-carousel-stage" aria-label="Music video cards" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        {ids.map((id,i)=>{
          const distance=i-activeIndex;
          const visible=Math.abs(distance)<=2;
          if(!visible)return null;
          const tile=tiles.find(t=>t.id===id);
          return <section key={id} className={"sm-carousel-card "+(distance===0?"is-active":Math.abs(distance)===1?"is-neighbor"+(hoveredSide===id?" is-side-hovered":""):"is-distant"+(hoveredSide===id?" is-distant-hovered":""))} aria-label={id==="showcase"?"SingMotion AI Showcase":id==="home"?"Audio upload":id==="login"?"Login":tile?.name} aria-hidden={undefined} style={{"--distance":distance,"--depth":Math.abs(distance),"--drag":distance===0?dragging:0} as React.CSSProperties} >
            {distance!==0&&<button type="button" className="sm-carousel-side-hit" onPointerEnter={()=>setHoveredSide(id)} onPointerLeave={()=>setHoveredSide(null)} onFocus={()=>setHoveredSide(id)} onBlur={()=>setHoveredSide(null)} aria-label={`Show ${id==="showcase"?"SingMotion AI Showcase":id==="home"?"Audio Upload":id==="login"?"Login":tile?.name||"project"}`} onClick={()=>navigate(id)}/> }
            {id==="showcase"?<ShowcaseCard active={distance===0} visible={visible} onCreate={()=>navigate("home")} published={publishedShowcase} onPublish={setPublishedShowcase}/>:id==="home"?<div className="sm-carousel-home">
              <span className="sm-carousel-song-icon"><Music2 size={29}/></span>
              <h1>Turn your song<br/>into a music video</h1>
              <p>Watch your music come alive with realistic lip-sync, fluid natural movements, and expressive performances that follow the rhythm and emotion of your song.</p>
              <label className="sm-carousel-drop" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void selectAudio(e.dataTransfer.files?.[0]);}}>
                <input type="file" disabled={uploading} accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4" aria-label="Choose audio file" onChange={e=>{void selectAudio(e.target.files?.[0]);e.currentTarget.value="";}}/>
                {uploading?<LoaderCircle className="sm-spinning" size={32}/>:<CloudUpload size={42}/>}
                <strong>{uploading?"Uploading your song…":audio?"Replace uploaded audio":"Drop your audio here or click to browse"}</strong>
                <small>MP3, WAV, M4A · up to 50 MB</small>
              </label>
              {audio&&<div className="sm-carousel-audio-ready"><CheckCircle2 size={16}/><span title={audio.name}>{audio.name}</span>{Number.isFinite(audio.duration)&&<small>{Math.round(audio.duration||0)}s</small>}</div>}
              {uploadError&&<p className="sm-carousel-inline-error" role="alert">{uploadError}</p>}
              {audio&&<button className="sm-carousel-primary" type="button" onClick={continueToStudio}>Continue <ArrowRight size={17}/></button>}
            </div>:id==="login"?<div className="sm-carousel-login">
              <span className="sm-carousel-song-icon"><LogIn size={27}/></span>
              <h1>Under Construction</h1>
              <p>Your private music video workspace.</p>
              <p className="sm-login-explanation">Email sign-in is not active yet. Projects are currently linked to this browser's private demo session.</p>
              <button type="button" className="sm-carousel-primary" onClick={()=>{if(audio)continueToStudio();else navigate("home");}}>Continue to workspace <ArrowRight size={17}/></button>
              <button type="button" className="sm-carousel-demo-disconnect" onClick={()=>void disconnectDemoWorkspace()}>Disconnect this browser’s demo projects</button>
            </div>:tile?<ProjectCarouselCard tile={tile} active={distance===0}/>:null}
          </section>;
        })}
        {([-1,1] as const).map(direction=>{
          const target=ids[activeIndex+direction];
          if(!target)return null;
          return <button key={direction} type="button"
            className={"sm-carousel-side-zone "+(direction<0?"is-left":"is-right")}
            aria-label={`Select ${target==="showcase"?"Showcase":target==="home"?"Home":target==="login"?"Login":tiles.find(t=>t.id===target)?.name||"project"}`}
            onPointerEnter={()=>setHoveredSide(target)}
            onPointerLeave={()=>setHoveredSide(null)}
            onFocus={()=>setHoveredSide(target)}
            onBlur={()=>setHoveredSide(null)}
            onClick={()=>{setHoveredSide(null);navigate(target);}} />;
        })}
      </div>
      {ids.length>1&&<nav className="sm-carousel-controls" aria-label="Carousel navigation">
        <button className="sm-carousel-nav-arrow" type="button" onClick={()=>step(-1)} disabled={activeIndex===0} aria-label="Previous card"><ChevronLeft size={17} strokeWidth={2}/></button>
        <div className="sm-carousel-indicators" role="group" aria-label="Select carousel card">
          {ids.slice(Math.max(0,Math.min(activeIndex-2,ids.length-5)),Math.max(0,Math.min(activeIndex-2,ids.length-5))+5).map(id=>{
            const i=ids.indexOf(id);
            const label=id==="showcase"?"SingMotion AI Showcase":id==="home"?"Home / Audio upload":id==="login"?"Login":tiles.find(t=>t.id===id)?.name||"Project";
            return <button key={id} className={"sm-carousel-indicator"+(i===activeIndex?" is-current":"")} type="button" aria-label={`Go to ${label}, card ${i+1} of ${ids.length}`} aria-current={i===activeIndex?"step":undefined} onClick={()=>navigate(id)}><span/></button>;
          })}
        </div>
        <button className="sm-carousel-nav-arrow" type="button" onClick={()=>step(1)} disabled={activeIndex===ids.length-1} aria-label="Next card"><ChevronRight size={17} strokeWidth={2}/></button>
      </nav>}
      {loading&&<p className="sm-carousel-loading" role="status">Loading projects…</p>}
    </main>
  </div>;
}
function ProjectCarouselCard({tile,active}:{tile:Tile;active:boolean}){
  const video=useRef<HTMLVideoElement>(null);
  const [sound,setSound]=useState(false);
  const [mediaError,setMediaError]=useState(false);
  useEffect(()=>{
    const v=video.current;
    if(!v)return;
    if(!active){v.pause();v.muted=true;setSound(false);return;}
    v.muted=true;setSound(false);
    const play=()=>{if(!document.hidden)void v.play().catch(()=>{});else v.pause();};
    play();
    document.addEventListener("visibilitychange",play);
    return()=>{document.removeEventListener("visibilitychange",play);v.pause();};
  },[active,tile.videoUrl]);
  const status=tile.state.toLowerCase();
  const complete=status==="completed"&&!!tile.videoUrl;
  const label=status==="draft"||status==="prepared"?"Prepared":status==="processing"||status==="rendering"?"Processing":status==="submitted"||status==="pending"||status==="authorized"||status==="submitting"||status==="uncertain"?"Pending":status==="failed"?"Failed":status==="completed"?"Completed":tile.state;
  const explanation=label==="Prepared"?"Ready for your next step.":label==="Processing"?"Your music video is being generated.":label==="Pending"?"Waiting for the provider.":label==="Failed"?"Open to review the failed attempt.":"Open to view your project.";
  return <div className={"sm-carousel-project "+(complete?"has-video":"has-status")}>
    {tile.imageId&&<img className="sm-carousel-poster" src={"/api/assets/"+encodeURIComponent(tile.imageId)} alt="" loading="lazy"/>}
    {complete&&!mediaError&&<video ref={video} className="sm-carousel-video" src={active?tile.videoUrl:undefined} poster={tile.imageId?"/api/assets/"+encodeURIComponent(tile.imageId):undefined} muted playsInline loop preload="metadata" onError={()=>setMediaError(true)}/>}
    {complete&&!mediaError?<button className="sm-carousel-sound" type="button" aria-label={sound?"Mute video":"Unmute video"} onClick={e=>{e.stopPropagation();const v=video.current;if(!v)return;v.muted=sound;setSound(!sound);}}>{sound?<Volume2 size={19}/>:<VolumeX size={19}/>}</button>:<div className="sm-carousel-status">
      {label==="Failed"?<AlertCircle size={35}/>:label==="Prepared"?<CheckCircle2 size={35}/>:<LoaderCircle className={label==="Pending"||label==="Processing"?"sm-spinning":""} size={35}/>}
      <strong>{label}</strong><p>{mediaError?"Video preview unavailable. Open the project to inspect it.":explanation}</p>
    </div>}
    <div className="sm-carousel-project-footer">
      <strong title={tile.name}>{tile.name}</strong>
      <Link href={tile.href} className="sm-carousel-open" onClick={()=>{video.current?.pause();try{sessionStorage.setItem("singmotion-carousel-return",tile.id);}catch{}}}>Open project <ArrowRight size={16}/></Link>
    </div>
  </div>;
}

function ShowcaseCard({active,visible,onCreate,published,onPublish}:{active:boolean;visible:boolean;onCreate:()=>void;published:{title:string;videoUrl:string}|null;onPublish:(value:{title:string;videoUrl:string})=>void}){
  const video=useRef<HTMLVideoElement>(null);
  const [sound,setSound]=useState(false);
  const [failed,setFailed]=useState(false);
  const [adminProjects,setAdminProjects]=useState<{id:string;artist:string;selected:boolean}[]|null>(null);
  const [selecting,setSelecting]=useState(false);
  const [selectionError,setSelectionError]=useState("");
  // Start buffering the public Showcase stream in parallel with its metadata.
  const videoUrl=published===null?"/api/showcase?video=1":published.videoUrl;
  const posterUrl=showcase.posterUrl;
  const hasVideo=videoUrl.startsWith("https://") || videoUrl.startsWith("/");
  useEffect(()=>{setFailed(false);},[videoUrl]);
  useEffect(()=>{fetch("/api/showcase?admin=1",{cache:"no-store"}).then(r=>r.ok?r.json():null).then(data=>{if(data?.projects)setAdminProjects(data.projects);}).catch(()=>{});},[]);
  const chooseShowcase=async(id:string)=>{setSelecting(true);setSelectionError("");try{const r=await fetch("/api/showcase",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id})});const d=await r.json();if(!r.ok)throw new Error(d.error||"Selection failed");onPublish({title:d.title,videoUrl:d.videoUrl+"#"+Date.now()});setAdminProjects(old=>old?.map(p=>({...p,selected:p.id===id}))||null);}catch(e){setSelectionError((e as Error).message);}finally{setSelecting(false);}};
  useEffect(()=>{
    const v=video.current;
    if(!v)return;
    if(!active){v.pause();v.muted=true;setSound(false);return;}
    v.muted=true;setSound(false);
    const sync=()=>{if(document.hidden)v.pause();else void v.play().catch(()=>{});};
    sync();
    document.addEventListener("visibilitychange",sync);
    return()=>{document.removeEventListener("visibilitychange",sync);v.pause();};
  },[active,visible,videoUrl]);
  return <div className="sm-showcase-card">
    {posterUrl&&<img className="sm-showcase-poster" src={posterUrl} alt="" loading="eager"/>}
    {hasVideo&&visible&&!failed&&<video ref={video} className="sm-carousel-video" src={videoUrl} poster={posterUrl||undefined} muted playsInline loop preload="auto" onError={()=>setFailed(true)}/>}
    {hasVideo&&visible&&!failed&&<button className="sm-carousel-sound" type="button" aria-label={sound?"Mute showcase video":"Unmute showcase video"} onClick={e=>{e.stopPropagation();const v=video.current;if(v){v.muted=sound;setSound(!sound);}}}>{sound?<Volume2 size={19}/>:<VolumeX size={19}/>}</button>}
    {(!hasVideo||failed)&&<div className="sm-showcase-fallback"><Music2 size={38}/><span>{failed?"Showcase video unavailable":"Showcase video coming soon"}</span></div>}
    <span className="sm-showcase-label">Lip-Synced with SingMotion AI</span>
    <div className="sm-carousel-project-footer">
      <strong>{showcase.title}</strong>
      {adminProjects&&<div className="sm-showcase-admin" onClick={e=>e.stopPropagation()}><select aria-label="Choose completed showcase project" value={adminProjects.find(p=>p.selected)?.id||""} disabled={selecting} onChange={e=>{if(e.target.value)void chooseShowcase(e.target.value);}}><option value="">Choose showcase video…</option>{adminProjects.map(p=><option key={p.id} value={p.id}>{p.artist} · {p.id.slice(0,8)}</option>)}</select>{selectionError&&<small role="alert">{selectionError}</small>}</div>}
      <button className="sm-carousel-open" type="button" onClick={e=>{e.stopPropagation();onCreate();}}>Create your own <ArrowRight size={16}/></button>
    </div>
  </div>;
}
