import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=(file:string)=>readFileSync(new URL("../"+file,import.meta.url),"utf8");

test("Stripe return and manual resume explicitly request the Studio review step",()=>{
 const credits=read("components/credits-dashboard.tsx");
 assert.match(credits,/window\.location\.replace\("\/studio\?draft="\+encodeURIComponent\(pending\.draftId\)\+"\&resume=review"\)/);
 assert.match(credits,/href=\{`\/studio\?draft=\$\{encodeURIComponent\(resume\.draftId\)\}\&resume=review`\}/);
 const status=read("components/super-admin-generation.tsx");
 assert.match(status,/"\&resume=review"/);
});

test("resume restores Step 4 for authorized complete drafts, without relying on stale autosaved step",()=>{
 const studio=read("components/studio-wizard.tsx");
 assert.match(studio,/const resumeReview = params\.get\("resume"\) === "review"/);
 assert.match(studio,/resumeReview && saved\.song\?\.kind === "audio" && saved\.image\?\.kind === "image"/);
 assert.match(studio,/\? 3 : Math\.max\(0, Math\.min\(3, saved\.step\)\)/);
 assert.match(studio,/studio-drafts\/\$\{encodeURIComponent\(requested\)\}/);
});
