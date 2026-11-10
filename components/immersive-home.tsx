"use client";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import {ArrowRight,Music2,ImagePlus,Clapperboard,Play,Pause,Volume2,VolumeX,ChevronDown,ChevronLeft,ChevronRight} from "lucide-react";
import {SiteHeader} from "./site-header";
import {showcase} from "@/lib/showcase";

/** Home-only visual presentation of the existing public, owner-approved showcase.
 * No private project discovery, new endpoints, checkout or login mechanisms.
 * The public API currently exposes ONE approved video; do not invent a feed. */
type ShowcaseClip = {title:string;url:string};

/** Desktop-only, independent player: switching a slide always swaps its actual source. */
function DesktopShowcaseCarousel({clips}:{clips:ShowcaseClip[]}){
 const slides:ShowcaseClip[]=clips.length>=3?clips:[...clips,...Array.from({length:3-clips.length},(_,i)=>({title:"Music video coming soon "+(i+1),url:""}))];
 const [selected,setSelected]=useState(0);
 const [playing,setPlaying]=useState(false);
 const [muted,setMuted]=useState(true);
 const [broken,setBroken]=useState(false);
 const video=useRef<HTMLVideoElement>(null);
 const startX=useRef<number|null>(null);
 const current=slides[selected%slides.length];
 const navigate=(direction:number)=>{
   video.current?.pause();
   setPlaying(false);
   setBroken(false);
   setSelected(i=>(i+direction+slides.length)%slides.length);
 };
 const toggle=()=>{
   const node=video.current;
   if(!node||broken)return;
   if(node.paused) void node.play().catch(()=>setPlaying(false));
   else node.pause();
 };
 const neighbor=(delta:number)=>slides[(selected+delta+slides.length)%slides.length];
 const cover=showcase.posterUrl||"/artwork/singmotion-stage.webp";
 return <section className="sm-desktop-showcase" id="showcase" aria-label="Music video carousel">
   <div className="sm-desktop-carousel" onTouchStart={e=>{startX.current=e.touches[0]?.clientX??null}} onTouchEnd={e=>{const x=e.changedTouches[0]?.clientX;if(x!==undefined&&startX.current!==null&&Math.abs(x-startX.current)>55)navigate(x<startX.current?1:-1);startX.current=null}} onKeyDown={e=>{if(e.key==="ArrowLeft"){e.preventDefault();navigate(-1)}if(e.key==="ArrowRight"){e.preventDefault();navigate(1)}}} tabIndex={0} aria-label="Browse showcased videos with arrow keys or swipe">
     <button className="sm-desktop-side sm-desktop-side-prev" type="button" aria-label="Previous video" onClick={()=>navigate(-1)}>
       <span className="sm-desktop-side-picture" style={{backgroundImage:`linear-gradient(#09051555,#09051577),url("${cover}")`}}/>
       <span className="sm-desktop-side-name">{neighbor(-1).title}</span>
     </button>
     <div className="sm-desktop-active-card">
       {current.url&&!broken?<video key={current.url} ref={video} className="sm-desktop-main-video" src={current.url} poster={cover} preload="metadata" playsInline loop muted={muted} onClick={toggle} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onError={()=>{setBroken(true);setPlaying(false)}} aria-label={current.title}/>:
        <div className="sm-desktop-video-empty" style={{backgroundImage:`linear-gradient(#0b061744,#0b0617b0),url("${cover}")`}} role="img" aria-label="Video coming soon"/>}
       {(!playing||!current.url||broken)&&<button className="sm-desktop-center-play" type="button" disabled={!current.url||broken} onClick={toggle} aria-label={current.url&&!broken?"Play "+current.title:"Video coming soon"}><Play size={29} fill="currentColor"/></button>}
       <div className="sm-desktop-card-footer"><strong>SingMotion AI Showcase</strong><span>{current.url&&!broken?current.title:"Coming soon"}</span></div>
       {current.url&&!broken&&<button type="button" className="sm-desktop-mute" onClick={()=>setMuted(v=>!v)} aria-label={muted?"Unmute video":"Mute video"}>{muted?<VolumeX size={20}/>:<Volume2 size={20}/>}</button>}
     </div>
     <button className="sm-desktop-side sm-desktop-side-next" type="button" aria-label="Next video" onClick={()=>navigate(1)}>
       <span className="sm-desktop-side-picture" style={{backgroundImage:`linear-gradient(#09051555,#09051577),url("${cover}")`}}/>
       <span className="sm-desktop-side-name">{neighbor(1).title}</span>
     </button>
   </div>
   <div className="sm-desktop-carousel-navigation">
     <button type="button" aria-label="Previous video" onClick={()=>navigate(-1)}><ChevronLeft size={22}/></button>
     <div className="sm-desktop-carousel-dots" role="group" aria-label="Choose video">{slides.map((item,i)=><button key={i} className={selected===i?"active":""} type="button" aria-label={"Show video "+(i+1)} aria-current={selected===i?"true":undefined} onClick={()=>navigate(i-selected)}/>)}</div>
     <button type="button" aria-label="Next video" onClick={()=>navigate(1)}><ChevronRight size={22}/></button>
     <span className="sm-desktop-slide-count" aria-live="polite">{selected+1} / {slides.length}</span>
   </div>
 </section>;
}

export function ImmersiveHome(){
 const player=useRef<HTMLVideoElement>(null);
 const swipeStart=useRef<{x:number;y:number}|null>(null);
 const swipeLock=useRef(false);
 const [clips,setClips]=useState<{title:string;url:string}[]>([]);
 const [currentClip,setCurrentClip]=useState(0);
 const clip=clips[currentClip]??null;
 const [playing,setPlaying]=useState(false);
 const [muted,setMuted]=useState(true);
 const [failed,setFailed]=useState(false);
 const [visible,setVisible]=useState(true);
 const [loadingVideo,setLoadingVideo]=useState(true);
 const pullStartedAt=useRef<number|null>(null);
 const [portraitSlide,setPortraitSlide]=useState(0);
 useEffect(()=>{
  let active=true;
  fetch("/api/showcase",{cache:"no-store"})
   .then(r=>r.ok?r.json():null)
   .then(data=>{if(!active)return;
    // One currently approved public showcase slot. When the public API
    // provides additional APPROVED clips, swipe can browse those as well.
    const candidates=Array.isArray(data?.videos)?data.videos:[data];
    const publicClips=candidates.flatMap((item:unknown)=>{
      if(!item||typeof item!=="object")return [];
      const entry=item as {videoUrl?:unknown;title?:unknown};
      const url=entry.videoUrl;
      if(typeof url!=="string"||!(url.startsWith("/")&&!url.startsWith("//")||url.startsWith("https://")))return [];
      return [{title:typeof entry.title==="string"?entry.title:showcase.title,url}];
    });
    setClips(publicClips);
    setCurrentClip(0);
    setLoadingVideo(true);
   })
   .catch(()=>{if(active)setClips([])});
  return()=>{active=false};
 },[]);
 useEffect(()=>{
  const v=player.current;if(!v||!clip||failed)return;
  const observer=new IntersectionObserver(entries=>setVisible(entries[0]?.isIntersecting??false),{threshold:.25});
  observer.observe(v);
  return()=>observer.disconnect();
 },[clip,failed]);
 useEffect(()=>{
  const v=player.current;if(!v||!clip)return;
  if(!visible||document.hidden){v.pause();return;}
  v.muted=muted;
  void v.play().then(()=>setPlaying(true)).catch(()=>setPlaying(false));
  const update=()=>{if(document.hidden){v.pause();setPlaying(false)}};
  document.addEventListener("visibilitychange",update);
  return()=>document.removeEventListener("visibilitychange",update);
 },[clip,visible,muted,failed]);
 const toggle=()=>{
  const v=player.current;if(!v)return;
  if(v.paused){void v.play().then(()=>setPlaying(true)).catch(()=>setPlaying(false));}
  else{v.pause();setPlaying(false);}
 };
 const toggleSound=()=>{const v=player.current;if(!v)return;v.muted=!v.muted;setMuted(v.muted);};
 const advance=(direction:1|-1)=>{
   if(clips.length<2)return;
   player.current?.pause();
   setPlaying(false);
   setFailed(false);
   setLoadingVideo(true);
   setCurrentClip(index=>(index+direction+clips.length)%clips.length);
 };
 const touchStart=(event:React.TouchEvent)=>{
   const t=event.touches[0];if(t){swipeStart.current={x:t.clientX,y:t.clientY};pullStartedAt.current=currentClip===0?Date.now():null;}
 };
 const touchEnd=(event:React.TouchEvent)=>{
   const start=swipeStart.current;swipeStart.current=null;
   const t=event.changedTouches[0];if(!start||!t)return;
   const dy=t.clientY-start.y,dx=t.clientX-start.x;
   if(Math.abs(dy)>65&&Math.abs(dy)>Math.abs(dx)*1.2){
    // Pull-to-refresh only from the first reel; allow a deliberate downward drag.
    if(dy>115&&currentClip===0&&pullStartedAt.current!==null){window.location.reload();return;}
    advance(dy<0?1:-1);
   }
   pullStartedAt.current=null;
 };
 const wheel=(event:React.WheelEvent)=>{
   if(typeof window!=="undefined"&&window.matchMedia("(max-width:760px)").matches && Math.abs(event.deltaY)>30 && !swipeLock.current){
     swipeLock.current=true;
     advance(event.deltaY>0?1:-1);
     window.setTimeout(()=>{swipeLock.current=false},480);
   }
 };
 const keyDown=(event:React.KeyboardEvent)=>{
   if(event.key==="ArrowDown"||event.key==="PageDown"){event.preventDefault();advance(1)}
   if(event.key==="ArrowUp"||event.key==="PageUp"){event.preventDefault();advance(-1)}
 };
 return <div className="sm-immersive-home">
  <div className="sm-immersive-first-screen">
   <SiteHeader className="sm-immersive-header" onAccountClick={()=>window.location.assign("/login")}/>
   <main id="content" className="sm-immersive-hero" onTouchStart={touchStart} onTouchEnd={touchEnd} onWheel={wheel} onKeyDown={keyDown} tabIndex={-1}>
    <div className="sm-immersive-atmosphere" aria-hidden="true"/>
    <div className="sm-immersive-desktop-intro">
     <h1>Turn your song into a <span>music video.</span></h1>
     <p>With SingMotion AI — your song, your performance.</p>
     <Link className="sm-immersive-cta" href="/studio">Create your music video <ArrowRight size={20}/></Link>
    </div>
    <section className="sm-immersive-video-stage" aria-label="SingMotion AI music video showcase">
     <div className="sm-immersive-video-frame" key={currentClip}>
      <div className="sm-immersive-video-backup" style={{backgroundImage:`linear-gradient(0deg,rgba(8,5,18,.55),rgba(8,5,18,.1)),url("${showcase.posterUrl||"/artwork/singmotion-stage.webp"}")`}} aria-hidden="true"/>
      {loadingVideo&&clip&&!failed&&<div className="sm-immersive-video-loading" aria-hidden="true"/>}
      {clip&&!failed?<video key={clip.url} ref={player} className="sm-immersive-player" src={clip.url} poster={showcase.posterUrl||"/artwork/singmotion-stage.webp"} playsInline muted loop preload="auto" onLoadedData={()=>setLoadingVideo(false)} onPlaying={()=>{setPlaying(true);setLoadingVideo(false)}} onWaiting={()=>setLoadingVideo(true)} onError={()=>{setFailed(true);setLoadingVideo(false)}} onClick={toggle} aria-label={clip.title}/>:
       <div className="sm-immersive-video-poster" role="img" aria-label="SingMotion music video showcase artwork"><span>{failed?"Showcase video currently unavailable": "Music video showcase"}</span></div>}
      <div className="sm-immersive-video-controls">
       {clip&&!failed&&<><button type="button" className="sm-immersive-play-toggle" onClick={toggle} aria-label={playing?"Pause video":"Play video"}>{playing?<Pause size={21}/>:<Play size={21}/>}</button>
       <button type="button" onClick={toggleSound} aria-label={muted?"Turn on video sound":"Mute video"}>{muted?<VolumeX size={21}/>:<Volume2 size={21}/>}</button></>}
      </div>
      <span className="sm-immersive-video-caption">SingMotion AI Showcase</span>
     </div>
    </section>
    <div className="sm-immersive-mobile-overlay">
     <h1>Turn your song into a music video.</h1>
     <p>Make your music come alive with SingMotion AI.</p>
     <Link className="sm-immersive-cta" href="/studio">Create your music video <ArrowRight size={20}/></Link>
    </div>
    {clips.length>1&&<div className="sm-immersive-feed-position" aria-live="polite">{currentClip+1} / {clips.length}</div>}
    <a href="#showcase" className="sm-immersive-scroll-cue" aria-label="Explore how it works"><ChevronDown size={23}/></a>
   </main>
  </div>
  <div className="sm-immersive-below">
   <DesktopShowcaseCarousel clips={clips}/>
   <section id="how-it-works" className="sm-immersive-steps" aria-labelledby="sm-how-title">
    <h2 id="sm-how-title">How it <span>works</span></h2>
    <p>In just a few steps to your own music video.</p>
    <ol>
     <li><Music2 aria-hidden="true"/><strong>1. Upload your audio</strong><span>Add your song or choose from your library.</span></li>
     <li><ImagePlus aria-hidden="true"/><strong>2. Describe the performance</strong><span>Tell us how it should look or add a photo of yourself.</span></li>
     <li><Play aria-hidden="true"/><strong>3. Generate the video</strong><span>Get your AI music video in seconds.</span></li>
    </ol>
   </section>
   <section className="sm-immersive-creations" aria-labelledby="sm-creation-title">
    <h2 id="sm-creation-title">Stunning <span>Creations</span></h2>
    <p>Real examples. Real emotion.</p>
    {clip&&!failed?<div className="sm-immersive-creation-grid">
     <a href="#content" className="sm-immersive-creation" aria-label="View approved SingMotion showcase video">
      <video src={clip.url} playsInline muted preload="none" poster={showcase.posterUrl||"/artwork/singmotion-stage.webp"}/>
      <span>{clip.title}</span>
     </a>
    </div>:<p className="sm-immersive-no-example">Approved showcase videos will appear here.</p>}
    <div className="sm-immersive-placeholder-gallery" aria-label="Upcoming portrait video carousel">
      <div className="sm-immersive-placeholder-track" role="group" aria-label="9 by 16 video placeholders" style={{transform:"translateX(-"+portraitSlide*25+"%)"}}>
        {[0,1,2,3].map((n)=><div key={n} className={"sm-immersive-placeholder-card"+(portraitSlide===n?" is-selected":"")} role="img" aria-label={"Portrait showcase "+(n+1)+", video coming soon"}>
          <span className="sm-immersive-placeholder-play"><Play size={28} fill="currentColor"/></span>
          <small>Coming soon</small>
        </div>)}
      </div>
      <div className="sm-immersive-placeholder-nav">
        <button type="button" disabled={portraitSlide===0} onClick={()=>setPortraitSlide(i=>Math.max(0,i-1))} aria-label="Previous portrait">‹</button>
        <span>{portraitSlide+1} / 4</span>
        <button type="button" disabled={portraitSlide===3} onClick={()=>setPortraitSlide(i=>Math.min(3,i+1))} aria-label="Next portrait">›</button>
      </div>
    </div>
   </section>
   <section className="sm-immersive-final" aria-labelledby="sm-ready-title">
    <h2 id="sm-ready-title">Ready to create your<br/>next <span>music video?</span></h2>
    <Link className="sm-immersive-cta" href="/studio">Create your music video <ArrowRight size={20}/></Link>
   </section>
   <footer className="sm-immersive-footer">
    <Link className="sm-immersive-footer-logo" href="/">SingMotion <span>AI</span></Link>
    <nav aria-label="Service and legal">
     <Link href="/plans">Prices</Link><Link href="/help">Help</Link><Link href="/contact">Contact</Link><Link href="/legal">Legal &amp; Privacy</Link><Link href="/terms">Terms</Link>
    </nav>
   </footer>
  </div>
 </div>;
}
