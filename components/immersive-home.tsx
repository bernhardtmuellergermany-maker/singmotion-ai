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
 const [clip,setClip]=useState<{title:string;url:string}|null>(null);
 const [playing,setPlaying]=useState(false);
 const [muted,setMuted]=useState(true);
 const [failed,setFailed]=useState(false);
 const [visible,setVisible]=useState(true);
 useEffect(()=>{
  let active=true;
  fetch("/api/showcase",{cache:"no-store"})
   .then(r=>r.ok?r.json():null)
   .then(data=>{if(!active)return;const url=typeof data?.videoUrl==="string"&&(/^(https:\/\/|\/)/.test(data.videoUrl))?data.videoUrl:"";
    setClip(url?{title:typeof data.title==="string"?data.title:showcase.title,url}:null);})
   .catch(()=>{if(active)setClip(null)});
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
 return <div className="sm-immersive-home">
  <div className="sm-immersive-first-screen">
   <SiteHeader className="sm-immersive-header" onAccountClick={()=>window.location.assign("/login")}/>
   <main id="content" className="sm-immersive-hero">
    <div className="sm-immersive-atmosphere" aria-hidden="true"/>
    <div className="sm-immersive-desktop-intro">
     <h1>Turn your song into a <span>music video.</span></h1>
     <p>With SingMotion AI — your song, your performance.</p>
     <Link className="sm-immersive-cta" href="/studio">Create your music video <ArrowRight size={20}/></Link>
    </div>
    <section className="sm-immersive-video-stage" aria-label="SingMotion AI music video showcase">
     <div className="sm-immersive-video-frame">
      {clip&&!failed?<video ref={player} className="sm-immersive-player" src={clip.url} poster={showcase.posterUrl||"/artwork/singmotion-stage.webp"} playsInline muted loop preload="metadata" onError={()=>setFailed(true)} aria-label={clip.title}/>:
       <div className="sm-immersive-video-poster" role="img" aria-label="SingMotion music video showcase artwork"><span>{failed?"Showcase video currently unavailable": "Music video showcase"}</span></div>}
      <div className="sm-immersive-video-controls">
       {clip&&!failed&&<><button type="button" onClick={toggle} aria-label={playing?"Pause video":"Play video"}>{playing?<Pause size={21}/>:<Play size={21}/>}</button>
       <button type="button" onClick={toggleSound} aria-label={muted?"Turn on video sound":"Mute video"}>{muted?<VolumeX size={21}/>:<Volume2 size={21}/>}</button></>}
      </div>
      <span className="sm-immersive-video-caption">SingMotion AI Showcase</span>
     </div>
    </section>
    <div className="sm-immersive-mobile-overlay">
     <span className="sm-immersive-eyebrow">Showcase</span>
     <h1>Turn your song into a music video</h1>
     <Link className="sm-immersive-cta" href="/studio">Create your music video <ArrowRight size={20}/></Link>
    </div>
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
