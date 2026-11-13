import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const waveform=readFileSync(new URL("../components/waveform.tsx",import.meta.url),"utf8");

test("native audio seeking outside the selection cannot deactivate the end guard",()=>{
  const seeking=waveform.slice(waveform.indexOf("        onSeeking={() => {"));
  assert.match(seeking,/if\(a\.currentTime < start \|\| a\.currentTime > end\)/);
  assert.match(seeking,/a\.currentTime=start/);
  assert.doesNotMatch(seeking,/segment\.current = false/);
});

test("both native player and frame timer enforce absolute clip boundaries",()=>{
  assert.match(waveform,/onPlay=\{\(\) => \{[\s\S]*?segment\.current=true/);
  assert.match(waveform,/if\(a\.currentTime < start \|\| a\.currentTime >= end\)/);
  assert.match(waveform,/if\(a\.currentTime >= end\)\{\s*a\.pause\(\);\s*a\.currentTime=end/);
  assert.match(waveform,/if \(player\.currentTime >= end\) \{\s*player\.pause\(\)/);
  assert.match(waveform,/\}, \[start,end\]\);/);
});
