"use client";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import {ArrowRight,Music2,ImagePlus,Sparkles,Play,Volume2,VolumeX,ChevronDown,RotateCw} from "lucide-react";
import {SiteHeader} from "./site-header";
import {showcase} from "@/lib/showcase";

/** Home-only visual presentation of the existing public, owner-approved showcase.
 * No private project discovery, new endpoints, checkout or login mechanisms.
 * The public API serves only per-channel, explicitly approved videos. */
type ShowcaseClip = {title:string;url:string;posterUrl?:string|null};

/** A five-card filmstrip translates as one carousel, then recycles offscreen cards.
 * Only owner-approved video URLs are playable; upcoming slots stay labeled.
 */
function DesktopShowcaseCarousel({clips}:{clips:ShowcaseClip[]}){
 const slides:ShowcaseClip[]=clips.length?clips.slice(0,3):[{title:"Music video coming soon",url:""}];
 const [selected,setSelected]=useState(0);
 const [motion,setMotion]=useState(0);
 const [settling,setSettling]=useState(false);
 const [target,setTarget]=useState<number|null>(null);
 const [broken,setBroken]=useState(false);
 const video=useRef<HTMLVideoElement>(null);
 // Autoplay must start muted: browsers block unsolicited playback with sound.
 // Start on selection and resume on tab return; never require a poster click.
 useEffect(()=>{
  const element=video.current;
  if(!element||!slides[selected]?.url||broken)return;
  element.defaultMuted=true;
  element.muted=true;
  const start=()=>{
   if(document.hidden)return;
   void element.play().catch(()=>{
    // Retry muted for browsers restoring an audible preference.
    element.muted=true;
    void element.play().catch(()=>{});
   });
  };
  start();
  const onVisibility=()=>{if(document.hidden)element.pause();else start();};
  document.addEventListener("visibilitychange",onVisibility);
  return()=>document.removeEventListener("visibilitychange",onVisibility);
 },[selected,slides[selected]?.url,broken]);

 const touchX=useRef<number|null>(null);
 const count=slides.length;
 const wrap=(index:number)=>(index+count*10)%count;
 const cover=showcase.posterUrl||"/artwork/singmotion-stage.webp";
 const move=(direction:number,destination?:number)=>{
  if(motion!==0||settling)return;
  video.current?.pause();
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
 const slots=[-1,0,1];
 return <section className="sm-desktop-showcase" id="showcase" aria-label="Music video carousel">
  <div className="sm-moving-carousel" tabIndex={0} aria-label="Use left and right arrows to move through music videos"
   onKeyDown={e=>{if(e.key==="ArrowLeft"){e.preventDefault();move(-1)}else if(e.key==="ArrowRight"){e.preventDefault();move(1)}}}
   onTouchStart={e=>{touchX.current=e.touches[0]?.clientX??null}}
   onTouchEnd={e=>{const x=e.changedTouches[0]?.clientX;if(x!==undefined&&touchX.current!==null&&Math.abs(x-touchX.current)>50)move(x<touchX.current?1:-1);touchX.current=null}}>
   {slots.map(offset=>{
    const item=slides[wrap(selected+offset)];
    const itemCover=item.posterUrl||cover;
    const isCenter=offset===0;
    const isSide=Math.abs(offset)===1;
    const slot=offset+motion;
    return <div key={offset} className={"sm-moving-card"+(isCenter?" is-center":"")+(isSide?" is-side":"")+(motion!==0&&isCenter?" is-leaving":"")+(motion!==0&&slot===0?" is-entering":"")+(settling?" no-transition":"")}
       style={{"--slot":(slot*74)+"%"} as React.CSSProperties}
       onTransitionEnd={isCenter?endMove:undefined}
       aria-hidden={Math.abs(slot)>1?true:undefined}>
      {isCenter&&item.url&&!broken?<video ref={video} key={item.url} src={item.url} poster={itemCover}
        playsInline autoPlay loop muted preload="auto" className="sm-moving-video"
        onLoadedMetadata={e=>{e.currentTarget.muted=true;void e.currentTarget.play().catch(()=>{});}}
        onError={()=>setBroken(true)} aria-label={item.title}/>:
       isSide&&item.url?<video className="sm-moving-video sm-moving-preview" src={item.url} poster={itemCover}
        muted playsInline loop preload="auto" aria-hidden="true" tabIndex={-1}
        onLoadedMetadata={e=>{e.currentTarget.muted=true}}
        onLoadedData={e=>e.currentTarget.pause()}/>:
       <div className="sm-moving-poster" style={{backgroundImage:"linear-gradient(0deg,#080513a6,#12091b3b),url('"+itemCover+"')"}}/>}
      {isSide&&<button className="sm-moving-side-tap" type="button" aria-label={offset<0?"Previous video":"Next video"} onClick={()=>move(offset<0?-1:1)}/>}

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
 const [portraitReady,setPortraitReady]=useState<Record<number,boolean>>({});
 const [visiblePortraits,setVisiblePortraits]=useState<Record<number,boolean>>({});
 const [audiblePortrait,setAudiblePortrait]=useState<number|null>(null);
 const togglePortraitSound=(index:number)=>{
  const next=audiblePortrait===index?null:index;
  const players=portraitGrid.current?.querySelectorAll<HTMLVideoElement>("video");
  players?.forEach((player,i)=>{player.muted=next!==i;});
  setAudiblePortrait(next);
  if(next!==null){
   const player=players?.[index];
   if(player?.paused)void player.play().catch(()=>{
    if(player)player.muted=true;
    setAudiblePortrait(current=>current===index?null:current);
   });
  }
 };
 const portraitGrid=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  // No desktop video may inherit audible playback from a previous render.
  portraitGrid.current?.querySelectorAll<HTMLVideoElement>("video").forEach(v=>{v.muted=true;v.defaultMuted=true;});
 },[portraitClips]);
 useEffect(()=>{
  const root=portraitGrid.current;
  if(!root)return;
  const elements=[...root.querySelectorAll<HTMLElement>(".sm-desktop-portrait-card")];
  if(!("IntersectionObserver" in window)){
   setVisiblePortraits(Object.fromEntries(elements.map((_,i)=>[i,true])));
   return;
  }
  const observer=new IntersectionObserver(entries=>{
   for(const entry of entries){
    if(entry.isIntersecting){
     const i=Number((entry.target as HTMLElement).dataset.index);
     setVisiblePortraits(previous=>previous[i]?previous:{...previous,[i]:true});
     observer.unobserve(entry.target);
    }
   }
  },{rootMargin:"250px 0px",threshold:0.01});
  elements.forEach(element=>observer.observe(element));
  return()=>observer.disconnect();
 },[portraitClips]);
 const [currentClip,setCurrentClip]=useState(0);
 const [muted,setMuted]=useState(true);
 const unlockSoundAfterGesture=useRef(false);
 const [failed,setFailed]=useState<Record<number,boolean>>({});
 const [loaded,setLoaded]=useState<Record<number,boolean>>({});
 const [footerLinks,setFooterLinks]=useState<{label:string;url:string}[]>([]);
 const feed=useRef<HTMLDivElement>(null);
 const firstScreen=useRef<HTMLDivElement>(null);
 const touchStart=useRef<{x:number;y:number;atTop:boolean}|null>(null);
 const [refreshing,setRefreshing]=useState(false);
 const refreshCircle=useRef<HTMLDivElement>(null);
 const pullDistance=useRef(0);
 const refreshGesture=useRef(false);
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
     const entry=item as {videoUrl?:unknown;title?:unknown;posterUrl?:unknown};
     const url=entry.videoUrl;
     if(typeof url!=="string"||!(url.startsWith("/")&&!url.startsWith("//")||url.startsWith("https://")))return [];
     return [{title:typeof entry.title==="string"?entry.title:showcase.title,url,posterUrl:typeof entry.posterUrl==="string"?entry.posterUrl:null}];
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
        const v=item as {title?:unknown;videoUrl?:unknown;posterUrl?:unknown};
        return typeof v.videoUrl==="string"&&(v.videoUrl.startsWith("/")&&!v.videoUrl.startsWith("//")||v.videoUrl.startsWith("https://"))?
          [{title:typeof v.title==="string"?v.title:showcase.title,url:v.videoUrl,posterUrl:typeof v.posterUrl==="string"?v.posterUrl:null}]:[];
      }));
    }).catch(()=>{if(active)setPortraitClips([])});
  fetch("/api/showcase?channel=desktop",{cache:"no-store"})
   .then(r=>r.ok?r.json():null)
   .then(data=>{
     if(!active)return;
     const items=Array.isArray(data?.videos)?data.videos:[];
     setDesktopClips(items.flatMap((item:unknown)=>{
       if(!item||typeof item!=="object")return [];
       const x=item as {videoUrl?:unknown;title?:unknown;posterUrl?:unknown};
       return typeof x.videoUrl==="string"&&(x.videoUrl.startsWith("/")&&!x.videoUrl.startsWith("//")||x.videoUrl.startsWith("https://"))?
         [{title:typeof x.title==="string"?x.title:showcase.title,url:x.videoUrl,posterUrl:typeof x.posterUrl==="string"?x.posterUrl:null}]:[];
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
 const resetRefreshCircle=()=>{
  pullDistance.current=0;
  refreshGesture.current=false;
  const circle=refreshCircle.current;
  if(circle){
   circle.classList.remove("is-pulling");
   circle.style.setProperty("--refresh-y","-68px");
   circle.style.setProperty("--refresh-rotation","0deg");
  }
 };
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
    const v=item as {videoUrl?:unknown;title?:unknown;posterUrl?:unknown};
    if(typeof v.videoUrl!=="string"||!(v.videoUrl.startsWith("/")&&!v.videoUrl.startsWith("//")||v.videoUrl.startsWith("https://")))return [];
    return [{url:v.videoUrl,title:typeof v.title==="string"?v.title:showcase.title,posterUrl:typeof v.posterUrl==="string"?v.posterUrl:null}];
   });
   if(pool.length){
    mobilePool.current=pool;
    setCurrentClip(0);setFailed({});setLoaded({});
    setClips(nextMobileBatch(pool,clips[currentClip]?.url,12));
    feed.current?.scrollTo({top:0,behavior:"auto"});
   }
  }catch{ /* Keep previously approved videos available on network errors. */ }
  finally{resetRefreshCircle();setRefreshing(false);setFeedBusy(false);}
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
  const t=e.touches[0];
  if(t){
   // Every touch begins a fresh, independent pull attempt.
   pullDistance.current=0;
   refreshGesture.current=false;
   const atTop=(feed.current?.scrollTop??0)<=48;
   touchStart.current={x:t.clientX,y:t.clientY,atTop};
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
 // A short, easy pull (independent of swipe speed or screen height).
 const refreshThreshold=()=>105;
 // Native, explicitly non-passive handler is essential: preventDefault stops
 // mobile Safari/Chrome from moving the native snap-scroller during refresh.
 // Update CSS properties directly rather than re-rendering every video per frame.
 useEffect(()=>{
  // Header and video are siblings; listen on their shared screen so a pull
  // that starts on the top navigation is detected just like a pull on video.
  const element=firstScreen.current;
  if(!element||!isMobileViewport)return;
  const onMove=(event:TouchEvent)=>{
   const touch=event.touches[0],start=touchStart.current;
   if(!touch||!start||feedBusy)return;
   const dy=touch.clientY-start.y,dx=touch.clientX-start.x;
   if(!refreshGesture.current){
    if(!start.atTop||dy<=2||dy<=Math.abs(dx)*.9)return;
    refreshGesture.current=true;
   }
   if(event.cancelable)event.preventDefault();
   const distance=Math.max(0,dy);
   pullDistance.current=distance;
   const threshold=refreshThreshold();
   const progress=Math.min(1,distance/threshold);
   const circle=refreshCircle.current;
   if(circle){
    circle.classList.add("is-pulling");
    circle.style.setProperty("--refresh-y",Math.round(-68+progress*168)+"px");
    circle.style.setProperty("--refresh-rotation",Math.round(progress*340)+"deg");
   }
   const ready=distance>=threshold;
   setRefreshing(previous=>previous===ready?previous:ready);
  };
  element.addEventListener("touchmove",onMove,{passive:false});
  return()=>element.removeEventListener("touchmove",onMove);
 },[isMobileViewport,feedBusy]);
 const finishTouch=(event:React.TouchEvent)=>{
  const start=touchStart.current;
  const end=event.changedTouches[0];
  touchStart.current=null;
  // Only the FINAL finger position at release counts. Pulling fully and
  // pushing back up before release must never trigger a refresh.
  const finalDistance=start&&end?Math.max(0,end.clientY-start.y):0;
  const finalVertical=!!start&&!!end&&finalDistance>Math.abs(end.clientX-start.x)*.9;
  // A quick flick may produce few touchmove events; release position still
  // determines completion. Reversing before release cancels as expected.
  const valid=!!start&&start.atTop&&finalVertical&&
   finalDistance>=refreshThreshold()&&!feedBusy;
  if(valid){
   refreshGesture.current=false;
   refreshCircle.current?.classList.remove("is-pulling");
   feed.current?.scrollTo({top:0,behavior:"auto"});
   setRefreshing(true);
   void refreshFeed();
   return;
  }
  resetRefreshCircle();
  setRefreshing(false);
 };
 const scrollToShowcase=(event:React.MouseEvent<HTMLAnchorElement>)=>{
  event.preventDefault();
  const section=document.getElementById("showcase");
  if(!section)return;
  const root=document.scrollingElement||document.documentElement;
  const destination=()=>Math.max(0,section.getBoundingClientRect().top+root.scrollTop);
  if(window.matchMedia("(prefers-reduced-motion: reduce)").matches){
   window.scrollTo({top:destination(),behavior:"instant"});
   return;
  }
  const from=root.scrollTop;
  const started=performance.now();
  const duration=1150;
  const tick=(now:number)=>{
   const t=Math.min(1,(now-started)/duration);
   const eased=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
   window.scrollTo({top:from+(destination()-from)*eased,behavior:"instant"});
   if(t<1)window.requestAnimationFrame(tick);
   else window.scrollTo({top:destination(),behavior:"instant"});
  };
  window.requestAnimationFrame(tick);
 };
 const wheel=(event:React.WheelEvent)=>{
  if(window.matchMedia("(max-width:760px)").matches){event.stopPropagation();}
 };
 return <div className="sm-immersive-home">
  <div ref={firstScreen} className="sm-immersive-first-screen" onTouchStart={startTouch} onTouchEnd={finishTouch} onTouchCancel={()=>{touchStart.current=null;resetRefreshCircle();setRefreshing(false)}}>
   <SiteHeader className="sm-immersive-header"/>
   <main id="content" className="sm-immersive-hero">
    <div className="sm-immersive-atmosphere" aria-hidden="true"/>
    <div className="sm-immersive-desktop-intro">
     <h1>Turn your song into a <span>music video.</span></h1>
     <p>With SingMotion AI — your song, your performance.</p>
     <Link className="sm-immersive-cta" href="/studio?new=1">Create your music video <ArrowRight size={20}/></Link>
    </div>
    <div ref={feed} className={"sm-mobile-reels"+(feedBusy?" is-refreshing":"")} onScroll={onScroll} onWheel={wheel} role="region" aria-label="Swipe up or down between music videos" tabIndex={0} onKeyDown={e=>{if(e.key==="ArrowDown"||e.key==="PageDown"){e.preventDefault();moveTo(currentClip+1)}else if(e.key==="ArrowUp"||e.key==="PageUp"){e.preventDefault();moveTo(currentClip-1)}}}>
     {(clips.length?clips:[{title:"SingMotion showcase",url:""}]).map((item,i)=><section className="sm-mobile-reel" key={item.url+"-"+i} aria-label={item.title}>
       <div className="sm-mobile-reel-loading" aria-hidden="true"/>
       {isMobileViewport&&item.url&&!failed[i]&&Math.abs(currentClip-i)<=1&&<video className="sm-mobile-reel-video" data-feed-index={i} src={item.url} playsInline autoPlay muted={muted} loop preload={i===currentClip||i===currentClip+1?"auto":"metadata"} onLoadedData={()=>setLoaded(prev=>({...prev,[i]:true}))} onCanPlay={()=>setLoaded(prev=>prev[i]?prev:{...prev,[i]:true})} onError={()=>setFailed(prev=>({...prev,[i]:true}))} onClick={e=>{const video=e.currentTarget;if(video.paused)void video.play().catch(()=>{});else video.pause();}} aria-label={item.title}/>}
       {i===currentClip&&<div className="sm-mobile-reel-shade" aria-hidden="true"/>}
     </section>)}
    </div>
    <div ref={refreshCircle} className={"sm-mobile-refresh-indicator"+(feedBusy?" is-loading":"")} style={{"--refresh-y":"-68px","--refresh-rotation":"0deg"} as React.CSSProperties} role="status" aria-hidden={!refreshing&&!feedBusy} aria-label={feedBusy?"Videos werden aktualisiert":refreshing?"Loslassen zum Aktualisieren":"Zum Aktualisieren weiterziehen"}>
      <RotateCw size={29} strokeWidth={3}/>
    </div>
    <div className="sm-mobile-reel-content">
     <h1>Turn your song into a music video.</h1>
     <p>Make your music come alive with SingMotion AI.</p>
     <Link className="sm-immersive-cta" href="/studio?new=1">Create your music video <ArrowRight size={20}/></Link>
    </div>
    {clip&&!failed[currentClip]&&<button className="sm-mobile-reel-mute" type="button" aria-label={muted?"Ton einschalten":"Ton ausschalten"} onClick={()=>{unlockSoundAfterGesture.current=false;const next=!muted;setMuted(next);const v=feed.current?.querySelector<HTMLVideoElement>(`video[data-feed-index="${currentClip}"]`);if(v){v.muted=next;if(v.paused)void v.play().catch(()=>{});}}}>{muted?<VolumeX size={17}/>:<Volume2 size={17}/>}</button>}
    {currentClip===0&&clips.length>1&&<div className="sm-mobile-swipe-hint" aria-hidden="true"><span>↑</span><small>Nach oben wischen</small></div>}
    <a href="#showcase" onClick={scrollToShowcase} className="sm-immersive-scroll-cue" aria-label="Sanft zum 16:9-Videokarussell scrollen"><span className="sm-scroll-mouse" aria-hidden="true"><span className="sm-scroll-mouse-dot"/></span><ChevronDown size={17} aria-hidden="true"/></a>
   </main>
  </div>
  <div className="sm-immersive-below">
   <DesktopShowcaseCarousel clips={desktopClips}/>
   <section id="how-it-works" className="sm-immersive-steps" aria-labelledby="sm-how-title">
    <h2 id="sm-how-title">How it <span>works</span></h2>
    <p>In just a few steps to your own music video. Upload your song and photo, choose a performance style, and create with SingMotion AI.</p>
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
    <p>Real examples. Real emotion. Discover AI music videos that turn original songs into unforgettable performances.</p>
    <div ref={portraitGrid} className="sm-desktop-portrait-grid" aria-label="Four featured portrait videos">
      {Array.from({length:4},(_,i)=>portraitClips[i]??{title:"Coming soon",url:""}).map((item,i)=><div key={item.url||i} className="sm-desktop-portrait-card" data-index={i}
       onClick={()=>item.url&&togglePortraitSound(i)}
       aria-label={item.url?"Video "+item.title+": Klick zum Ton ein- oder ausschalten":item.title}>
       {item.url?<><img className="sm-desktop-portrait-poster" src={item.posterUrl||showcase.posterUrl||"/artwork/singmotion-stage.webp"} alt="" loading="lazy"/>
        <video className={"sm-desktop-portrait-video"+(portraitReady[i]?" is-ready":"")} src={visiblePortraits[i]?item.url:undefined} playsInline autoPlay muted={audiblePortrait!==i} loop preload="metadata" poster={item.posterUrl||showcase.posterUrl||"/artwork/singmotion-stage.webp"} onLoadedData={()=>setPortraitReady(previous=>previous[i]?previous:{...previous,[i]:true})} onCanPlay={()=>setPortraitReady(previous=>previous[i]?previous:{...previous,[i]:true})} onLoadedMetadata={e=>{if(audiblePortrait!==i)e.currentTarget.muted=true;}} aria-label={item.title}/>
        <button type="button" className="sm-desktop-portrait-sound" aria-label={audiblePortrait===i?"Ton ausschalten: "+item.title:"Ton einschalten: "+item.title} aria-pressed={audiblePortrait===i}
          onClick={event=>{event.stopPropagation();togglePortraitSound(i)}}>{audiblePortrait===i?<Volume2 size={17}/>:<VolumeX size={17}/>}</button>
       </>:<div className="sm-desktop-portrait-fallback" aria-label="Video coming soon"><Play size={28}/></div>}
      </div>)}
    </div>
   </section>
   <section className="sm-immersive-final" aria-labelledby="sm-ready-title">
    <h2 id="sm-ready-title">Ready to create your<br/>next <span>music video?</span></h2>
    <Link className="sm-immersive-cta" href="/studio?new=1">Create your music video <ArrowRight size={20}/></Link>
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
