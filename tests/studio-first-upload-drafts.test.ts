import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {hasFirstStudioUpload,parseSavedStudioDraft} from "../lib/studio-draft.ts";

const read=(file:string)=>readFileSync(new URL(`../${file}`,import.meta.url),"utf8");

test("empty Studio visits and text-only edits do not qualify as saved projects",()=>{
 const empty=parseSavedStudioDraft({
  version:1,owner:"owner",songId:"",imageId:"",start:0,end:5,
  performance:"Natural",camera:"Static Close-Up",customPrompt:"",
  outputFormat:"9:16",formatMode:"auto"
 });
 assert.equal(hasFirstStudioUpload(empty),false);
 const textOnly={...empty,customPrompt:"Move gently",performance:"Custom"};
 assert.equal(hasFirstStudioUpload(textOnly),false);
 assert.equal(hasFirstStudioUpload({...empty,songId:"uploaded-audio"}),true);
 assert.equal(hasFirstStudioUpload({...empty,imageId:"uploaded-photo"}),true);
 assert.equal(hasFirstStudioUpload({...empty,songId:"uploaded-audio",imageId:"uploaded-photo"}),true);
});

test("wizard autosave waits for a confirmed media id instead of opening the page",()=>{
 const wizard=read("components/studio-wizard.tsx");
 assert.match(wizard,/!hasFirstStudioUpload\(\{songId:draft\.song\?\.id\|\|"",imageId:draft\.imageId\}\)/);
 assert.match(wizard,/First successful upload is saved immediately/);
 assert.match(wizard,/await uploadWithProgress/);
 assert.doesNotMatch(wizard,/Register a new empty draft immediately/);
});

test("server forbids blank POST drafts and hides previously saved blanks without deleting them",()=>{
 const api=read("app/(site)/api/[...path]/route.ts");
 assert.match(api,/if \(!hasFirstStudioUpload\(selected\)\)/);
 assert.match(api,/Upload audio or a photo before saving a draft/);
 assert.match(api,/\.filter\(draft => hasFirstStudioUpload\(draft\.selection\)\)/);
 assert.match(api,/selected\.songId && asset\(selected\.songId, owner\)\.kind/);
 assert.match(api,/selected\.imageId && asset\(selected\.imageId, owner\)\.kind/);
});
