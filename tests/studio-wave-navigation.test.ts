
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
