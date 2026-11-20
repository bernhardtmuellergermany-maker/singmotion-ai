import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {canNavigateStudioStep,type StudioStepNavigation} from "../lib/studio-step-navigation.ts";

const read=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const valid:StudioStepNavigation={
 currentStep:3,targetStep:0,ready:true,busy:false,generating:false,
 generationStarted:false,audioValid:true,hasPhoto:true,frameValid:true,
 imageReady:true,photoPending:false,photoApplied:true,
};
const check=(changes:Partial<StudioStepNavigation>)=>canNavigateStudioStep({...valid,...changes});

test("all four numbered circles can revisit earlier and completed Studio steps",()=>{
 for(let from=0;from<=3;from++)for(let to=0;to<=3;to++)
  assert.equal(check({currentStep:from,targetStep:to}),true,`step ${from+1} -> ${to+1}`);
 for(const to of [-2,-1,4,99,NaN,1.5])
  assert.equal(check({targetStep:to}),false);
});
test("future steps stay locked until their audio/photo prerequisites are fulfilled",()=>{
 assert.equal(check({currentStep:0,targetStep:1,audioValid:false}),false);
 for(const to of [2,3]){
  assert.equal(check({currentStep:0,targetStep:to,hasPhoto:false}),false);
  assert.equal(check({currentStep:0,targetStep:to,frameValid:false}),false);
  assert.equal(check({currentStep:0,targetStep:to,photoApplied:false}),false);
  assert.equal(check({currentStep:0,targetStep:to,photoPending:true}),false);
 }
 assert.equal(check({currentStep:1,targetStep:2,photoPending:true,imageReady:true}),true);
 assert.equal(check({currentStep:1,targetStep:3,photoApplied:false,imageReady:true}),true);
 assert.equal(check({currentStep:1,targetStep:3,photoPending:true,imageReady:false}),false);
 assert.equal(check({currentStep:3,targetStep:1,audioValid:false,photoPending:true}),true);
});
test("upload, generation and prepared jobs block step jumping",()=>{
 for(const stopped of [{ready:false},{busy:true},{generating:true},{generationStarted:true}]){
  assert.equal(check({...stopped,targetStep:0}),false);
  assert.equal(check({...stopped,targetStep:3}),false);
 }
});
test("both mobile and desktop step circles are buttons with visible focus and larger tap targets",()=>{
 const jsx=read("components/studio-wizard.tsx");
 const css=read("app/(site)/studio-refinement.css");
 assert.match(jsx,/className="sm-new-step-dot"/);
 assert.match(jsx,/type="button" className="sm-new-step-dot"/);
 assert.match(jsx,/aria-current=\{index===step\?"step":undefined\}/);
 assert.match(jsx,/disabled=\{!canNavigateStudioStep\(navigationFor\(index\)\)\}/);
 assert.match(jsx,/onClick=\{\(\)=>void jumpToStudioStep\(index\)\}/);
 assert.match(jsx,/if\(target>1&&step===1&&\(cropPending\|\|!appliedImageReady\)\)/);
 assert.match(jsx,/await continueFromPhoto\(target as 2\|3\)/);
 assert.match(jsx,/generationStarted:!!generationProjectId/);
 assert.match(read("lib/studio-step-navigation.ts"),/if\(!ready\|\|busy\|\|generating\|\|generationStarted\)return false/);
 assert.match(css,/\.sm-new-step-dot:focus-visible/);
 assert.match(css,/\.sm-new-step-dot::after/);
 assert.match(css,/@media\(max-width:700px\)/);
 assert.doesNotMatch(jsx,/<span className="sm-new-step-dot">/);
});
