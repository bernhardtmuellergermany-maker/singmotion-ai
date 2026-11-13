import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const gallery=readFileSync(new URL("../components/my-projects-gallery.tsx",import.meta.url),"utf8");
const apiRoute=readFileSync(new URL("../app/(site)/api/[...path]/route.ts",import.meta.url),"utf8");

test("gallery obtains the canonical names from authenticated no-cache server requests",()=>{
 assert.match(gallery,/api<SavedDraft\[\]>\("studio-drafts",\{cache:"no-store"\}\)/);
 assert.match(gallery,/api<\{projects:StudioProject\[\]\}>\("studio-live",\{cache:"no-store"\}\)/);
 assert.match(gallery,/credentials:"same-origin",cache:"no-store"/);
 assert.match(gallery,/document\.addEventListener\("visibilitychange",onVisibility\)/);
 assert.match(gallery,/window\.addEventListener\("focus",onFocus\)/);
 assert.match(gallery,/window\.addEventListener\("pageshow",onFocus\)/);
});

test("old browser-only names cannot override server-owned project titles",()=>{
 assert.match(gallery,/\|\|p\.name\|\|labels\[p\.id\]\?\.trim\(\)/);
 assert.doesNotMatch(gallery,/\|\|labels\[p\.id\]\?\.trim\(\)\|\|p\.name/);
 assert.match(gallery,/action:"rename",id,name:next/);
 assert.match(gallery,/projectName:next/);
 assert.match(apiRoute,/WHERE id=\? AND owner=\? AND deleted_at IS NULL/);
});
