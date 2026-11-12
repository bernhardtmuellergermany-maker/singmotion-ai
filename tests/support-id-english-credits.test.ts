import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(file:string)=>readFileSync(new URL(`../${file}`,import.meta.url),"utf8");

test("project Support ID copies the FULL reference in one click",()=>{
 const gallery=read("components/my-projects-gallery.tsx");
 const css=read("components/my-projects-gallery.css");
 const browser=read("tests/customer-output.browser.ts");
 assert.match(gallery,/navigator\.clipboard\.writeText\(id\)/);
 assert.match(gallery,/onClick=\{\(\)=>void copySupportId\(item\.supportId!\)\}/);
 assert.match(gallery,/item\.supportId\.slice\(0,8\)/);
 assert.match(gallery,/Copy full support ID for/);
 assert.match(gallery,/Copied!/);
 assert.match(gallery,/Copy failed/);
 assert.match(css,/\.sm-projects-copy-support:focus-visible/);
 assert.match(browser,/navigator\.clipboard\.readText\(\)/);
 assert.match(browser,/the complete order reference on the clipboard/);
});

test("all newly added credit and account credit views are in English",()=>{
 const pages=[
  "components/credits-dashboard.tsx",
  "components/credit-amount-picker.tsx",
  "components/header-account-menu.tsx",
  "components/account-credit-summary.tsx",
  "app/(site)/credits/page.tsx",
  "app/(site)/account/settings/page.tsx"
 ];
 const forbidden=/Guthaben|Nutzung|Aufträge|Testansicht|Bitte anmelden|Credits kaufen|Video erstellen|Kreditbuchungen|Stripe-Testkauf|de-DE|Reserviert|Zurückgebucht/;
 for(const file of pages)assert.doesNotMatch(read(file),forbidden,file);
 assert.match(read("components/credits-dashboard.tsx"),/Usage & Orders/);
 assert.match(read("components/credit-amount-picker.tsx"),/Test purchase with Stripe/);
 assert.match(read("components/account-credit-summary.tsx"),/Current credits/);
 assert.match(read("components/header-account-menu.tsx"),/Buy Credits & Usage/);
});

test("customers and super-admins can access their OWN real test wallet via the same UI",()=>{
 const header=read("components/header-account-menu.tsx");
 const panel=read("components/account-panel.tsx");
 const auth=read("lib/commerce/credit-wallet-auth.ts");
 const checkout=read("app/(site)/api/credit-checkout/route.ts");
 assert.match(header,/identity==="customer"\|\|identity==="super-admin"/);
 assert.match(auth,/subject:"customer:"\+id/);
 assert.match(auth,/subject:"super-admin:"\+userId/);
 assert.match(auth,/hasRole\(user,\["super-admin"\]\)/);
 assert.match(panel,/\/api\/customer-auth/);
 assert.match(panel,/\/api\/cms\/staff\/login/);
 assert.match(checkout,/resolveCreditWalletIdentity\(req,store\)/);
 assert.match(checkout,/identity\.customerId && !store\.emailVerified/);
 assert.match(checkout,/stripeCreditTopupsTestEnabled\(process\.env\)/);
 assert.doesNotMatch(header,/TEST ONLY|previewCredits/);
});
