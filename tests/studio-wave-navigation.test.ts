
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {boundWaveViewport,panWaveViewport,pinchWaveViewport,dragWaveHandleTime} from "../lib/studio-wave-navigation.ts";
import {anchoredWaveBars} from "../lib/studio-wave-bars.ts";
import {MAX_VIDEO_SELECTION_SECONDS,validateSelection,AppError} from "../lib/domain.ts";
import {quoteVideoCredits} from "../lib/commerce/video-credit-quote.ts";
const read=(p:string)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");

test("one-finger drag pans only the audio viewport and respects bounds",()=>{
 const origin={start:50,span:20};
 assert.deepEqual(panWaveViewport(origin,100,200,180),{start:40,span:20});
 assert.deepEqual(panWaveViewport(origin,-100,200,180),{start:60,span:20});
 assert.deepEqual(panWaveViewport(origin,99999,200,180),{start:0,span:20});
 assert.deepEqual(panWaveViewport(origin,-99999,200,180),{start:160,span:20});
 assert.deepEqual(panWaveViewport(origin,20,0,180),origin);
 assert.deepEqual(origin,{start:50,span:20});
});
test("two-finger pinch preserves its focal point and prevents excessive zoom",()=>{
 const source={start:40,span:40};
 const zoom=pinchWaveViewport(source,100,200,50,0.25,6,180);
 assert.deepEqual(zoom,{start:45,span:20});
 assert.equal(zoom.start+zoom.span*0.25,50);
 assert.deepEqual(pinchWaveViewport(source,100,50,50,0.25,6,180),{start:30,span:80});
 assert.deepEqual(pinchWaveViewport(source,100,9999,50,0.25,6,180),{start:48.5,span:6});
 assert.deepEqual(pinchWaveViewport(source,100,1,50,0.25,6,180),{start:0,span:180});
 assert.deepEqual(boundWaveViewport(-10,45,180),{start:0,span:45});
 assert.deepEqual(source,{start:40,span:40});
});
test("audio navigation is separate from existing selection drag/keyboard controls",()=>{
 const wave=read("components/waveform.tsx");
 const css=read("app/(site)/studio-refinement.css");
 for(const part of ["onTouchStart={startPinch}","onTouchMove={continuePinch}",
   "pinchBlocked.current","onPointerDown={startPan}","onPointerMove={continuePan}",
   "aria-label=\"Move selected audio segment\"","wave-grip-mark"]){
  assert.ok(wave.includes(part),"Missing "+part);
 }
 assert.ok(css.includes("width:48px!important"));
 assert.ok(css.includes("touch-action:none"));
});

test("large touch grips never jump on initial contact and keep precise finger offset",()=>{
 assert.equal(dragWaveHandleTime(30,0,240,120,180),30);
 assert.equal(dragWaveHandleTime(30,24,240,120,180),42);
 assert.equal(dragWaveHandleTime(30,-24,240,120,180),18);
 assert.equal(dragWaveHandleTime(30,-500,240,120,180),0);
 assert.equal(dragWaveHandleTime(150,500,240,120,180),180);
 const source=read("components/waveform.tsx");
 assert.ok(source.includes("handleGrab.current={pointerId:e.pointerId,x:e.clientX"));
 assert.ok(source.includes("dragWaveHandleTime(grab.time,e.clientX-grab.x"));
});

test("desktop can drag the selected audio without dragging the viewport; grips are outside the cut",()=>{
 const wave=read("components/waveform.tsx"),css=read("app/(site)/studio-refinement.css");
 assert.match(wave,/if\(e\.pointerType==="mouse"&&e\.button!==0\)return/);
 assert.match(wave,/target\.closest\("\.wave-handle,\.wave-selection"\)/);
 assert.doesNotMatch(wave,/panMode/);
 assert.match(wave,/if\(target\.closest\("\.wave-handle,\.wave-selection"\)\)return/);
 assert.match(wave,/setLockedView\(\{start:viewStart,span:viewSpan,freePan:false\}\)/);
 assert.match(wave,/setLockedView\(previous=>previous\?\{\.\.\.previous,freePan:false\}:null\)/);
 assert.match(wave,/handle==="start"\?<ChevronLeft/);
 assert.match(wave,/:<ChevronRight/);
 assert.match(css,/\.wave-handle-start\{\s*transform:translate\(-100%,-50%\)!important/);
 assert.match(css,/\.wave-handle-end\{\s*transform:translate\(0,-50%\)!important/);
 assert.match(css,/\.wave-selection-hit\{pointer-events:none!important/);
});

test("mouse and touch pan unselected audio without an extra Hand control",()=>{
 const wave=read("components/waveform.tsx"),css=read("app/(site)/studio-refinement.css");
 assert.doesNotMatch(wave,/e.pointerType==="mouse"&&!panMode/);
 assert.doesNotMatch(wave,/panMode|setPanMode|<Hand\b|studio-wave-gesture-hint/);
 assert.match(wave,/aria-label="Audio track: drag unselected audio to pan, pinch with two fingers to zoom"/);
 assert.match(css,/\.wave-grip-mark\{\s*flex:0 0 12px!important;\s*width:12px!important/);
 assert.match(css,/flex:0 0 13px!important;\s*width:13px!important/);
 assert.match(css,/\.wave-time\{[\s\S]*?width:calc\(100% - 48px\)!important;\s*margin-left:24px!important/);
 assert.match(css,/\.wave-bars i\{\s*flex:1 1 0!important;[\s\S]*?min-width:0!important/);
 assert.match(css,/\.wave-handle::after\{\s*content:none!important;\s*display:none!important/);
 assert.match(css,/\.wave-strip\{\s*clip-path:none!important/);
});

test("wider waveform stays centered without the old intrinsic minimum-width overflow",()=>{
 const css=read("app/(site)/studio-refinement.css");
 assert.match(css,/\.studio-modern-wave \.wave-viewport\{[\s\S]*?box-sizing:border-box!important;[\s\S]*?padding-inline:0!important/);
 assert.match(css,/\.studio-modern-wave \.wave-strip\{[\s\S]*?width:calc\(100% - 48px\)!important;[\s\S]*?min-width:0!important;[\s\S]*?margin-inline:24px!important/);
 assert.match(css,/\.studio-modern-wave \.wave-time\{\s*min-width:0!important;\s*max-width:calc\(100% - 48px\)!important/);
 assert.match(css,/\.wave-handle:focus-visible\{\s*outline:none!important/);
 assert.match(css,/\.wave-handle:focus-visible \.wave-grip-mark\{\s*outline:2px solid #d88aff!important/);
});

test("phone waveform paints at most once per frame and uses lightweight Neon Wave bars",()=>{
 const wave=read("components/waveform.tsx");
 const css=read("app/(site)/studio-refinement.css");
 assert.match(wave,/requestAnimationFrame\(\(\)=>\{/);
 assert.match(wave,/function scheduleViewport\(/);
 assert.match(wave,/function flushViewport\(/);
 const sampler=read("lib/studio-wave-bars.ts");
 assert.match(sampler,/const columns = Math\.max\(44, Math\.min\(170/);
 assert.match(sampler,/for \(let k=from; k<to; k\+\+\)/);
 assert.doesNotMatch(sampler,/Math\.max\(\.\.\.peaks\.slice\(/);
 assert.match(css,/Fast mobile navigation: one gentle halo/);
 assert.match(css,/box-shadow:0 0 3px rgba\(247,69,226,\.44\)!important/);
});

test("panning keeps absolute-time bars the same height and color while only shifting X",()=>{
 const peaks=Array.from({length:2048},(_,i)=>0.12+Math.pow(Math.sin(i*0.131),2)*0.78);
 const duration=180,span=18,width=340,delta=.13;
 const base=anchoredWaveBars(peaks,duration,42,span,width,45,53);
 const moved=anchoredWaveBars(peaks,duration,42+delta,span,width,45,53);
 const stepPx=width/Math.max(44,Math.min(170,Math.round(width/5.6)));
 const locate=(frame:ReturnType<typeof anchoredWaveBars>,idx:number)=>{
   const n=frame.bars.findIndex(bar=>bar.index===idx);
   assert.notEqual(n,-1);
   return (n+.5)*stepPx+frame.translateX;
 };
 for(const bar of base.bars){
   const after=moved.bars.find(v=>v.index===bar.index);
   if(!after)continue;
   assert.equal(after.height,bar.height,"panning must not change an existing bar's height");
   assert.equal(after.selected,bar.selected,"selection color is anchored to audio time");
   assert.ok(Math.abs(locate(moved,bar.index)-locate(base,bar.index)+delta/span*width)<1e-7);
 }
 // Even when the pan crosses a complete bar column, surviving columns do not
 // change amplitude or jump position due to re-indexing.
 const across=anchoredWaveBars(peaks,duration,42+span/60*1.25,span,width,45,53);
 for(const bar of base.bars.slice(4,-4)){
   const later=across.bars.find(v=>v.index===bar.index);
   assert.ok(later);
   assert.equal(later.height,bar.height);
 }
});

test("anchored waveform clips overscan past the beginning and end, and supports empty audio",()=>{
 const noAudio=anchoredWaveBars([],180,0,30,360,10,20);
 assert.equal(noAudio.bars[0].height,0);
 assert.ok(noAudio.bars.find(b=>b.index===0)?.height);
 const ending=anchoredWaveBars([0.25,0.8,0.35,0.1],180,175,5,360,176,179);
 assert.equal(ending.bars.at(-1)?.height,0);
});

test("waveform keeps the trim gestures above a clipped, GPU-shifted bar row",()=>{
 const wave=read("components/waveform.tsx");
 const css=read("app/(site)/studio-refinement.css");
 assert.match(wave,/anchoredWaveBars\(peaks,duration,viewStart,viewSpan,stripWidth,start,end\)/);
 assert.match(wave,/key=\{bar.index\}/);
 assert.match(wave,/className="wave-bars-window"/);
 assert.match(wave,/--sm-wave-translate-x/);
 assert.match(css,/\.wave-bars\.wave-bars-anchored\{/);
 assert.match(css,/transform:translate3d\(var\(--sm-wave-translate-x\),0,0\)/);
 assert.match(css,/\.wave-bars-window\{[\s\S]*?overflow:hidden/);
});

// Shared customer duration cap covers pointer, keyboard, manual time,
// restored drafts, server requests and prepaid quotes in both environments.
test("250-second clip is valid and 250.001s is rejected before quoting or generation",()=>{
 assert.equal(MAX_VIDEO_SELECTION_SECONDS,250);
 assert.equal(validateSelection(30,280,400),250);
 assert.throws(()=>validateSelection(30,280.001,400),(err:unknown)=>
  err instanceof AppError&&/250 seconds/.test(err.message));
 assert.deepEqual(quoteVideoCredits(0,250,25),{sourceSeconds:250,startedSeconds:250,credits:6250});
 assert.equal(quoteVideoCredits(0,250.001,25),null);
 assert.equal(quoteVideoCredits(125,375,10)?.startedSeconds,250);
 const wave=read("components/waveform.tsx");
 assert.match(wave,/end - MAX_VIDEO_SELECTION_SECONDS/);
 assert.match(wave,/start \+ MAX_VIDEO_SELECTION_SECONDS/);
 assert.match(wave,/value - start <= MAX_VIDEO_SELECTION_SECONDS/);
 assert.doesNotMatch(wave,/end - 300|start \+ 300|Math\.min\(300, end - start\)/);
 const wizard=read("components/studio-wizard.tsx");
 const legacy=read("components/studio.tsx");
 const control=read("components/studio-live.tsx");
 const service=read("lib/live/studio.ts");
 const media=read("lib/live/media.ts");
 assert.match(wizard,/Select a valid audio clip between 5 and \{MAX_VIDEO_SELECTION_SECONDS\} seconds/);
 assert.match(legacy,/MAX_VIDEO_SELECTION_SECONDS\} seconds/);
 assert.match(control,/selection\.end - selection\.start > MAX_VIDEO_SELECTION_SECONDS/);
 assert.match(service,/selection\.end - selection\.start > MAX_VIDEO_SELECTION_SECONDS/);
 assert.match(media,/Math\.min\(MAX_VIDEO_SELECTION_SECONDS, maxSeconds\)/);
});
