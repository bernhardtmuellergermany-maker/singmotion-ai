import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {aiGenerationElapsed,projectCreatedLabel,sourceTimeLabel,videoTimecode} from "../lib/video-project-metadata.ts";
import {nextStudioAudioSelection} from "../lib/studio-next-segment.ts";
import type {StudioDraftExport} from "../lib/studio-draft.ts";
const read=(p:string)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");

test("Video metadata is formatted from recorded evidence, never guessed from the clock",()=>{
 assert.equal(videoTimecode(5.125,true),"00:05.125");
 assert.equal(videoTimecode(74.7),"01:14");
 assert.equal(sourceTimeLabel(5,16.125),"00:05.000 – 00:16.125");
 assert.equal(sourceTimeLabel(30,11),null);
 assert.equal(videoTimecode(NaN),null);
 assert.equal(aiGenerationElapsed(100000,190000),"1m 30s");
 assert.equal(aiGenerationElapsed(100000,100000),"0s");
 for(const [a,b] of [[null,200000],[1000,null],[10000,5000],[10000,Infinity],[10000,10000+8*24*3600000]] as const)
  assert.equal(aiGenerationElapsed(a,b),null);
 assert.equal(projectCreatedLabel(null),null);
 assert.equal(projectCreatedLabel(0),null);
 assert.ok(projectCreatedLabel(1700000000000)?.includes("2023"));
});

test("After guest signup, media transfers before returning to Step 4; verification still gates purchases",()=>{
 const resume=read("components/studio-account-resume.tsx");
 const checkout=read("app/(site)/api/credit-checkout/route.ts");
 assert.match(resume,/\/api\/customer-guest-import/);
 assert.match(resume,/saved\.selection\?\.owner!==workspace\.owner/);
 assert.match(resume,/window\.location\.assign\("\/studio\?draft="\+encodeURIComponent\(wanted\.draftId\)\+"&resume=review"\)/);
 assert.doesNotMatch(resume,/window\.location\.assign\("\/account\/verify-email\?/);
 assert.doesNotMatch(resume,/window\.location\.assign\("\/credits\?resumeDraft=/);
 assert.match(checkout,/identity\.customerId && !store\.emailVerified\(identity\.customerId\)/);
});

test("Email verification has a verified-wallet call to action and does not authorize payments",()=>{
 const verify=read("app/(site)/account/verify-email/page.tsx");
 const emailRoute=read("app/(site)/api/customer-email-verification/route.ts");
 const balance=read("app/(site)/api/credit-balance/route.ts");
 const dashboard=read("components/credits-dashboard.tsx");
 const checkout=read("app/(site)/api/credit-checkout/route.ts");
 assert.match(verify,/Buy Credits for your video/);
 assert.match(verify,/Confirm email address/);
 assert.match(verify,/Resend verification email/);
 assert.match(verify,/sm-credit-checkout-resume/);
 assert.match(verify,/resumeDraft=/);
 assert.match(verify,/confirmed\?<Link href=\{buyUrl\}/);
 assert.match(emailRoute,/store\.verifyEmailToken\(input\.token\)/);
 assert.match(balance,/emailVerification:identity\.customerId\?store\.verificationState/);
 assert.match(balance,/!identity\.customerId\|\|store\.emailVerified\(identity\.customerId\)/);
 assert.match(dashboard,/balance\.emailVerification==="pending"/);
 assert.match(dashboard,/balance\.emailVerification!=="pending"/);
 assert.match(checkout,/identity\.customerId && !store\.emailVerified\(identity\.customerId\)/);
 assert.doesNotMatch(verify,/\/api\/credit-checkout|\/api\/stripe-webhook|studio-live.*submit/);
});

test("Verified finished Studio videos replace progress milestones with factual project metadata",()=>{
 const status=read("components/generation-status-view.tsx");
 const detail=read("components/completed-video-details.tsx");
 const studio=read("components/super-admin-generation.tsx");
 const workflow=read("lib/live/studio.ts");
 assert.match(status,/ready\?\(projectDetails\?/);
 assert.match(status,/<CompletedVideoDetails data=\{projectDetails\} measuredDurationSeconds=\{measuredVideoSeconds\}/);
 assert.match(status,/onLoadedMetadata=\{event=>/);
 assert.match(status,/<>\s*<h2>Generation progress<\/h2>/);
 assert.match(detail,/Project name/);
 assert.match(detail,/Rename project/);
 assert.match(detail,/Project ID/);
 assert.match(detail,/Source time/);
 assert.match(detail,/Time for AI video generation/);
 assert.match(detail,/Copy prompt/);
 assert.match(detail,/<details className="sm-finished-prompt">/);
 assert.match(detail,/action:"rename",id:data.renameId,name:next/);
 assert.match(detail,/method:"PATCH"/);
 assert.match(studio,/projectDetails=\{project\?\.outputReady\?/);
 assert.match(studio,/generationStartedAt:project\.generationStartedAt/);
 assert.match(studio,/generationFinishedAt:project\.generationFinishedAt/);
 assert.match(workflow,/generationStartedAt:/);
 assert.match(workflow,/generationFinishedAt:/);
 assert.match(workflow,/row\.started_at/);
 assert.match(workflow,/a\.updatedAt/);
 assert.doesNotMatch(detail,/new Date\(\)/);
});

test("Historical customer order card uses only owner-scoped fields, and no invented render timing",()=>{
 const paid=read("components/customer-paid-output.tsx");
 const orderQuery=read("lib/commerce/customer-orders-query.ts");
 assert.match(paid,/projectDetails=\{ready\?/);
 assert.match(paid,/createdAt:order\?\.created/);
 assert.match(paid,/selectedDurationSeconds:order\?\.durationSeconds/);
 assert.match(paid,/renameOrderId:guest\?null:orderId/);
 assert.match(orderQuery,/WHERE \(o\.account_id=\? OR gc\.account_id=\?\)/);
 assert.doesNotMatch(paid,/generationFinishedAt:Date\.now/);
});


test("next segment starts at the exact original end and resets all visual inputs",()=>{
 const prior:StudioDraftExport={version:1,owner:"customer-fixture",songId:"song-1",imageId:"image-1",sourceImageId:"original-photo",editedImageId:"image-1",appliedOutputFormat:"16:9",outputFormat:"16:9",formatMode:"auto",start:10.123,end:25.456,performance:"Emotional",camera:"Orbit left",customPrompt:"Previous shot"};
 const next=nextStudioAudioSelection(prior,120)!;
 assert.equal(next.start,prior.end);
 assert.equal(next.end,prior.end+(prior.end-prior.start));
 assert.equal(next.songId,prior.songId);assert.equal(next.owner,prior.owner);
 assert.equal(next.imageId,"");assert.equal(next.customPrompt,"");assert.equal(next.performance,"Natural");assert.equal(next.camera,"Static camera");
 assert.equal(next.sourceImageId,undefined);assert.equal(next.editedImageId,undefined);assert.equal(next.appliedOutputFormat,undefined);
 assert.equal(prior.imageId,"image-1");
 assert.equal(nextStudioAudioSelection(prior,32)?.end,32);
 assert.equal(nextStudioAudioSelection(prior,prior.end+4.99),null);
 assert.equal(nextStudioAudioSelection(prior,prior.end),null);
 assert.equal(nextStudioAudioSelection(prior,null),null);
 assert.equal(nextStudioAudioSelection({...prior,start:0,end:250},1000)?.end,500);
 const third=nextStudioAudioSelection(next,120)!;assert.equal(third.start,next.end);
});
test("completed video next-segment action uses only immutable owned audio and creates an independent Step 1 draft",()=>{
 const route=read("app/(site)/api/studio-live/route.ts"),view=read("components/generation-status-view.tsx"),output=read("components/super-admin-generation.tsx"),button=read("components/next-audio-segment-button.tsx");
 const next=route.split('req.nextUrl.searchParams.get("next") === "1"')[1].split('req.nextUrl.searchParams.get("copy")')[0];
 assert.match(next,/!project\.outputReady\|\|project\.selection\.owner!==owner/);
 assert.match(next,/asset\(project\.selection\.songId,owner\)/);
 assert.doesNotMatch(next,/asset\(project\.selection\.imageId/);
 assert.match(next,/nextStudioAudioSelection\(project\.selection,song\.duration\)/);
 assert.match(output,/nextSegmentId=\{project\?\.outputReady\?project\.id:null\}/);
 assert.ok(view.indexOf("{ready&&nextSegmentId&&<NextAudioSegmentButton")<view.indexOf("{ready&&reuseHref&&<a"));
 assert.match(button,/const draftId=crypto\.randomUUID\(\)/);
 assert.match(button,/selection:source\.selection/);
 assert.match(button,/step:0/);
 assert.match(button,/router\.push\("\/studio\?draft="\+encodeURIComponent\(draftId\)\)/);
 // Clearing a stale checkout-resume key is required, not a checkout request.
 const clearCreditResume='sessionStorage.removeItem("sm-credit-checkout-resume")';
 const clearAccountResume='sessionStorage.removeItem("sm-studio-account-resume")';
 const navigation=button.indexOf('router.push("/studio?draft="');
 for(const cleanup of [clearCreditResume,clearAccountResume]){
  assert.equal(button.split(cleanup).length,2);
  assert.ok(button.indexOf(cleanup)<navigation);
 }
 assert.doesNotMatch(button.replace(clearCreditResume,""),/action\s*:\s*["']submit["']|credit-checkout|uploadWithProgress/);
});
