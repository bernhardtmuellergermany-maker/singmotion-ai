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

test("only explicit zoom resets the locked waveform window",()=>{
 assert.match(waveform,/const zoomIn = \(\) => \{setLockedView\(null\);setZoomLevel/);
 assert.match(waveform,/const zoomOut = \(\) => \{setLockedView\(null\);setZoomLevel/);
 assert.doesNotMatch(waveform,/onPointerMove[^]*?setLockedView\(null\)/);
});
