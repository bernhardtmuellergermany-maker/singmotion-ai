import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const source=(file:string)=>readFileSync(new URL("../"+file,import.meta.url),"utf8");

test("account project titles take precedence over browser-local labels on every device",()=>{
 const gallery=source("components/my-projects-gallery.tsx");
 assert.match(gallery,/p\.kind==="admin"&&live\.find/);
 assert.match(gallery,/\?\.displayName/);
 assert.match(gallery,/api<\{projects:StudioProject\[\]\}>\("studio-live",\{cache:"no-store"\}\)/);
 assert.match(gallery,/api<SavedDraft\[\]>\("studio-drafts",\{cache:"no-store"\}\)/);
 assert.match(gallery,/setSyncNonce\(n=>n\+1\)/);
 assert.match(gallery,/Sync project names from account/);
 assert.match(gallery,/same account on desktop and mobile/);
});

test("mobile resume reloads the account-owned project title without losing local edits",()=>{
 const header=source("components/project-header-name.tsx");
 assert.match(header,/window\.addEventListener\("pageshow",onFocus\)/);
 assert.match(header,/document\.addEventListener\("visibilitychange",onVisibility\)/);
 assert.match(header,/window\.addEventListener\("focus",onFocus\)/);
 assert.match(header,/\|\|edit\|\|busy\)return/);
 assert.match(header,/saving\.current/);
 assert.match(header,/\{cache:"no-store"\}/);
 assert.match(header,/setName\(project\.projectName\|\|project\.artistName/);
});

test("mobile account name sync has a layout slot without obstructing sort",()=>{
 const css=source("components/my-projects-gallery.css");
 assert.match(css,/grid-template-columns:minmax\(140px,1fr\) auto auto auto/);
 assert.match(css,/grid-template-columns:minmax\(0,1fr\) auto auto!important/);
});
