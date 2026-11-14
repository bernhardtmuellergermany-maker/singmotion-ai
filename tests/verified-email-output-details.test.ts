import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {aiGenerationElapsed,projectCreatedLabel,sourceTimeLabel,videoTimecode} from "../lib/video-project-metadata.ts";
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

test("After guest signup, the original project transfers before an inbox-verification checkpoint",()=>{
 const resume=read("components/studio-account-resume.tsx");
 const gate=read("components/studio-account-gate.tsx");
 assert.match(resume,/sm-credit-checkout-resume/);
 assert.match(resume,/identity\.emailVerification==="pending"/);
 assert.match(resume,/window\.location\.assign\("\/account\/verify-email\?from=studio"\)/);
 assert.ok(resume.indexOf('if(identity.emailVerification==="pending")')>resume.indexOf('const draftResponse='));
 assert.ok(resume.indexOf('if(identity.emailVerification==="pending")')<resume.indexOf('const balanceResponse='));
 assert.match(gate,/Email accounts must verify their address before purchasing Credits/);
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
