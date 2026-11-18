
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {boundWaveViewport,panWaveViewport,pinchWaveViewport,dragWaveHandleTime} from "../lib/studio-wave-navigation.ts";
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
   "aria-label=\"Pan audio waveform\"","aria-pressed={panMode}",
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
 assert.match(wave,/target\.closest\("\.wave-handle"\)/);
 assert.match(wave,/if\(pinchBlocked\.current\|\|panMode\)return/);
 assert.match(wave,/if\(target\.closest\("\.wave-handle"\)\|\|\(!panMode&&target\.closest\("\.wave-selection"\)\)\)return/);
 assert.match(wave,/setLockedView\(\{start:viewStart,span:viewSpan,freePan:false\}\)/);
 assert.match(wave,/setLockedView\(previous=>previous\?\{\.\.\.previous,freePan:false\}:null\)/);
 assert.match(wave,/handle==="start"\?<ChevronLeft/);
 assert.match(wave,/:<ChevronRight/);
 assert.match(css,/\.wave-handle-start\{\s*transform:translate\(-100%,-50%\)!important/);
 assert.match(css,/\.wave-handle-end\{\s*transform:translate\(0,-50%\)!important/);
 assert.match(css,/\.wave-selection-hit\{pointer-events:none!important/);
});

test("mouse and touch can pan the track, Hand mode pans within selection, and smaller grips stay touch-friendly",()=>{
 const wave=read("components/waveform.tsx"),css=read("app/(site)/studio-refinement.css");
 assert.doesNotMatch(wave,/e.pointerType==="mouse"&&!panMode/);
 assert.match(wave,/if\(pinchBlocked\.current\|\|panMode\)return;\s*e\.stopPropagation\(\)/);
 assert.match(wave,/Hand moves audio under selection/);
 assert.match(css,/\.wave-grip-mark\{\s*flex:0 0 12px!important;\s*width:12px!important/);
 assert.match(css,/flex:0 0 13px!important;\s*width:13px!important/);
 assert.match(css,/\.wave-time\{[\s\S]*?width:calc\(100% - 84px\)!important;\s*margin-left:42px!important/);
 assert.match(css,/\.wave-bars i\{\s*flex:1 1 0!important;[\s\S]*?min-width:0!important/);
 assert.match(css,/\.wave-handle::after\{\s*content:none!important;\s*display:none!important/);
 assert.match(css,/\.wave-strip\{\s*clip-path:none!important/);
});

test("waveform track is precisely centered, not forced 84px too wide by old min-width rule",()=>{
 const css=read("app/(site)/studio-refinement.css");
 assert.match(css,/\.studio-modern-wave \.wave-viewport\{[\s\S]*?box-sizing:border-box!important;[\s\S]*?padding-inline:0!important/);
 assert.match(css,/\.studio-modern-wave \.wave-strip\{[\s\S]*?width:calc\(100% - 84px\)!important;[\s\S]*?min-width:0!important;[\s\S]*?margin-inline:42px!important/);
 assert.match(css,/\.studio-modern-wave \.wave-time\{\s*min-width:0!important;\s*max-width:calc\(100% - 84px\)!important/);
 assert.match(css,/\.wave-handle:focus-visible\{\s*outline:none!important/);
 assert.match(css,/\.wave-handle:focus-visible \.wave-grip-mark\{\s*outline:2px solid #d88aff!important/);
});
