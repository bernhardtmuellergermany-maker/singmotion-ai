import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import sharp from "sharp";
import {
 cameraMovements,featuredCameraMovements,additionalCameraMovements,cameraMovementPreview,replaceCameraQuickTip,
} from "../lib/studio-camera-movements.ts";

const read=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

test("all 34 camera moves are available; nine recommended moves show initially",()=>{
 assert.equal(cameraMovements.length,34);
 assert.equal(featuredCameraMovements.length,9);
 assert.deepEqual(featuredCameraMovements.map(move=>move.name),["Static shot","Pan right","Pan left","Slow zoom in","Slow zoom out","Dolly in","Dolly out","Handheld shot","Reverse tracking"]);
 for(const name of ["Crash zoom in","Crash zoom out","Vehicle tracking","Chase shot","Helicopter shot","Snorricam","First-person view","Tilt-shift","Infinite zoom","Earth zoom out","Time-lapse","Pass through"])assert.ok(!cameraMovements.some(move=>move.name===name),name);
 assert.ok(additionalCameraMovements.every(move=>!move.recommended));
 assert.equal(additionalCameraMovements.length,25);
 assert.equal(new Set(cameraMovements.map(move=>move.category)).size,6);
 assert.equal(new Set(cameraMovements.map(move=>move.name)).size,34);
 assert.equal(new Set(cameraMovements.map(move=>move.direction)).size,34);
 for(const move of cameraMovements){
  assert.ok(move.direction.startsWith("Camera: "));
  assert.ok(move.direction.length<=500,move.name);
  assert.match(move.example,/Movement: .*Speed: .*Framing: .*End: /);
  assert.equal(move.example,move.text);
 }
});

test("Studio camera picker only replaces library quick tips and expands 25 experimental moves on demand",()=>{
 const wizard=read("components/studio-wizard.tsx");
 const help=read("app/(site)/help/camera-movements/page.tsx");
 assert.match(help,/import \{cameraMovements\} from "@\/lib\/studio-camera-movements"/);
 assert.match(help,/const techniques=cameraMovements/);
 assert.match(help,/Camera Movements/);
 assert.match(help,/movementGroups\.map/);
 assert.match(help,/sm-camera-rating/);
 assert.match(wizard,/sm-camera-chip-recommended/);
 assert.match(wizard,/sm-camera-chip-experimental/);
 assert.match(wizard,/featuredCameraMovements\.map\(move/);
 assert.match(wizard,/additionalCameraMovements\.map\(move/);
 assert.match(wizard,/hidden=\{!cameraMovesExpanded\}/);
 assert.match(wizard,/aria-expanded=\{cameraMovesExpanded\}/);
 assert.match(wizard,/aria-controls="sm-more-camera-movements"/);
 assert.match(wizard,/Show more \(25 experimental\)/);
 assert.match(wizard,/if\(next\.length>500\)/);
 assert.doesNotMatch(wizard,/performanceInput\.current\??\.focus\s*\(/);
 assert.match(wizard,/if\(document\.activeElement===performanceInput\.current\)performanceInput\.current\?\.blur\(\)/);
 assert.doesNotMatch(wizard,/<textarea[^>]*\bautoFocus\b/);
 assert.doesNotMatch(wizard,/Quick ideas|Add performance ideas/);
});

test("Studio removes specified redundant photo, audio and performance copy",()=>{
 const wizard=read("components/studio-wizard.tsx");
 for(const phrase of [
  "clear front-facing portrait recommended",
  "Choose 16:9 or 9:16 to frame the reference photo",
  "Your audio stays private in your workspace.",
  "Describe natural movements, facial expressions and camera motion.",
 ])assert.ok(!wizard.includes(phrase),phrase);
 assert.match(wizard,/JPG, PNG · up to 30 MB/);
 assert.match(wizard,/Login to generate/);
 assert.doesNotMatch(wizard,/Login to generate video/);
});

test("AI-use and privacy documents, plus camera Help, open separately from Studio",()=>{
 const wizard=read("components/studio-wizard.tsx");
 const css=read("app/(site)/studio-refinement.css");
 const legal=read("components/legal-policies.tsx");
 for(const route of ["/rights","/ai-transparency","/terms","/privacy"]){
  const pattern=new RegExp('href="'+route+'" target="_blank" rel="noopener noreferrer"');
  assert.match(wizard,pattern,route);
  const slug=route.slice(1);
  assert.ok(legal.includes(slug+":")||legal.includes('"'+slug+'":'),route+" legal section");
 }
 assert.match(wizard,/href="\/help\/camera-movements" target="_blank" rel="noopener noreferrer"/);
 assert.match(wizard,/AI-generated videos can contain unexpected visual, motion or lip-sync imperfections/);
 assert.match(wizard,/Next: sign in or create a free account/);
 assert.match(css,/\.sm-review-ai-notice,\s*\.product-theme\.singmotion-flow \.sm-review-payment-note\{/);
 assert.match(css,/text-align:center!important/);
 assert.match(css,/sm-review-legal-links/);
 assert.match(css,/sm-studio-next\.is-login-action \.sm-studio-next-label\{/);
 assert.match(css,/white-space:nowrap!important/);
 assert.match(css,/sm-camera-extra-movements\[hidden\]/);
});

test("camera previews are unique, local 640x360 animated WebPs with static reduced-motion posters",async()=>{
 const unique=new Set<string>();
 for(const move of cameraMovements){
  const {animation,poster}=cameraMovementPreview(move);
  assert.match(animation,/^\/camera-movements\/singmotion-[a-z0-9-]+\.webp$/);
  assert.ok(!unique.has(animation)); unique.add(animation);
  const bytes=readFileSync(new URL("../public"+animation,import.meta.url));
  const meta=await sharp(bytes,{animated:true}).metadata();
  assert.equal(meta.width,640,move.name);
  assert.equal(meta.pageHeight,360,move.name);
  assert.equal(meta.loop,0,move.name);
  assert.ok((meta.pages??0)>1,move.name);
  assert.equal(meta.delay?.reduce((a,b)=>a+b,0),3600,move.name);
  assert.ok(bytes.length<300000,move.name);
  const still=await sharp(readFileSync(new URL("../public"+poster,import.meta.url))).metadata();
  assert.equal(still.width,640);assert.equal(still.height,360);assert.equal(still.pages??1,1);
 }
 assert.equal(unique.size,34);
});
test("shared lazy preview has a still for reduced motion and Studio keeps one dismissible selection",()=>{
 const preview=read("components/camera-movement-preview.tsx");
 const wizard=read("components/studio-wizard.tsx");
 const help=read("app/(site)/help/camera-movements/page.tsx");
 assert.match(preview,/cameraMovementPreview\(move\)/);
 assert.match(preview,/loading="lazy"/);
 assert.match(preview,/prefers-reduced-motion: reduce/);
 assert.match(preview,/width=\{640\} height=\{360\}/);
 assert.match(preview,/Not generated by OmniHuman 2.0/);
 assert.match(help,/<CameraMovementPreview move=\{t\}\/>/);
 assert.match(wizard,/setCameraPreview\(move\)/);
 assert.match(wizard,/setCameraPreview\(null\)/);
 assert.match(wizard,/cameraPreview\?\.recommended/);
 assert.match(wizard,/cameraMovesExpanded && cameraPreview && !cameraPreview\.recommended/);
 assert.match(wizard,/aria-expanded=\{cameraPreview\?\.id===move\.id\}/);
});

test("quick tip switching preserves personal instructions and whitespace",()=>{
 const [a,b]=featuredCameraMovements;
 const c=additionalCameraMovements[0];
 const own="  Sing with joy.\n\nCamera: Keep my own framing.\nCustom lighting.  ";
 assert.equal(replaceCameraQuickTip("",a),a.direction);
 assert.equal(replaceCameraQuickTip(own,a),own+"\n"+a.direction);
 assert.equal(replaceCameraQuickTip(own+"\n"+a.direction,b),own+"\n"+b.direction);
 assert.equal(replaceCameraQuickTip(own+"\n"+b.direction,b),own+"\n"+b.direction);
 assert.equal(replaceCameraQuickTip(own+"\n"+a.direction+"\n"+b.direction,c),own+"\n"+c.direction);
 assert.equal(replaceCameraQuickTip(a.direction+"\n"+own,c),c.direction+"\n"+own);
 assert.equal(replaceCameraQuickTip(own+"\n\n"+a.direction,b),own+"\n\n"+b.direction);
 assert.equal(replaceCameraQuickTip(own+"\n"+a.direction+"\nAdditional manual text.",b),own+"\n"+b.direction+"\nAdditional manual text.");
 assert.equal(replaceCameraQuickTip(own+"\n",a),own+"\n"+a.direction);
 assert.match(read("components/studio-wizard.tsx"),/replaceCameraQuickTip\(draft\.customPrompt,move\)/);
});
