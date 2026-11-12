import test from "node:test";import assert from "node:assert/strict";import {readFileSync} from "node:fs";
import {creditTone} from "../lib/commerce/credit-display.ts";
const read=(p:string)=>readFileSync(new URL(`../${p}`,import.meta.url),"utf8");
test("real account colors",()=>{assert.equal(creditTone(null),"unknown");assert.equal(creditTone(0),"critical");assert.equal(creditTone(249),"critical");assert.equal(creditTone(250),"low");assert.equal(creditTone(999),"low");assert.equal(creditTone(1000),"healthy");});
test("authenticated, account-scoped, read-only balance",()=>{
 const api=read("app/(site)/api/credit-balance/route.ts"),auth=read("lib/commerce/credit-wallet-auth.ts");
 assert.match(api,/resolveCreditWalletIdentity\(req,store\)/);assert.match(api,/WHERE account_id=\?/);
 assert.match(api,/private, no-store/);assert.doesNotMatch(api,/staffPreview|testCredits|export async function POST/);
 assert.match(auth,/hasRole\(user,\["super-admin"\]\)/);
 assert.match(auth,/subject:"super-admin:"\+userId/);
});
test("super-admin and customer share the same wallet menu; usage lives under credits",()=>{
 const menu=read("components/header-account-menu.tsx"),dashboard=read("components/credits-dashboard.tsx");
 assert.match(menu,/identity==="customer"\|\|identity==="super-admin"/);
 assert.match(menu,/fetch\("\/api\/credit-balance"/);assert.match(menu,/href="\/credits"/);
 assert.doesNotMatch(menu,/href="\/usage"|TEST ONLY|previewCredits|Credit test view/);
 assert.match(dashboard,/id="usage"/);assert.match(dashboard,/legacyOrders/);assert.match(dashboard,/Equivalent only/);
 assert.doesNotMatch(dashboard,/admin-preview|testCredits|Simuliertes/);
});
test("public pricing info and staging-only Stripe credit Checkout",()=>{
 const plans=read("app/(site)/plans/page.tsx"),picker=read("components/credit-amount-picker.tsx");
 assert.match(plans,/CreditAmountPicker/);assert.match(plans,/25 Credits/);
 assert.match(picker,/purchaseEnabled/);assert.match(picker,/api\/credit-checkout/);
 assert.match(picker,/Stripe Test Mode/);assert.doesNotMatch(picker,/api\/stripe-checkout/);
});

test("prepared operator project with insufficient wallet credits shows actionable shortage, never progress",()=>{
 const view=read("components/generation-status-view.tsx");
 const status=read("components/super-admin-generation.tsx");
 const workflow=read("lib/live/studio.ts");
 assert.match(workflow,/INSUFFICIENT_CREDITS/);
 assert.match(status,/fetch\("\/api\/credit-balance"/);
 assert.match(status,/availableCredits<project\.creditCharge\.credits/);
 assert.match(status,/if\(shortage\)progress="credits-needed"/);
 assert.match(view,/Not enough Credits/);
 assert.match(view,/No Credits were charged/);
 assert.match(view,/href="\/credits"/);
 assert.match(view,/progress!=="credits-needed"/);
 assert.match(status,/project\?\.state==="prepared"&&!shortage/);
});
