import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const gallery=readFileSync(new URL("../components/my-projects-gallery.tsx",import.meta.url),"utf8");

test("Super Admin project sync must never query the customer-only order endpoint",()=>{
 assert.match(gallery,/const session=await ensureSession\(\) as \{owner\?:string\}/);
 assert.match(gallery,/session\.owner\.startsWith\("customer-"\)/);
 assert.match(gallery,/isCustomer\s*\?fetch\("\/api\/customer-orders\?view=mine"/);
 assert.match(gallery,/:Promise\.resolve\(\[\] as CustomerOrder\[\]\)/);
});

test("account project requests still fail visibly when a real customer sync fails",()=>{
 assert.match(gallery,/if\(!r\.ok\)throw Error\("Customer videos unavailable/);
 assert.match(gallery,/d\.status==="rejected"\?"drafts"/);
 assert.match(gallery,/o\.status==="rejected"\?"customer orders"/);
 assert.match(gallery,/l\.status==="rejected"\?"generated videos"/);
 assert.match(gallery,/api<SavedDraft\[\]>\("studio-drafts",\{cache:"no-store"\}\)/);
 assert.match(gallery,/api<\{projects:StudioProject\[\]\}>\("studio-live",\{cache:"no-store"\}\)/);
});

test("mobile resume and manual sync request a fresh authenticated media session and gate trash reads",()=>{
 assert.match(gallery,/resetSession\(\);\s*const session=await ensureSession\(\)/);
 assert.match(gallery,/workspaceOwner\.current!==owner/);
 assert.match(gallery,/isCustomer\?fetch\("\/api\/customer-orders\?view=hidden"/);
 assert.match(gallery,/await refreshTrash\(isCustomer\)/);
 assert.match(gallery,/window\.addEventListener\("pageshow",onFocus\)/);
});
