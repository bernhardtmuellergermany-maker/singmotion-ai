"use client";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import {ArrowRight,Music2,ImagePlus,Play,Volume2,VolumeX,ChevronDown,ChevronLeft,ChevronRight} from "lucide-react";
import {SiteHeader} from "./site-header";
import {showcase} from "@/lib/showcase";

/** Home-only visual presentation of the existing public, owner-approved showcase.
 * No private project discovery, new endpoints, checkout or login mechanisms.
 * The public API serves only per-channel, explicitly approved videos. */
type ShowcaseClip = {title:string;url:string};

/** A five-card filmstrip translates as one carousel, then recycles offscreen cards.
 * Only owner-approved video URLs are playable; upcoming slots stay labeled.
 */
function DesktopShowcaseCarousel({clips}:{clips:ShowcaseClip[]}){
 const slides:ShowcaseClip[]=clips.length?clips:[{title:"Music video coming soon",url:""}];
 const [selected,setSelected]=useState(0);
 const [motion,setMotion]=useState(0);
 const [settling,setSettling]=useState(false);
 const [target,setTarget]=useState<number|null>(null);
 const [playing,setPlaying]=useState(false);
 const [muted,setMuted]=useState(false);
 const [broken,setBroken]=useState(false);
 const video=useRef<HTMLVideoElement>(null);
 const touchX=useRef<number|null>(null);
 const count=slides.length;
 const wrap=(index:number)=>(index+count*10)%count;
 const active=slides[selected];
 const cover=showcase.posterUrl||"/artwork/singmotion-stage.webp";
 const move=(direction:number,destination?:number)=>{
  if(motion!==0||settling)return;
  video.current?.pause();
  setPlaying(false);
  setMotion(direction>0?-1:1);
  setTarget(destination===undefined?wrap(selected+(direction>0?1:-1)):wrap(destination));
 };
 const endMove=(e:React.TransitionEvent<HTMLDivElement>)=>{
  if(e.target!==e.currentTarget||e.propertyName!=="transform"||motion===0)return;
  setSettling(true);
  setSelected(target??wrap(selected-motion));
  setMotion(0);
  setTarget(null);
  setBroken(false);
  window.requestAnimationFrame(()=>window.requestAnimationFrame(()=>setSettling(false)));
 };
 const toggle=()=>{
  const element=video.current;
  if(!element||broken)return;
  if(element.paused)void element.play().catch(()=>setPlaying(false));
  else element.pause();
 };
 const slots=[-2,-1,0,1,2];
 return <section className="sm-desktop-showcase" id="showcase" aria-label="Music video carousel">
  <div className="sm-moving-carousel" tabIndex={0} aria-label="Use left and right arrows to move through music videos"
   onKeyDown={e=>{if(e.key==="ArrowLeft"){e.preventDefault();move(-1)}else if(e.key==="ArrowRight"){e.preventDefault();move(1)}}}
   onTouchStart={e=>{touchX.current=e.touches[0]?.clientX??null}}
   onTouchEnd={e=>{const x=e.changedTouches[0]?.clientX;if(x!==undefined&&touchX.current!==null&&Math.abs(x-touchX.current)>50)move(x<touchX.current?1:-1);touchX.current=null}}>
   {slots.map(offset=>{
    const item=slides[wrap(selected+offset)];
    const isCenter=offset===0;
    const isSide=Math.abs(offset)===1;
    const slot=offset+motion;
    return <div key={offset} className={"sm-moving-card"+(isCenter?" is-center":"")+(isSide?" is-side":"")+(motion!==0&&isCenter?" is-leaving":"")+(motion!==0&&slot===0?" is-entering":"")+(settling?" no-transition":"")}
       style={{"--slot":(slot*83)+"%"} as React.CSSProperties}
       onTransitionEnd={isCenter?endMove:undefined}
       aria-hidden={Math.abs(slot)>1?true:undefined}>
      {isCenter&&item.url&&!broken?<video ref={video} key={item.url} src={item.url} poster={cover}
        playsInline loop muted={muted} preload="metadata" className="sm-moving-video"
        onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)}
        onError={()=>{setBroken(true);setPlaying(false)}} onClick={toggle} aria-label={item.title}/>:
       <div className="sm-moving-poster" style={{backgroundImage:"linear-gradient(0deg,#080513a6,#12091b3b),url('"+cover+"')"}}/>}
      {isCenter&&(!playing||!item.url||broken)&&<button className="sm-moving-play" type="button" disabled={!item.url||broken}
         aria-label={item.url&&!broken?"Play "+item.title:"Video coming soon"} onClick={toggle}><Play size={30} fill="currentColor"/></button>}
      {isCenter&&item.url&&!broken&&<button className="sm-moving-mute" type="button" aria-label={muted?"Unmute video":"Mute video"}
         onClick={()=>setMuted(m=>!m)}>{muted?<VolumeX size={20}/>:<Volume2 size={20}/>}</button>}
      {isSide&&<button className="sm-moving-side-tap" type="button" aria-label={offset<0?"Previous video":"Next video"} onClick={()=>move(offset<0?-1:1)}/>}
      <div className="sm-moving-caption"><strong>{isCenter?"SingMotion AI Showcase":item.title}</strong><span>{item.url?item.title:"Coming soon"}</span></div>
    </div>;
   })}
  </div>
  <div className="sm-desktop-carousel-navigation">
   <button type="button" aria-label="Previous video" onClick={()=>move(-1)} disabled={motion!==0}><ChevronLeft size={22}/></button>
   <div className="sm-desktop-carousel-dots" role="group" aria-label="Choose video">{slides.map((item,i)=><button key={i} className={selected===i?"active":""} type="button" aria-label={"Show video "+(i+1)} aria-current={selected===i?"true":undefined}
      disabled={motion!==0} onClick={()=>{if(i!==selected)move(i>selected?1:-1,i)}}/>)}</div>
   <button type="button" aria-label="Next video" onClick={()=>move(1)} disabled={motion!==0}><ChevronRight size={22}/></button>
   <span className="sm-desktop-slide-count" aria-live="polite">{selected+1} / {count}</span>
  </div>
 </section>;
}

export function ImmersiveHome(){
 const [clips,setClips]=useState<ShowcaseClip[]>([]);
 const [desktopClips,setDesktopClips]=useState<ShowcaseClip[]>([]);
 const [portraitClips,setPortraitClips]=useState<ShowcaseClip[]>([]);
 const [currentClip,setCurrentClip]=useState(0);
 const [muted,setMuted]=useState(false);
 const unlockSoundAfterGesture=useRef(false);
 const [failed,setFailed]=useState<Record<number,boolean>>({});
 const [loaded,setLoaded]=useState<Record<number,boolean>>({});
 const [dragging,setDragging]=useState(false);
 const [portraitSlide,setPortraitSlide]=useState(0);
 const feed=useRef<HTMLDivElement>(null);
 const touchStart=useRef<{x:number;y:number;atTop:boolean}|null>(null);
 const [refreshing,setRefreshing]=useState(false);
 const [pullOffset,setPullOffset]=useState(0);
 const clip=clips[currentClip]??null;
 const cover=showcase.posterUrl||"/artwork/singmotion-stage.webp";
 useEffect(()=>{
  let active=true;
  fetch("/api/showcase?channel=mobile",{cache:"no-store"})
   .then(r=>r.ok?r.json():null)
   .then(data=>{
    if(!active)return;
    const candidates=Array.isArray(data?.videos)?data.videos:[data];
    const publicClips:ShowcaseClip[]=candidates.flatMap((item:unknown)=>{
     if(!item||typeof item!=="object")return [];
     const entry=item as {videoUrl?:unknown;title?:unknown};
     const url=entry.videoUrl;
     if(typeof url!=="string"||!(url.startsWith("/")&&!url.startsWith("//")||url.startsWith("https://")))return [];
     return [{title:typeof entry.title==="string"?entry.title:showcase.title,url}];
    });
    setClips(publicClips);
   })
   .catch(()=>{if(active)setClips([])});
  fetch("/api/showcase?channel=desktop_portrait",{cache:"no-store"})
    .then(r=>r.ok?r.json():null)
    .then(data=>{
      if(!active)return;
      const videos=Array.isArray(data?.videos)?data.videos:[];
      setPortraitClips(videos.flatMap((item:unknown)=>{
        if(!item||typeof item!=="object")return [];
        const v=item as {title?:unknown;videoUrl?:unknown};
        return typeof v.videoUrl==="string"&&(v.videoUrl.startsWith("/")&&!v.videoUrl.startsWith("//")||v.videoUrl.startsWith("https://"))?
          [{title:typeof v.title==="string"?v.title:showcase.title,url:v.videoUrl}]:[];
      }));
    }).catch(()=>{if(active)setPortraitClips([])});
  fetch("/api/showcase?channel=desktop",{cache:"no-store"})
   .then(r=>r.ok?r.json():null)
   .then(data=>{
     if(!active)return;
     const items=Array.isArray(data?.videos)?data.videos:[];
     setDesktopClips(items.flatMap((item:unknown)=>{
       if(!item||typeof item!=="object")return [];
       const x=item as {videoUrl?:unknown;title?:unknown};
       return typeof x.videoUrl==="string"&&(x.videoUrl.startsWith("/")&&!x.videoUrl.startsWith("//")||x.videoUrl.startsWith("https://"))?
         [{title:typeof x.title==="string"?x.title:showcase.title,url:x.videoUrl}]:[];
     }));
   })
   .catch(()=>{if(active)setDesktopClips([])});
  return()=>{active=false};
 },[]);
 useEffect(()=>{
  const videos=feed.current?.querySelectorAll<HTMLVideoElement>("video");
  if(!videos)return;
  videos.forEach((video,i)=>{
   if(i===currentClip&&!document.hidden&&!failed[i]){
    video.muted=muted;
    void video.play().catch(()=>{
      if(!video.muted){
       unlockSoundAfterGesture.current=true;
       video.muted=true;
       setMuted(true);
       void video.play().catch(()=>{});
      }
    });
   }else{video.pause();}
  });
  const visibility=()=>{
   if(document.hidden)videos.forEach(v=>v.pause());
   else{const v=videos[currentClip];if(v&&!failed[currentClip]){v.muted=muted;void v.play().catch(()=>{
     if(!v.muted){unlockSoundAfterGesture.current=true;v.muted=true;setMuted(true);void v.play().catch(()=>{});}
    });}}
  };
  document.addEventListener("visibilitychange",visibility);
  return()=>document.removeEventListener("visibilitychange",visibility);
 },[clips,currentClip,muted,failed]);
 const moveTo=(index:number)=>{
  const container=feed.current;
  if(!container||index<0||index>=clips.length)return;
  container.scrollTo({top:index*container.clientHeight,behavior:"smooth"});
 };
 const onScroll=()=>{
  const container=feed.current;
  if(!container||!container.clientHeight)return;
  const next=Math.max(0,Math.min(clips.length-1,Math.round(container.scrollTop/container.clientHeight)));
  setCurrentClip(prev=>prev===next?prev:next);
 };
 const startTouch=(e:React.TouchEvent)=>{
  const t=e.touches[0];
  if(t){
   touchStart.current={x:t.clientX,y:t.clientY,atTop:(feed.current?.scrollTop??0)<3};
   if(unlockSoundAfterGesture.current){
    unlockSoundAfterGesture.current=false;
    const activeVideo=feed.current?.querySelectorAll<HTMLVideoElement>("video")[currentClip];
    if(activeVideo){
     activeVideo.muted=false;
     void activeVideo.play().then(()=>setMuted(false)).catch(()=>{
      activeVideo.muted=true;setMuted(true);
     });
    }
   }
  }
 };
 const moveTouch=(e:React.TouchEvent)=>{
  const t=e.touches[0],start=touchStart.current;
  if(!t||!start)return;
  if(Math.abs(t.clientY-start.y)>8)setDragging(true);
  if(start.atTop&&currentClip===0&&t.clientY>start.y&&Math.abs(t.clientY-start.y)>Math.abs(t.clientX-start.x)*1.4){
   const distance=t.clientY-start.y;
   setPullOffset(Math.min(86,distance*.48));
   setRefreshing(distance>125);
  }
 };
 const finishTouch=(e:React.TouchEvent)=>{
  const t=e.changedTouches[0],start=touchStart.current;
  touchStart.current=null;
  if(t&&start&&start.atTop&&currentClip===0&&t.clientY-start.y>125&&Math.abs(t.clientY-start.y)>Math.abs(t.clientX-start.x)*1.4){
   window.location.reload();return;
  }
  setRefreshing(false);
  setPullOffset(0);
  window.setTimeout(()=>setDragging(false),300);
 };
 const wheel=(event:React.WheelEvent)=>{
  if(window.matchMedia("(max-width:760px)").matches){event.stopPropagation();}
 };
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
    <div ref={feed} className={"sm-mobile-reels"+(dragging?" is-dragging":"")} onScroll={onScroll} onTouchStart={startTouch} onTouchMove={moveTouch} onTouchEnd={finishTouch} onTouchCancel={()=>{touchStart.current=null;setDragging(false);setRefreshing(false);setPullOffset(0)}} onWheel={wheel} role="region" aria-label="Swipe up or down between music videos" tabIndex={0} onKeyDown={e=>{if(e.key==="ArrowDown"||e.key==="PageDown"){e.preventDefault();moveTo(currentClip+1)}else if(e.key==="ArrowUp"||e.key==="PageUp"){e.preventDefault();moveTo(currentClip-1)}}}>
     {(clips.length?clips:[{title:"SingMotion showcase",url:""}]).map((item,i)=><section className={"sm-mobile-reel"+(i===0&&currentClip===0&&clips.length>1?" is-discovery":"")} key={item.url||i} aria-label={item.title} style={i===0&&pullOffset>0?{transform:`translate3d(0,${pullOffset}px,0)`,transition:"none"}:undefined}>
       <div className="sm-mobile-reel-backup" style={{backgroundImage:`linear-gradient(180deg,#07041333,#07041366),url("/api/showcase-media?kind=mobile-fallback")`,opacity:loaded[i]&&!failed[i]?0:1}} aria-hidden="true"/>
       {item.url&&!failed[i]&&<video className="sm-mobile-reel-video" src={item.url} playsInline muted={muted} loop preload={Math.abs(currentClip-i)<=1?"auto":"metadata"} onLoadedData={()=>setLoaded(prev=>({...prev,[i]:true}))} onError={()=>setFailed(prev=>({...prev,[i]:true}))} onClick={e=>{const video=e.currentTarget;if(video.paused)void video.play().catch(()=>{});else video.pause();}} aria-label={item.title}/>}
       {i===currentClip&&<div className="sm-mobile-reel-shade" aria-hidden="true"/>}
     </section>)}
    </div>
    <div className="sm-mobile-reel-content">
     <h1>Turn your song into a music video.</h1>
     <p>Make your music come alive with SingMotion AI.</p>
     <Link className="sm-immersive-cta" href="/studio">Create your music video <ArrowRight size={20}/></Link>
    </div>
    {clip&&!failed[currentClip]&&<button className="sm-mobile-reel-mute" type="button" aria-label={muted?"Ton einschalten":"Ton ausschalten"} onClick={()=>{unlockSoundAfterGesture.current=false;const next=!muted;setMuted(next);const v=feed.current?.querySelectorAll<HTMLVideoElement>("video")[currentClip];if(v){v.muted=next;if(v.paused)void v.play().catch(()=>{});}}}>{muted?<VolumeX size={17}/>:<Volume2 size={17}/>}</button>}
    {currentClip===0&&clips.length>1&&<div className="sm-mobile-swipe-hint" aria-hidden="true"><span>↑</span><small>Nach oben wischen</small></div>}
    <a href="#showcase" className="sm-immersive-scroll-cue" aria-label="Sanft zum Videokarussell scrollen"><span className="sm-scroll-mouse" aria-hidden="true"><span className="sm-scroll-mouse-dot"/></span><ChevronDown size={17} aria-hidden="true"/></a>
   </main>
  </div>
  <div className="sm-immersive-below">
   <DesktopShowcaseCarousel clips={desktopClips}/>
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
    <div className="sm-immersive-placeholder-gallery" aria-label="Desktop portrait video carousel">
      <div className="sm-immersive-placeholder-track" role="group" aria-label="9 by 16 portrait video collection" style={{transform:"translateX(-"+portraitSlide*6.25+"%)"}}>
        {(portraitClips.length?portraitClips:[{title:"Coming soon",url:""}]).map((item,n)=><div key={item.url||n} className={"sm-immersive-placeholder-card"+(portraitSlide===n?" is-selected":"")}>
          {item.url?<video src={item.url} playsInline muted loop preload="metadata" poster={showcase.posterUrl||"/artwork/singmotion-stage.webp"} onClick={e=>{const v=e.currentTarget;if(v.paused)void v.play().catch(()=>{});else v.pause();}} aria-label={item.title}/>:<span className="sm-immersive-placeholder-play"><Play size={28} fill="currentColor"/></span>}
          <small>{item.title}</small>
        </div>)}
      </div>
      <div className="sm-immersive-placeholder-nav">
        <button type="button" disabled={portraitSlide===0} onClick={()=>setPortraitSlide(i=>Math.max(0,i-1))} aria-label="Previous portrait">‹</button>
        <span>{Math.min(portraitSlide+1,Math.max(1,portraitClips.length))} / {Math.max(1,portraitClips.length)}</span>
        <button type="button" disabled={portraitSlide>=Math.max(0,portraitClips.length-1)} onClick={()=>setPortraitSlide(i=>Math.min(Math.max(0,portraitClips.length-1),i+1))} aria-label="Next portrait">›</button>
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
