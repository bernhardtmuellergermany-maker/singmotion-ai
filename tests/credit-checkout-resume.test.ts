import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(p:string)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("Exact Step 4 draft is saved before credit shortage checkout",()=>{
 const wizard=read("components/studio-wizard.tsx");
 assert.doesNotMatch(wizard,/sessionStorage\.setItem\("sm-credit-checkout-resume"/);
 assert.match(wizard,/reviewShortage/);
 assert.match(wizard,/resumeDraft=\$\{encodeURIComponent\(projectKey\)\}/);
 assert.match(wizard,/setStep\(resumeReview && saved\.song\?\.kind === "audio"/);
});
test("Checkout return URL carries safe navigation only, not purchase authorization",()=>{
 const picker=read("components/credit-amount-picker.tsx");
 const checkout=read("app/(site)/api/credit-checkout/route.ts");
 assert.match(picker,/resumeDraft:draftId,requiredCredits:required/);
 assert.match(checkout,/body\.resumeDraft/);
 assert.match(checkout,/success_url:`\$\{origin\}\/credits\?checkout=success\$\{resume\}`/);
 assert.match(checkout,/cancel_url:`\$\{origin\}\/credits\?checkout=cancelled\$\{resume\}`/);
 assert.match(checkout,/resolveCreditWalletIdentity/);
});
test("After checkout credits and account menu refresh, with explicit return to Step 4",()=>{
 const credits=read("components/credits-dashboard.tsx");
 const header=read("components/header-account-menu.tsx");
 assert.match(credits,/Continue project · Step 4/);
 assert.match(credits,/window\.dispatchEvent\(new Event\("credit-balance-updated"\)\)/);
 assert.match(header,/addEventListener\("credit-balance-updated",refresh\)/);
 assert.doesNotMatch(credits,/window\.location\.replace\("\/studio\?draft="/);
 assert.doesNotMatch(credits,/readCreditResume|sessionStorage\.getItem\(/);
 assert.match(credits,/data\.purchases\.some\(p=>p\.id===purchaseId&&p\.status==="paid"\)/);
 assert.match(credits,/clean\.searchParams\.delete\("resumeDraft"\)/);
 assert.doesNotMatch(read("components/credit-amount-picker.tsx"),/sessionStorage\.getItem\(/);
 assert.match(read("app/(site)/api/credit-checkout/route.ts"),/resume\+="&resumePurchase="\+encodeURIComponent\(purchase\.id\)/);
});
