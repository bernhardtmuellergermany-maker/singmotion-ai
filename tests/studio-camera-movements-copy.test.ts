import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
 cameraMovements,featuredCameraMovements,additionalCameraMovements,
} from "../lib/studio-camera-movements.ts";

const read=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

test("all 46 camera moves are available in seven categories; eight show initially",()=>{
 assert.equal(cameraMovements.length,46);
 assert.equal(featuredCameraMovements.length,8);
 assert.equal(additionalCameraMovements.length,38);
 assert.equal(new Set(cameraMovements.map(move=>move.category)).size,7);
 assert.equal(new Set(cameraMovements.map(move=>move.name)).size,46);
 assert.equal(new Set(cameraMovements.map(move=>move.direction)).size,46);
 for(const move of cameraMovements){
  assert.ok(move.direction.startsWith("Camera: "));
  assert.ok(move.direction.length<=500,move.name);
  assert.match(move.example,/Movement: .*Speed: .*Framing: .*End: /);
  assert.equal(move.example,move.text);
 }
});

test("Studio camera picker only replaces previous Camera line and expands 38 other moves on demand",()=>{
 const wizard=read("components/studio-wizard.tsx");
 const help=read("app/(site)/help/camera-movements/page.tsx");
 assert.match(help,/import \{cameraMovements\} from "@\/lib\/studio-camera-movements"/);
 assert.match(help,/const techniques=cameraMovements/);
 assert.match(help,/Camera Movements/);
 assert.match(wizard,/featuredCameraMovements\.map\(move/);
 assert.match(wizard,/additionalCameraMovements\.map\(move/);
 assert.match(wizard,/hidden=\{!cameraMovesExpanded\}/);
 assert.match(wizard,/aria-expanded=\{cameraMovesExpanded\}/);
 assert.match(wizard,/aria-controls="sm-more-camera-movements"/);
 assert.match(wizard,/\? "Show less":"Show more"|\?"Show less":"Show more"/);
 assert.match(wizard,/const kept=lines\.filter\(line=>!\/\^Camera:/);
 assert.match(wizard,/kept\.push\(move\.direction\)/);
 assert.match(wizard,/if\(next\.length>500\)/);
 assert.match(wizard,/performanceInput\.current\?\.focus\(\)/);
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
