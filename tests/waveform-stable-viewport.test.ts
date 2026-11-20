import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const waveform=readFileSync(new URL("../components/waveform.tsx",import.meta.url),"utf8");

test("waveform viewport remains fixed during selection and handle drags",()=>{
 assert.match(waveform,/\[lockedView, setLockedView\]/);
 assert.match(waveform,/lockedView\?\.span \?\? calculatedSpan/);
 assert.match(waveform,/lockedView\?\.start \?\?/);
 assert.match(waveform,/const lockViewport = \(\) =>/);
 assert.match(waveform,/if\(!lockedView\)setLockedView\(\{start:viewStart,span:viewSpan\}\)/);
 assert.match(waveform,/lockViewport\(\);\s*setDragging\(true\)/);
 assert.match(waveform,/lockViewport\(\);\s*onChange\(/);
});

test("explicit zoom changes the viewport while drag completion releases the handle lock",()=>{
 assert.match(waveform,/const zoomBy=\(factor:number\)=>/);
 assert.match(waveform,/setLockedView\(\{\.\.\.next,freePan:true\}\)/);
 assert.match(waveform,/const zoomIn=\(\)=>zoomBy\(1\.45\)/);
 assert.match(waveform,/const zoomOut=\(\)=>zoomBy\(1\/1\.45\)/);
 // Pointer completion may release the handle lock; drag motion must not recenter.
 assert.match(waveform,/if\(!pinchBlocked\.current\)\{setDragging\(false\);setLockedView\(null\);\}/);
 assert.match(waveform,/setLockedView\(previous=>previous\?\{\.\.\.previous,freePan:false\}:null\)/);
});
