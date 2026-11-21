import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
test("9:16 uploaded photo has its own responsive preview, without changing 16:9 or custom editor",()=>{
 const ui=read("components/studio-wizard.tsx");
 const css=read("app/(site)/studio-refinement.css");
 assert.match(ui,/draft\.outputFormat==="16:9"\?"is-landscape":"is-portrait"/);
 assert.match(css,/\.sm-photo-editor-stage\.is-portrait\{/);
 assert.match(css,/width:min\(100%, calc\(42dvh \* 9 \/ 16\), 240px\)/);
 assert.match(css,/max-height:42dvh/);
 assert.match(css,/@media\(max-width:700px\)\{\s*\.product-theme\.singmotion-flow \.sm-photo-editor-stage\.is-portrait\{/);
 assert.match(css,/width:100%;\s*max-width:100%;\s*height:auto;\s*max-height:none;\s*aspect-ratio:9 \/ 16/);
 assert.match(css,/\.sm-photo-editor-stage\.is-landscape\{/);
 assert.match(css,/\.sm-photo-one-row\{/);
});

test("portrait photo height is capped on phones so the editor can scroll to its controls",()=>{
 const css=read("app/(site)/studio-refinement.css");
 assert.match(css,/width:min\(100%, calc\(60dvh \* 9 \/ 16\), 340px\)/);
 assert.match(css,/max-height:60dvh/);
 assert.match(css,/\.sm-photo-crop-viewport\{[\s\S]*?touch-action:pan-y/);
 assert.match(css,/\.sm-photo-crop-corner\{[\s\S]*?touch-action:none/);
});
