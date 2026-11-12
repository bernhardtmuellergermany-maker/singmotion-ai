import test from "node:test";import assert from "node:assert/strict";import {readFileSync} from "node:fs";
const read=(p:string)=>readFileSync(new URL(`../${p}`,import.meta.url),"utf8");
test("account keeps centered credit and studio actions",()=>{
 const account=read("components/account-panel.tsx"),style=read("components/account-credit-summary.css");
 assert.match(account,/AccountCreditSummary/);
 assert.match(account,/href="\/credits" className="sm-account-action sm-account-action-buy"/);
 assert.match(account,/href="\/studio\?new=1" className="sm-account-action sm-account-action-create"/);
 assert.match(style,/\.sm-account-signed-in \.sm-account-settings-link/);
 assert.match(style,/max-width:none;min-height:49px;margin:0/);
 assert.doesNotMatch(account,/Testansicht/);
});
test("super-admin and customer use only verified balance, with failure state",()=>{
 const c=read("components/account-credit-summary.tsx");
 assert.match(c,/fetch\("\/api\/credit-balance"/);
 assert.match(c,/creditTone\(available\)/);
 assert.doesNotMatch(c,/testCredits|TESTVORSCHAU|Simuliertes Guthaben/);
 assert.match(c,/Balance currently unavailable/);
});
