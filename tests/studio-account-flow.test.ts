import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {studioAccountReturn,parseStudioAccountReturn} from "../lib/studio-account-handoff.ts";
import {privateSourceKey,validCloudRecord} from "../lib/cloud-media.ts";
const read=(p:string)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");

test("guest Studio return is same-origin and bounded to an exact draft, never a redirect",()=>{
 const draft="123e4567-e89b-42d3-a456-426614174000";
 const path=studioAccountReturn(draft,125);
 assert.equal(path,"/studio/continue?draft="+draft+"&requiredCredits=125");
 assert.deepEqual(parseStudioAccountReturn(path),{draftId:draft,requiredCredits:125});
 for(const invalid of [null,"", "//evil.test/studio/continue?draft="+draft+"&requiredCredits=125",
  "https://evil.test/studio/continue?draft="+draft+"&requiredCredits=125",
  "/studio/continue?draft=../x&requiredCredits=125",
  "/studio/continue?draft="+draft+"&requiredCredits=125&returnTo=//evil.test",
  "/studio/continue?draft="+draft+"&requiredCredits=0",
  "/studio/continue?draft="+draft+"&requiredCredits=100000",
  "/studio/continue?draft="+draft+"&requiredCredits=125#fragment",
  "/studio/continue?draft="+draft+"&requiredCredits=125&requiredCredits=125",
  "/studio/continue?requiredCredits=125&draft="+draft,
  "/studio?draft="+draft+"&resume=account&requiredCredits=125"]){
  assert.equal(parseStudioAccountReturn(invalid),null,String(invalid));
 }
 assert.equal(studioAccountReturn("../bad",125),null);
 assert.equal(studioAccountReturn(draft,0),null);
 assert.equal(studioAccountReturn(draft,7501),null);
});

test("Guest Step 4 never opens an operator dialog or starts paid work before login",()=>{
 const wizard=read("components/studio-wizard.tsx");
 const gate=read("components/studio-account-gate.tsx");
 assert.match(wizard,/Login to generate video/);
 assert.match(wizard,/creditStudio\?void startCreditGeneration\(\):void openGuestAccount\(\)/);
 assert.match(wizard,/await saveQueue\.current/);
 assert.match(wizard,/await api\("studio-drafts"/);
 assert.match(wizard,/setGuestAccountOpen\(true\)/);
 assert.match(wizard,/<StudioAccountGate draftId=\{projectKey\} requiredCredits=\{creditQuote\.credits\}/);
 assert.match(gate,/Account creation is <strong>free<\/strong>/);
 assert.match(gate,/action:mode,email,password/);
 assert.match(gate,/mode==="register"\?20:1/);
 assert.match(gate,/Continue with Google/);
 assert.match(gate,/sm-studio-account-resume|STUDIO_ACCOUNT_RESUME_KEY/);
 assert.doesNotMatch(gate,/api\/cms\/staff\/login/);
 assert.doesNotMatch(gate,/api\/stripe|studio-live.*submit/);
});

test("Google OAuth redirects back to only the validated server-bound Studio return",()=>{
 const oauth=read("app/(site)/api/google-auth/route.ts");
 const callback=read("app/(site)/api/google-auth/callback/route.ts");
 assert.match(oauth,/parseStudioAccountReturn\(req\.nextUrl\.searchParams\.get\("returnTo"\)\)/);
 assert.match(oauth,/returnTo\?\{returnTo\}:\{\}/);
 assert.match(callback,/savedReturn=parseStudioAccountReturn\(saved\.returnTo\|\|null\)/);
 assert.match(callback,/savedReturn\?savedReturn\+"&auth_changed=1"/);
 assert.match(callback,/sm_guest_session/);
});

test("Account handoff never grants cross-account ownership or payments based on URL alone",()=>{
 const resume=read("components/studio-account-resume.tsx");
 const importer=read("app/(site)/api/customer-guest-import/route.ts");
 assert.match(resume,/sessionStorage\.getItem\(STUDIO_ACCOUNT_RESUME_KEY\)/);
 assert.match(resume,/identity\.kind!=="customer"/);
 assert.match(resume,/workspace\.owner\?\.startsWith\("customer-"\)/);
 assert.match(resume,/\/api\/customer-guest-import/);
 assert.match(resume,/saved\.selection\?\.owner!==workspace\.owner/);
 assert.match(resume,/quote\.credits!==wanted\.requiredCredits/);
 assert.match(resume,/mode:"execute",confirmation:"IMPORT MY GUEST PROJECTS",draftId/);
 assert.match(importer,/customerIdentityOrigin\(process\.env\)/);
 assert.match(importer,/session\(req\.cookies\.get\("sm_guest_session"\)\?\.value\)/);
 assert.match(importer,/SELECT selection,step FROM studio_drafts WHERE id=\? AND owner=\?/);
 assert.match(importer,/rehomeMirroredPrivateSource\(guestOwner,accountOwner,asset,original\)/);
 assert.match(importer,/BEGIN IMMEDIATE/);
 assert.match(importer,/UPDATE cloud_source_media SET owner=\?,key=\?/);
 const from="ed8a85ee-e4b3-40f5-9234-35d10e677122";
 const to="customer-3f1dff00-ec2e-4f0a-b8e7-683baa2e9c03";
 const assetId="4abf1c13-1abe-4d2d-82b8-b2ab93c4baef";
 const digest="a".repeat(64);
 const source={key:privateSourceKey(from,assetId,digest),sha256:digest,bytes:345};
 const target={key:privateSourceKey(to,assetId,digest),sha256:digest,bytes:345};
 assert.notEqual(source.key,target.key);
 assert.equal(validCloudRecord(from,assetId,source),true);
 assert.equal(validCloudRecord(to,assetId,source),false);
 assert.equal(validCloudRecord(to,assetId,target),true);
});

test("Stripe success only resumes Step 4 after the actual wallet meets the quote",()=>{
 const credits=read("components/credits-dashboard.tsx");
 const checkout=read("app/(site)/api/credit-checkout/route.ts");
 assert.match(credits,/checkoutResult==="success"&&resumeCandidate&&/);
 assert.match(credits,/data\.availableCredits>=resumeCandidate\.requiredCredits/);
 assert.match(credits,/window\.location\.assign\("\/studio\?draft="/);
 assert.match(checkout,/success_url:`\$\{origin\}\/credits\?checkout=success\$\{resume\}`/);
 assert.match(credits,/Continue project · Step 4/);
 assert.doesNotMatch(credits,/window\.location\.replace\("\/studio\?draft="/);
});
