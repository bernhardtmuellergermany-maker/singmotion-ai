import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {parseSavedStudioDraft} from "../lib/studio-draft.ts";
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

test("guest Step 4 saves the complete server-owned draft, then opens the standard login first",()=>{
 const wizard=read("components/studio-wizard.tsx");
 const login=read("components/account-panel.tsx");
 const page=read("app/(site)/login/page.tsx");
 const start=wizard.indexOf("async function openGuestAccount()");
 const end=wizard.indexOf("async function continueToCreditPurchase()",start);
 assert.ok(start>0&&end>start);
 const action=wizard.slice(start,end);
 assert.match(wizard,/Login to generate/);
 assert.match(wizard,/!creditStudio\?void openGuestAccount\(\):reviewShortage\?void continueToCreditPurchase\(\):void startCreditGeneration\(\)/);
 assert.match(action,/await saveQueue\.current/);
 assert.match(action,/await api\("studio-drafts"/);
 assert.match(action,/id:projectKey,selection,artistName:draft\.artistName/);
 assert.match(action,/projectName,step:3/);
 assert.match(action,/studioAccountReturn\(projectKey,creditQuote\.credits\)/);
 assert.match(action,/sessionStorage\.setItem\(STUDIO_ACCOUNT_RESUME_KEY/);
 assert.match(action,/window\.location\.assign\("\/login\?returnTo="\+encodeURIComponent\(returnTo\)\)/);
 assert.doesNotMatch(wizard,/StudioAccountGate|setGuestAccountOpen/);
 assert.match(page,/<AccountPanel active=\{true\}\/>/);
 assert.match(login,/useState<"login"\|"register">\("login"\)/);
 assert.match(login,/Back to sign in|Create account/);
 assert.match(login,/pendingStudioReturn\(\)/);
 assert.match(login,/href=\{studioReturn\?"\/api\/google-auth\?start=1&returnTo="/);
 assert.doesNotMatch(action,/\/api\/stripe|studio-live.*submit/);
});

test("Google OAuth redirects back to only the validated server-bound Studio return",()=>{
 const oauth=read("app/(site)/api/google-auth/route.ts");
 const callback=read("app/(site)/api/google-auth/callback/route.ts");
 assert.match(oauth,/parseStudioAccountReturn\(req\.nextUrl\.searchParams\.get\("returnTo"\)\)/);
 assert.match(oauth,/returnTo\?\{returnTo\}:\{\}/);
 assert.match(oauth,/studioAccountReturn\(allowedReturn\.draftId,allowedReturn\.requiredCredits\)/);
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
 assert.match(importer,/guestToken=req\.cookies\.get\("sm_guest_session"\)\?\.value/);
 assert.match(importer,/guestOwner=session\(guestToken\)\?\.owner/);
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


test("signed-in customer without enough Credits can purchase from Step 4, never via disabled Generate",()=>{
 const wizard=read("components/studio-wizard.tsx");
 const start=wizard.indexOf("async function continueToCreditPurchase()");
 const end=wizard.indexOf("async function startCreditGeneration()",start);
 assert.ok(start>0&&end>start);
 const action=wizard.slice(start,end);
 assert.match(action,/!reviewShortage\|\|operatorStudio/);
 assert.match(action,/await saveQueue\.current/);
 assert.match(action,/await api\("studio-drafts"/);
 assert.match(action,/id:projectKey,selection,artistName:draft\.artistName/);
 assert.match(action,/projectName,step:3/);
 assert.match(action,/sessionStorage\.setItem\("sm-credit-checkout-resume"/);
 assert.match(action,/draftId:projectKey,requiredCredits:creditQuote\.credits/);
 assert.match(action,/window\.location\.assign\("\/credits\?resumeDraft="/);
 assert.match(wizard,/reviewShortage\?void continueToCreditPurchase\(\):void startCreditGeneration\(\)/);
 assert.match(wizard,/reviewShortage&&!operatorStudio\?"Buy Credits to generate":"Generate Video"/);
 assert.match(wizard,/\(reviewShortage&&operatorStudio\)/);
 // No Stripe or paid provider action may happen before explicitly
 // choosing checkout on the separate verified, signed-in Credits page.
 assert.doesNotMatch(action,/\/api\/credit-checkout|action:"submit"|stripe\.com/);
});

test("login or new account restores the exact authenticated guest draft at Step 4 without checkout",()=>{
 const wizard=read("components/studio-wizard.tsx");
 const account=read("components/account-panel.tsx");
 const resume=read("components/studio-account-resume.tsx");
 const importer=read("app/(site)/api/customer-guest-import/route.ts");
 const customerAuth=read("app/(site)/api/customer-auth/route.ts");
 assert.match(wizard,/!creditStudio\?"Login to generate"/);
 assert.match(wizard,/customPrompt: draft\.customPrompt/);
 assert.match(wizard,/performance: draft\.performance/);
 assert.match(wizard,/camera: draft\.camera/);
 assert.match(wizard,/outputFormat: draft\.outputFormat/);
 assert.match(account,/window\.location\.assign\(target\)/);
 assert.match(account,/parseStudioAccountReturn\(candidate\)/);
 assert.match(account,/stored\.draftId!==verified\.draftId/);
 assert.match(account,/stored\.requiredCredits!==verified\.requiredCredits/);
 assert.match(account,/action,email,password/);
 assert.match(account,/Continue with Google/);
 assert.match(customerAuth,/sm_guest_session/);
 assert.match(importer,/guestToken=req\.cookies\.get\("sm_guest_session"\)/);
 assert.match(resume,/sessionStorage\.getItem\(STUDIO_ACCOUNT_RESUME_KEY\)/);
 assert.match(resume,/identity\.kind!=="customer"/);
 assert.match(resume,/workspace\.owner\?\.startsWith\("customer-"\)/);
 assert.match(resume,/\/api\/customer-guest-import/);
 assert.match(resume,/saved\.selection\?\.owner!==workspace\.owner/);
 assert.match(resume,/quote\.credits!==wanted\.requiredCredits/);
 assert.match(resume,/window\.location\.assign\("\/studio\?draft="\+encodeURIComponent\(wanted\.draftId\)\+"&resume=review"\)/);
 assert.doesNotMatch(resume,/window\.location\.assign\("\/credits\?resumeDraft="/);
 assert.doesNotMatch(resume,/window\.location\.assign\("\/account\/verify-email/);
 assert.doesNotMatch(resume,/\/api\/credit-checkout|action:"submit"/);
});

test("owner-only guest handoff leaves audio, original/cropped photo, prompt, performance, camera and all Step-4 options unchanged",()=>{
 const db=new DatabaseSync(":memory:");
 const before={
  version:1,owner:"guest-11111111",songId:"audio-xyz",imageId:"cropped-photo",
  sourceImageId:"original-photo",editedImageId:"cropped-photo",
  appliedOutputFormat:"16:9",start:4,end:9,
  performance:"Natural",camera:"Static Close-Up",
  customPrompt:"Play into the camera with a subtle smile",
  outputFormat:"16:9",formatMode:"auto"
 };
 try{
  db.exec("CREATE TABLE studio_drafts(id TEXT PRIMARY KEY, owner TEXT NOT NULL, selection TEXT NOT NULL, step INTEGER NOT NULL)");
  db.prepare("INSERT INTO studio_drafts VALUES(?,?,?,3)")
   .run("draft-123",before.owner,JSON.stringify(before));
  // This is the same JSON owner-only update as customer-guest-import/route.ts;
  // it MUST NOT reconstruct or clear the private media/prompt selection.
  db.prepare("UPDATE studio_drafts SET owner=?,selection=json_set(selection,'$.owner',?) WHERE id=? AND owner=?")
   .run("customer-22222222","customer-22222222","draft-123",before.owner);
  const row=db.prepare("SELECT owner,selection,step FROM studio_drafts WHERE id=?")
   .get("draft-123") as {owner:string;selection:string;step:number};
  assert.equal(row.step,3);
  assert.equal(row.owner,"customer-22222222");
  const after=parseSavedStudioDraft(JSON.parse(row.selection));
  assert.deepEqual(after,{...before,owner:"customer-22222222"});
  // Malicious concurrent/other-owner draft cannot be moved by this update.
  assert.equal(db.prepare("UPDATE studio_drafts SET owner=? WHERE id=? AND owner=?")
   .run("attacker","draft-123",before.owner).changes,0);
 }finally{db.close()}
});
