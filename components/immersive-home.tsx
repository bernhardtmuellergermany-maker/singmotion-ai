"use client";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import {ArrowRight,Music2,ImagePlus,Sparkles,Play,Volume2,VolumeX,ChevronDown} from "lucide-react";
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
 const slides:ShowcaseClip[]=clips.length?clips.slice(0,3):[{title:"Music video coming soon",url:""}];
 const [selected,setSelected]=useState(0);
 const [motion,setMotion]=useState(0);
 const [settling,setSettling]=useState(false);
 const [target,setTarget]=useState<number|null>(null);
 const [playing,setPlaying]=useState(false);
 const [muted,setMuted]=useState(true);
 const [broken,setBroken]=useState(false);
 const video=useRef<HTMLVideoElement>(null);
 useEffect(()=>{if(video.current){video.current.muted=true;video.current.defaultMuted=true;}},[]);

 const touchX=useRef<number|null>(null);
 const count=slides.length;
 const wrap=(index:number)=>(index+count*10)%count;
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
 const slots=[-1,0,1];
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
       style={{"--slot":(slot*74)+"%"} as React.CSSProperties}
       onTransitionEnd={isCenter?endMove:undefined}
       aria-hidden={Math.abs(slot)>1?true:undefined}>
      {isCenter&&item.url&&!broken?<video ref={video} key={item.url} src={item.url} poster={cover}
        playsInline loop muted={muted} preload="metadata" className="sm-moving-video"
        onLoadedMetadata={e=>{if(muted)e.currentTarget.muted=true}}
        onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)}
        onError={()=>{setBroken(true);setPlaying(false)}} onClick={toggle} aria-label={item.title}/>:
       isSide&&item.url?<video className="sm-moving-video sm-moving-preview" src={item.url} poster={cover}
        muted playsInline loop preload="metadata" aria-hidden="true" tabIndex={-1}
        onLoadedMetadata={e=>{e.currentTarget.muted=true}}
        onLoadedData={e=>e.currentTarget.pause()}/>:
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
 </section>;
}

/** Shuffle only already-public CMS entries, avoiding immediate repeats. */
function nextMobileBatch(pool:ShowcaseClip[],last?:string,count=12):ShowcaseClip[]{
 if(!pool.length)return [];
 // Deduplicate URLs so duplicate CMS entries can never stall the shuffle.
 const unique=[...new Map(pool.map(item=>[item.url,item])).values()];
 const result:ShowcaseClip[]=[];
 let previous=last;
 while(result.length<count){
  const bag=[...unique];
  for(let i=bag.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[bag[i],bag[j]]=[bag[j],bag[i]];}
  if(bag.length>1&&bag[0].url===previous){const alternate=bag.findIndex(v=>v.url!==previous);if(alternate>0)[bag[0],bag[alternate]]=[bag[alternate],bag[0]];}
  for(const item of bag){
   if(item.url===previous&&bag.length>1)continue;
   result.push(item);previous=item.url;
   if(result.length>=count)break;
  }
 }
 return result;
}

export function ImmersiveHome(){
 const [isMobileViewport,setIsMobileViewport]=useState(false);
 useEffect(()=>{
  const media=window.matchMedia("(max-width:760px)");
  const update=()=>setIsMobileViewport(media.matches);
  update();media.addEventListener("change",update);
  return()=>media.removeEventListener("change",update);
 },[]);
 const [clips,setClips]=useState<ShowcaseClip[]>([]);
 const mobilePool=useRef<ShowcaseClip[]>([]);
 const [feedBusy,setFeedBusy]=useState(false);
 const appendPending=useRef(false);
 const [desktopClips,setDesktopClips]=useState<ShowcaseClip[]>([]);
 const [portraitClips,setPortraitClips]=useState<ShowcaseClip[]>([]);
 const [audiblePortrait,setAudiblePortrait]=useState<number|null>(null);
 const portraitGrid=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  // No desktop video may inherit audible playback from a previous render.
  portraitGrid.current?.querySelectorAll<HTMLVideoElement>("video").forEach(v=>{v.muted=true;v.defaultMuted=true;});
 },[portraitClips]);
 const [currentClip,setCurrentClip]=useState(0);
 const [muted,setMuted]=useState(true);
 const unlockSoundAfterGesture=useRef(false);
 const [failed,setFailed]=useState<Record<number,boolean>>({});
 const [loaded,setLoaded]=useState<Record<number,boolean>>({});
 const [dragging,setDragging]=useState(false);
 const [footerLinks,setFooterLinks]=useState<{label:string;url:string}[]>([]);
 const feed=useRef<HTMLDivElement>(null);
 const touchStart=useRef<{x:number;y:number;atTop:boolean}|null>(null);
 const [refreshing,setRefreshing]=useState(false);
 const [pullOffset,setPullOffset]=useState(0);
 const [introDismissed,setIntroDismissed]=useState(false);
 // A single intro on first page load, independent of video buffering state.
 useEffect(()=>{
  const timeout=window.setTimeout(()=>setIntroDismissed(true),2600);
  return()=>window.clearTimeout(timeout);
 },[]);
 useEffect(()=>{
  let active=true;
  fetch("/api/site-footer",{cache:"no-store"}).then(r=>r.ok?r.json():null)
   .then(data=>{if(active&&Array.isArray(data?.links))setFooterLinks(data.links);})
   .catch(()=>{});
  return()=>{active=false};
 },[]);
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
    // Avoid showing the same first public clip on consecutive visits when shuffle is on.
    if(data?.randomOrder===true&&publicClips.length>1){
     try{
      const previous=localStorage.getItem("sm-mobile-last-first-clip");
      if(previous===publicClips[0].url){
       const alternative=publicClips.findIndex(item=>item.url!==previous);
       if(alternative>0)[publicClips[0],publicClips[alternative]]=[publicClips[alternative],publicClips[0]];
      }
      localStorage.setItem("sm-mobile-last-first-clip",publicClips[0].url);
     }catch{}
    }
    mobilePool.current=publicClips;
    setCurrentClip(0);
    setFailed({});
    setLoaded({});
    setClips(nextMobileBatch(publicClips,undefined,12));
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
  if(!isMobileViewport){
   videos.forEach(v=>{v.muted=true;v.pause();});
   return;
  }
  videos.forEach(video=>{
   const i=Number(video.dataset.feedIndex);
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
   else if(isMobileViewport){const v=feed.current?.querySelector<HTMLVideoElement>(`video[data-feed-index="${currentClip}"]`);if(v&&!failed[currentClip]){v.muted=muted;void v.play().catch(()=>{
     if(!v.muted){unlockSoundAfterGesture.current=true;v.muted=true;setMuted(true);void v.play().catch(()=>{});}
    });}}
  };
  document.addEventListener("visibilitychange",visibility);
  return()=>document.removeEventListener("visibilitychange",visibility);
 },[clips,currentClip,muted,failed,isMobileViewport]);
 // Unlimited random browsing from CMS-approved videos only. New batches are
 // appended ahead of the viewport, without fetching or rendering whole movies.
 useEffect(()=>{
  if(!isMobileViewport||!mobilePool.current.length||appendPending.current||currentClip<clips.length-5)return;
  appendPending.current=true;
  setClips(prev=>[...prev,...nextMobileBatch(mobilePool.current,prev.at(-1)?.url,12)]);
 },[currentClip,clips.length,isMobileViewport]);
 useEffect(()=>{appendPending.current=false},[clips.length]);
 const refreshFeed=async()=>{
  if(feedBusy)return;
  setFeedBusy(true);
  try{
   const response=await fetch("/api/showcase?channel=mobile",{cache:"no-store"});
   if(!response.ok)throw Error("Feed temporarily unavailable");
   const data=await response.json();
   const entries=Array.isArray(data?.videos)?data.videos:[data];
   const pool:ShowcaseClip[]=entries.flatMap((item:unknown)=>{
    if(!item||typeof item!=="object")return [];
    const v=item as {videoUrl?:unknown;title?:unknown};
    if(typeof v.videoUrl!=="string"||!(v.videoUrl.startsWith("/")&&!v.videoUrl.startsWith("//")||v.videoUrl.startsWith("https://")))return [];
    return [{url:v.videoUrl,title:typeof v.title==="string"?v.title:showcase.title}];
   });
   if(pool.length){
    mobilePool.current=pool;
    setCurrentClip(0);setFailed({});setLoaded({});
    setClips(nextMobileBatch(pool,clips[currentClip]?.url,12));
    feed.current?.scrollTo({top:0,behavior:"auto"});
   }
  }catch{ /* Keep previously approved videos available on network errors. */ }
  finally{setPullOffset(0);setRefreshing(false);setFeedBusy(false);}
 };
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
  // Bound DOM growth for long sessions while preserving scroll position.
  if(next>50&&clips.length>80){
   const drop=24, height=container.clientHeight;
   setClips(prev=>prev.slice(drop));
   setCurrentClip(next-drop);
   window.requestAnimationFrame(()=>container.scrollTo({top:container.scrollTop-drop*height,behavior:"auto"}));
  }
 };
 const startTouch=(e:React.TouchEvent)=>{
  // Any deliberate swipe immediately unlocks the feed, even while buffering.
  if(!introDismissed)setIntroDismissed(true);
  const t=e.touches[0];
  if(t){
   touchStart.current={x:t.clientX,y:t.clientY,atTop:(feed.current?.scrollTop??0)<3};
   if(unlockSoundAfterGesture.current){
    unlockSoundAfterGesture.current=false;
    const activeVideo=feed.current?.querySelector<HTMLVideoElement>(`video[data-feed-index="${currentClip}"]`);
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
   setPullOffset(Math.min((feed.current?.clientHeight||window.innerHeight)*.5,distance*.78));
   setRefreshing(distance>125);
  }
 };
 const finishTouch=(e:React.TouchEvent)=>{
  const t=e.changedTouches[0],start=touchStart.current;
  touchStart.current=null;
  if(t&&start&&start.atTop&&currentClip===0&&t.clientY-start.y>125&&Math.abs(t.clientY-start.y)>Math.abs(t.clientX-start.x)*1.4){
   setPullOffset(Math.min((feed.current?.clientHeight||window.innerHeight)*.22,110));void refreshFeed();return;
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
    <div className="sm-mobile-refresh-underlay" aria-hidden="true"/>
    <div className={"sm-mobile-intro-fallback"+(introDismissed?" is-hidden":"")} aria-hidden="true"/>
    <div ref={feed} className={"sm-mobile-reels"+(introDismissed?" intro-complete":" intro-pending")+(dragging?" is-dragging":"")+(feedBusy?" is-refreshing":"")} onScroll={onScroll} onTouchStart={startTouch} onTouchMove={moveTouch} onTouchEnd={finishTouch} onTouchCancel={()=>{touchStart.current=null;setDragging(false);setRefreshing(false);setPullOffset(0)}} onWheel={wheel} role="region" aria-label="Swipe up or down between music videos" tabIndex={0} onKeyDown={e=>{if(e.key==="ArrowDown"||e.key==="PageDown"){e.preventDefault();moveTo(currentClip+1)}else if(e.key==="ArrowUp"||e.key==="PageUp"){e.preventDefault();moveTo(currentClip-1)}}}>
     {(clips.length?clips:[{title:"SingMotion showcase",url:""}]).map((item,i)=><section className="sm-mobile-reel" key={item.url+"-"+i} aria-label={item.title} style={i===0&&pullOffset>0?{transform:`translate3d(0,${pullOffset}px,0)`}:undefined}>
       <div className="sm-mobile-reel-loading" aria-hidden="true"/>
       {isMobileViewport&&item.url&&!failed[i]&&Math.abs(currentClip-i)<=1&&<video className="sm-mobile-reel-video" data-feed-index={i} src={item.url} playsInline autoPlay muted={muted} loop preload={i===currentClip||i===currentClip+1?"auto":"metadata"} onLoadedData={()=>setLoaded(prev=>({...prev,[i]:true}))} onCanPlay={()=>setLoaded(prev=>prev[i]?prev:{...prev,[i]:true})} onError={()=>setFailed(prev=>({...prev,[i]:true}))} onClick={e=>{const video=e.currentTarget;if(video.paused)void video.play().catch(()=>{});else video.pause();}} aria-label={item.title}/>}
       {i===currentClip&&<div className="sm-mobile-reel-shade" aria-hidden="true"/>}
     </section>)}
    </div>
    <div className="sm-mobile-reel-content">
     <h1>Turn your song into a music video.</h1>
     <p>Make your music come alive with SingMotion AI.</p>
     <Link className="sm-immersive-cta" href="/studio">Create your music video <ArrowRight size={20}/></Link>
    </div>
    {clip&&!failed[currentClip]&&<button className="sm-mobile-reel-mute" type="button" aria-label={muted?"Ton einschalten":"Ton ausschalten"} onClick={()=>{unlockSoundAfterGesture.current=false;const next=!muted;setMuted(next);const v=feed.current?.querySelector<HTMLVideoElement>(`video[data-feed-index="${currentClip}"]`);if(v){v.muted=next;if(v.paused)void v.play().catch(()=>{});}}}>{muted?<VolumeX size={17}/>:<Volume2 size={17}/>}</button>}
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
     <li><ImagePlus aria-hidden="true"/><strong>2. Upload a photo</strong><span>Add a photo of yourself or your artist.</span></li>
     <li><Sparkles aria-hidden="true"/><strong>3. Describe the performance</strong><span>Write your style, mood, scene and performance prompt.</span></li>
     <li><Play aria-hidden="true"/><strong>4. Generate the video</strong><span>Create your AI music video.</span></li>
    </ol>
   </section>
   <div className="sm-immersive-featured-backdrop">
   <section className="sm-immersive-creations" aria-labelledby="sm-creation-title">
    <h2 id="sm-creation-title">Stunning <span>Creations</span></h2>
    <p>Real examples. Real emotion.</p>
    <div ref={portraitGrid} className="sm-desktop-portrait-grid" aria-label="Four featured portrait videos">
      {Array.from({length:4},(_,i)=>portraitClips[i]??{title:"Coming soon",url:""}).map((item,i)=><div key={item.url||i} className="sm-desktop-portrait-card">
       {item.url?<><video src={item.url} playsInline autoPlay muted={audiblePortrait!==i} loop preload="metadata" poster={showcase.posterUrl||"/artwork/singmotion-stage.webp"} onLoadedMetadata={e=>{if(audiblePortrait!==i)e.currentTarget.muted=true;}} aria-label={item.title}/>
        <button type="button" className="sm-desktop-portrait-sound" aria-label={audiblePortrait===i?"Ton ausschalten: "+item.title:"Ton einschalten: "+item.title} aria-pressed={audiblePortrait===i}
         onClick={()=>{
           const nextIndex=audiblePortrait===i?null:i;
           const videos=portraitGrid.current?.querySelectorAll<HTMLVideoElement>("video");
           videos?.forEach((v,j)=>{v.muted=nextIndex!==j;});
           setAudiblePortrait(nextIndex);
           if(nextIndex!==null){const v=videos?.[i];if(v?.paused)void v.play().catch(()=>{setAudiblePortrait(null);if(v)v.muted=true;});}
         }}>{audiblePortrait===i?<Volume2 size={24}/>:<VolumeX size={24}/>}</button>
       </>:<div className="sm-desktop-portrait-fallback" aria-label="Video coming soon"><Play size={28}/></div>}
      </div>)}
    </div>
   </section>
   <section className="sm-immersive-final" aria-labelledby="sm-ready-title">
    <h2 id="sm-ready-title">Ready to create your<br/>next <span>music video?</span></h2>
    <Link className="sm-immersive-cta" href="/studio">Create your music video <ArrowRight size={20}/></Link>
   </section>
   </div>
   <footer className="sm-immersive-footer">
    <Link className="sm-immersive-footer-logo" href="/">SingMotion <span>AI</span></Link>
    <nav aria-label="Service and legal">
     {footerLinks.map((item,i)=><Link href={item.url} key={item.url+"-"+i}>{item.label}</Link>)}
    </nav>
   </footer>
  </div>
 </div>;
}
