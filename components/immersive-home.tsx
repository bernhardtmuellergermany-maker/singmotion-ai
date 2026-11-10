"use client";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import {ArrowRight,Music2,ImagePlus,Clapperboard,Play,Pause,Volume2,VolumeX,ChevronDown} from "lucide-react";
import {SiteHeader} from "./site-header";
import {showcase} from "@/lib/showcase";

/** Home-only visual presentation of the existing public, owner-approved showcase.
 * No private project discovery, new endpoints, checkout or login mechanisms.
 * The public API currently exposes ONE approved video; do not invent a feed. */
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
   setCurrentClip(index=>Math.max(0,Math.min(clips.length-1,index+direction)));
 };
 const touchStart=(event:React.TouchEvent)=>{
   const t=event.touches[0];if(t)swipeStart.current={x:t.clientX,y:t.clientY};
 };
 const touchEnd=(event:React.TouchEvent)=>{
   const start=swipeStart.current;swipeStart.current=null;
   const t=event.changedTouches[0];if(!start||!t)return;
   const dy=t.clientY-start.y,dx=t.clientX-start.x;
   if(Math.abs(dy)>65&&Math.abs(dy)>Math.abs(dx)*1.2)advance(dy<0?1:-1);
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
     <div className="sm-immersive-video-frame">
      {clip&&!failed?<video key={clip.url} ref={player} className="sm-immersive-player" src={clip.url} poster={showcase.posterUrl||"/artwork/singmotion-stage.webp"} playsInline muted loop preload="metadata" onError={()=>setFailed(true)} aria-label={clip.title}/>:
       <div className="sm-immersive-video-poster" role="img" aria-label="SingMotion music video showcase artwork"><span>{failed?"Showcase video currently unavailable": "Music video showcase"}</span></div>}
      <div className="sm-immersive-video-controls">
       {clip&&!failed&&<><button type="button" onClick={toggle} aria-label={playing?"Pause video":"Play video"}>{playing?<Pause size={21}/>:<Play size={21}/>}</button>
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
    <a href="#how-it-works" className="sm-immersive-scroll-cue" aria-label="Explore how it works"><ChevronDown size={23}/></a>
   </main>
  </div>
  <div className="sm-immersive-below">
   <section id="how-it-works" className="sm-immersive-steps" aria-labelledby="sm-how-title">
    <h2 id="sm-how-title">How it <span>works</span></h2>
    <p>Create your own music video in four simple steps.</p>
    <ol>
     <li><Music2 aria-hidden="true"/><strong>Upload audio</strong><span>Upload your song and select the clip.</span></li>
     <li><Clapperboard aria-hidden="true"/><strong>Describe performance</strong><span>Describe the look and movement.</span></li>
     <li><ImagePlus aria-hidden="true"/><strong>Add artist photo</strong><span>Choose your photo and video format.</span></li>
     <li><Play aria-hidden="true"/><strong>Generate video</strong><span>Review, pay and generate.</span></li>
    </ol>
   </section>
   <section className="sm-immersive-creations" aria-labelledby="sm-creation-title">
    <h2 id="sm-creation-title">Stunning <span>Creations</span></h2>
    <p>Real examples. Real emotion.</p>
    {clip&&!failed?<div className="sm-immersive-creation-grid">
     <a href="#content" className="sm-immersive-creation" aria-label="View approved SingMotion showcase video">
      <video src={clip.url} playsInline muted preload="metadata" poster={showcase.posterUrl||"/artwork/singmotion-stage.webp"}/>
      <span>{clip.title}</span>
     </a>
    </div>:<p className="sm-immersive-no-example">Approved showcase videos will appear here.</p>}
   </section>
   <section className="sm-immersive-final" aria-labelledby="sm-ready-title">
    <h2 id="sm-ready-title">Ready to create your next <span>music video?</span></h2>
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
