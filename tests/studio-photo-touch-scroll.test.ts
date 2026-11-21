import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(p:string)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("mobile touch swipes scroll on the large photo while crop corners remain draggable",()=>{
 const ui=read("components/studio-wizard.tsx");
 const css=read("app/(site)/studio-refinement.css");
 assert.match(ui,/e\.pointerType==="touch"\)return/);
 assert.match(ui,/cropDrag\.current=\{x:e\.clientX,y:e\.clientY/);
 assert.match(css,/@media\(pointer:coarse\)\{[\s\S]*?\.sm-photo-crop-viewport\{\s*touch-action:pan-y/);
 assert.match(css,/\.sm-photo-editor-stage \.sm-photo-crop-corner\{\s*touch-action:none/);
 assert.match(css,/\.sm-photo-editor-stage \.sm-photo-overlay-trash\{\s*touch-action:manipulation/);
 assert.match(ui,/onPointerDown=\{e=>startCropHandle\(e,"tl"\)\}/);
 assert.match(ui,/onPointerDown=\{e=>startCropHandle\(e,"br"\)\}/);
 assert.match(ui,/aria-label="Delete artist photo"/);
});
