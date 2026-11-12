import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
 MIN_CREDIT_TOPUP,MAX_CREDIT_TOPUP,parseCreditTopup,proposedTopupCents
} from "../lib/commerce/credit-topup-quote.ts";
const read=(p:string)=>readFileSync(new URL(`../${p}`,import.meta.url),"utf8");

test("custom credit quantities are whole-number validated and priced in cents",()=>{
 assert.equal(MIN_CREDIT_TOPUP,500);
 assert.equal(MAX_CREDIT_TOPUP,100000);
 for(const invalid of ["","0","10","499","100001","1.5","1e3","-500","abc","Infinity"])assert.equal(parseCreditTopup(invalid),null,invalid);
 for(const [v,credits,cents] of [["500",500,500],["1000",1000,1000],["2357",2357,2357],["100000",100000,100000]] as const){
  assert.equal(parseCreditTopup(v),credits);assert.equal(proposedTopupCents(credits),cents);
 }
 assert.equal(proposedTopupCents(Number.NaN),null);
 assert.equal(proposedTopupCents(-1),null);
});

test("public pricing is prepaid-only and does not advertise a new Hobby subscription",()=>{
 const source=read("app/(site)/plans/page.tsx");
 assert.match(source,/CreditAmountPicker/);
 assert.match(source,/No new Hobby subscription/);
 assert.doesNotMatch(source,/€4\.99|€0\.20|Upgrade to Hobby/);
});

test("new Hobby checkout is blocked by an independent new-purchase gate",()=>{
 const source=read("app/(site)/api/hobby-checkout/route.ts");
 assert.match(source,/HOBBY_NEW_PURCHASES_ENABLED==="true"/);
});

test("super-admin preview is verified server side, distinct from customer credits",()=>{
 const api=read("app/(site)/api/credit-balance/route.ts");
 const identity=read("app/(site)/api/customer-auth/route.ts");
 const menu=read("components/header-account-menu.tsx");
 const dashboard=read("components/credits-dashboard.tsx");
 assert.match(api,/hasRole\(user, \["super-admin"\]\)/);
 assert.match(api,/staffPreview: true, purchaseEnabled: false/);
 assert.match(identity,/staffRole:hasRole\(user,\["super-admin"\]\)/);
 assert.match(menu,/identity==="super-admin"\?/);
 assert.match(menu,/Visual preview — not a real wallet/);
 assert.match(dashboard,/view === "admin-preview"/);
 assert.match(dashboard,/no real|keine echten Credits/);
 assert.doesNotMatch(dashboard,/fetch\(.*POST/);
});

test("account settings offer credit pages and retain legacy subscription management",()=>{
 const source=read("app/(site)/account/settings/page.tsx");
 assert.match(source,/Existing Hobby subscription \(legacy\)/);
 assert.match(source,/href="\/credits"/);
 assert.doesNotMatch(source,/Upgrade to Hobby|async function subscribe\(/);
});
