import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {studioAccountReturn,studioAccountLoginHref,parseStudioAccountReturn} from "../lib/studio-account-handoff.ts";
import {privateSourceKey,validCloudRecord} from "../lib/cloud-media.ts";
const read=(p:string)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");

test("guest Studio return is same-origin and bounded to an exact draft, never a redirect",()=>{
 const draft="123e4567-e89b-42d3-a456-426614174000";
 const path=studioAccountReturn(draft,125);
 assert.equal(path,"/studio/continue?draft="+draft+"&requiredCredits=125");
 assert.equal(studioAccountLoginHref(draft,125),"/login?returnTo="+encodeURIComponent(path));
 assert.equal(studioAccountLoginHref("../bad",125),null);
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

test("guest Step 4 saves media and prompt then opens standard login without a registration popup",()=>{
 const wizard=read("components/studio-wizard.tsx");
 const account=read("components/account-panel.tsx");
 assert.match(wizard,/Login to generate/);
 assert.match(wizard,/!creditStudio\?void openGuestAccount\(\):reviewShortage\?void continueToCreditPurchase\(\):void startCreditGeneration\(\)/);
 assert.match(wizard,/await saveQueue\.current/);
 assert.match(wizard,/await api\("studio-drafts"/);
 assert.match(wizard,/projectName,step:3/);
 assert.match(wizard,/studioAccountLoginHref\(projectKey,creditQuote\.credits\)/);
 assert.match(wizard,/sessionStorage\.setItem\(STUDIO_ACCOUNT_RESUME_KEY/);
 assert.match(wizard,/window\.location\.assign\(loginHref\)/);
 assert.doesNotMatch(wizard,/<StudioAccountGate/);
 assert.match(account,/useState<"login"\|"register">\("login"\)/);
 assert.match(account,/mode==="login"\?"Sign in"/);
 assert.match(account,/mode==="login"\?"Create account"/);
 assert.match(account,/parseStudioAccountReturn\(search\.get\("returnTo"\)\)/);
 assert.match(account,/if\(loginReturn\)\{window\.location\.assign\(loginReturn\);return;\}/);
 assert.match(account,/d\.kind==="customer"/);
 assert.match(account,/loginReturn\?"\/api\/google-auth\?start=1&returnTo="/);
 const guestOnly=wizard.slice(wizard.indexOf("async function openGuestAccount()"),
  wizard.indexOf("async function continueToCreditPurchase()"));
 assert.doesNotMatch(guestOnly,/api\/stripe|action:"submit"|\/api\/credit-checkout/);
});

test("Google OAuth redirects only to validated Studio or exact Credits returns",()=>{
 const oauth=read("app/(site)/api/google-auth/route.ts");
 const callback=read("app/(site)/api/google-auth/callback/route.ts");
 assert.match(oauth,/parseAccountReturn\(req\.nextUrl\.searchParams\.get\("returnTo"\)\)/);
 assert.match(oauth,/returnTo\?\{returnTo\}:\{\}/);
 assert.match(oauth,/studioContinuation=parseStudioAccountReturn\(returnTo\|\|null\)/);
 assert.match(callback,/savedReturn=parseAccountReturn\(saved\.returnTo\|\|null\)/);
 assert.match(callback,/destination\.searchParams\.set\("auth_changed","1"\)/);
 assert.match(callback,/sm_guest_session/);
 assert.match(oauth,/session\(mediaToken\)\?\.owner/);
 assert.match(oauth,/studioContinuation&&guestToken\?\{guestToken\}/);
 assert.match(callback,/verifiedGuest/);
 assert.match(callback,/saved\.guestToken/);
 assert.match(callback,/guest=verifiedGuest/);
 assert.match(callback,/\/login\?returnTo=/);
});

test("Account handoff never grants cross-account ownership or payments based on URL alone",()=>{
 const resume=read("components/studio-account-resume.tsx");
 const importer=read("app/(site)/api/customer-guest-import/route.ts");
 assert.match(resume,/sessionStorage\.getItem\(STUDIO_ACCOUNT_RESUME_KEY\)/);
 assert.match(resume,/identity\.kind!=="customer"&&identity\.kind!=="staff"/);
 assert.match(resume,/workspace\.owner\?\.startsWith\(expectedOwnerPrefix\)/);
 assert.match(resume,/\/api\/customer-guest-import/);
 assert.match(resume,/saved\.selection\?\.owner!==workspace\.owner/);
 assert.match(resume,/quote\.credits!==wanted\.requiredCredits/);
 assert.match(resume,/mode:"execute",confirmation:"IMPORT MY GUEST PROJECTS",draftId/);
 assert.match(importer,/customerIdentityOrigin\(process\.env\)/);
 assert.match(importer,/studioStaff\(identity\.user,req\.method,req\.headers,process\.env\)/);
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

test("login, registration and Google OAuth all return the same server-verified draft to Step 4 without checkout",()=>{
 const wizard=read("components/studio-wizard.tsx");
 const account=read("components/account-panel.tsx");
 const resume=read("components/studio-account-resume.tsx");
 const importer=read("app/(site)/api/customer-guest-import/route.ts");
 assert.match(wizard,/!creditStudio\?"Login to generate"/);
 assert.match(account,/useState<"login"\|"register">\("login"\)/);
 assert.match(account,/mode==="register"/);
 assert.match(account,/studioReturn/);
 assert.match(resume,/sessionStorage\.getItem\(STUDIO_ACCOUNT_RESUME_KEY\)/);
 assert.match(resume,/identity\.kind!=="customer"&&identity\.kind!=="staff"/);
 assert.match(resume,/\/api\/customer-guest-import/);
 assert.match(resume,/saved\.selection\?\.owner!==workspace\.owner/);
 assert.match(resume,/quote\.credits!==wanted\.requiredCredits/);
 assert.match(resume,/window\.location\.assign\("\/studio\?draft="\+encodeURIComponent\(wanted\.draftId\)\+"&resume=review"\)/);
 assert.doesNotMatch(resume,/window\.location\.assign\("\/credits\?resumeDraft="/);
 assert.doesNotMatch(resume,/window\.location\.assign\("\/account\/verify-email\?/);
 assert.match(importer,/guestToken=req\.cookies\.get\("sm_guest_session"\)\?\.value/);
 assert.match(wizard,/setDraft\(\{/);
 assert.match(wizard,/song: saved\.song/);
 assert.match(wizard,/saved\.selection\.owner!==sessionOwner/);
 assert.match(wizard,/timelinePrompt\(parts\)===saved\.selection\.customPrompt/);
 assert.doesNotMatch(resume,/action:"submit"|\/api\/credit-checkout/);
});

test("CMS login remains independent; staff guest transfers require operator authorization",()=>{
 const cms=read("app/(payload)/api/cms/[...slug]/route.ts");
 const importer=read("app/(site)/api/customer-guest-import/route.ts");
 assert.doesNotMatch(cms,/cookies\.delete\("sm_customer"\)/);
 assert.doesNotMatch(cms,/store\.logout\(token\)/);
 assert.match(importer,/studioStaff\(identity\.user,req\.method,req\.headers,process\.env\)/);
 assert.match(importer,/guestToken=req\.cookies\.get\("sm_guest_session"\)\?\.value/);
});

test("staging website offers explicit verified CMS sign-in without mixing customer credentials",()=>{
 const login=read("app/(site)/login/page.tsx");
 const staff=read("components/staging-staff-signin.tsx");
 const status=read("app/(site)/api/staff-website-session/route.ts");
 const client=read("lib/client-auth-status.ts");
 const account=read("components/account-panel.tsx");
 const header=read("components/header-account-menu.tsx");
 assert.match(login,/RAILWAY_ENVIRONMENT_ID==="dfaeabed-03df-43ed-aa71-50f343a75041"/);
 assert.match(login,/Super Admin\? Mit dem CMS-Konto anmelden/);
 assert.match(staff,/fetch\("\/api\/cms\/staff\/login"/);
 assert.match(staff,/data\.staffRole!=="super-admin"/);
 assert.match(staff,/window\.location\.assign\("\/studio\?new=1"\)/);
 assert.match(status,/hasRole\(user,\["super-admin"\]\)/);
 assert.match(status,/await cms\.auth\(\{headers:req\.headers\}\)/);
 assert.match(client,/if\(customer\?\.authenticated\)return customer/);
 assert.match(client,/fetch\("\/api\/staff-website-session"/);
 assert.match(account,/staff\?"\/api\/cms\/staff\/logout":"\/api\/unified-logout"/);
 assert.match(header,/async function logoutStaff\(\)/);
 assert.doesNotMatch(account,/\/api\/cms\/staff\/login/);
});
