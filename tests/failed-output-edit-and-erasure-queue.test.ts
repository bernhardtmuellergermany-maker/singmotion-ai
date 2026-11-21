import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(p:string)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");

test("password-confirmed deletion request is accepted before financial and media readiness",()=>{
 const route=read("app/(site)/api/customer-account-erasure/route.ts");
 const settings=read("app/(site)/account/settings/page.tsx");
 const status=read("app/(site)/api/customer-erasure-status/route.ts");
 const runner=read("lib/commerce/customer-erasure-runner.ts");
 assert.match(route,/beginCustomerErasure\(store,id\)/);
 assert.match(route,/pending:true,state:started\.job\.state/);
 assert.doesNotMatch(route,/if\(!quote\.ready\)/);
 assert.doesNotMatch(route,/assertCustomerMediaErasureReady\(/);
 assert.match(route,/verifyCustomerPassword\(id,input\.password\)/);
 assert.match(route,/input\.confirmation!=="DELETE MY ACCOUNT"/);
 assert.doesNotMatch(settings,/Deletion is temporarily unavailable while payments or files are checked/);
 assert.match(settings,/Permanently delete my account/);
 assert.doesNotMatch(status,/CUSTOMER_AUTOMATED_ERASURE_ENABLED/);
 assert.match(runner,/quoteCustomerErasureRefund\(db,row\.id\)/);
 assert.match(runner,/if\(!quote\.ready\)/);
 assert.match(runner,/stageDeletionRefundIntents\(db,row\.id,fresh\.lines\)/);
});

test("terminal failure exposes a new owned editable draft, without replaying a paid request",()=>{
 const output=read("components/studio-live.tsx");
 const paid=read("components/customer-paid-output.tsx");
 const status=read("components/generation-status-view.tsx");
 const wizard=read("components/studio-wizard.tsx");
 const api=read("app/(site)/api/studio-live/route.ts");
 assert.match(output,/failed&&<button[^\n]*createAnotherVersion/);
 assert.match(output,/const draftId=crypto\.randomUUID\(\)/);
 assert.match(output,/id:draftId,selection:project\.selection/);
 assert.match(output,/step:0/);
 assert.match(output,/router\.push\("\/studio\?draft="\+encodeURIComponent\(draftId\)\)/);
 assert.match(paid,/editHref=\{\(fulfillment==="failed"\|\|order\?\.status==="refunded"\)/);
 assert.match(status,/canEditRejected/);
 assert.match(status,/Edit audio, photo & prompt/);
 assert.match(wizard,/if\(copy && !requested\)/);
 assert.match(wizard,/setDraft\(restored\)/);
 assert.match(api,/req\.nextUrl\.searchParams\.get\("copy"\) === "1"/);
 assert.match(api,/asset\(selection\.songId,owner\)/);
});
