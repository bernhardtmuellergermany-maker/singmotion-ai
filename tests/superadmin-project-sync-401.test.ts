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
 assert.match(gallery,/api<\{projects:StudioProject\[\]\}>\("studio-live\?gallery=1",\{cache:"no-store"\}\)/);
});

test("mobile resume and manual sync request a fresh authenticated media session and gate trash reads",()=>{
 assert.match(gallery,/resetSession\(\);\s*const session=await ensureSession\(\)/);
 assert.match(gallery,/workspaceOwner\.current!==owner/);
 assert.match(gallery,/isCustomer\?fetch\("\/api\/customer-orders\?view=hidden"/);
 assert.match(gallery,/await refreshTrash\(isCustomer\)/);
 assert.match(gallery,/window\.addEventListener\("pageshow",onFocus\)/);
});

test("Super Admin gallery reads are owner scoped and independent of paid Studio admission",()=>{
 const route=readFileSync(new URL("../app/(site)/api/studio-live/route.ts",import.meta.url),"utf8");
 const start=route.indexOf('if(req.method==="GET"&&query.get("gallery")==="1"');
 const end=route.indexOf('const mediaAuth=session',start);
 assert.ok(start>=0&&end>start);
 const branch=route.slice(start,end);
 assert.ok(branch.includes('every(k=>k==="gallery"||k==="trash")'));
 assert.ok(branch.includes('commerce.session(token)'));
 assert.ok(branch.includes('if(!customerId)'));
 assert.ok(branch.includes('hasRole(identity.user,["super-admin"])'));
 assert.ok(branch.includes('galleryOwner="cms-staff-"+id'));
 assert.ok(branch.includes('runtime.service.list(galleryOwner)'));
 assert.ok(branch.includes('runtime.service.listTrash(galleryOwner)'));
 assert.ok(!branch.includes('service.submit'));
 assert.ok(route.slice(end).includes('verifiedOwner!==owner'));
 assert.ok(route.slice(end).includes('studioStaff(user,req.method,req.headers,process.env)'));
});
