import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(path)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
test("checkout demands two separate unchecked acknowledgements",()=>{
 const ui=read("components/customer-video-checkout.tsx");
 assert.match(ui,/useState\(false\)/);
 assert.match(ui,/checked=\{immediateStart\}/);
 assert.match(ui,/checked=\{acknowledged\}/);
 assert.match(ui,/disabled=\{busy\|\|!immediateStart\|\|!acknowledged\}/);
 assert.match(ui,/acknowledgedWithdrawalConsequences:acknowledged/);
});
test("checkout rejects missing explicit consent and persists evidence before payment",()=>{
 const route=read("app/(site)/api/stripe-checkout/route.ts");
 assert.match(route,/input\.immediateStart !== true \|\| input\.acknowledgedWithdrawalConsequences !== true/);
 assert.ok(route.indexOf("recordEarlyPerformanceConsent")<route.indexOf("https://api.stripe.com/v1/checkout/sessions"));
 const store=read("lib/commerce/store.ts");
 assert.match(store,/CREATE TABLE IF NOT EXISTS customer_early_performance_consents/);
 assert.match(store,/review_digest TEXT NOT NULL/);
 assert.match(store,/acknowledged_at INTEGER NOT NULL/);
});
test("real BytePlus dispatch is blocked without stored consent",()=>{
 const dispatch=read("lib/commerce/customer-byteplus-dispatch.ts");
 assert.ok(dispatch.indexOf("hasEarlyPerformanceConsent(orderId)")<dispatch.indexOf("submitReviewedPaidVideo(store,orderId"));
});
