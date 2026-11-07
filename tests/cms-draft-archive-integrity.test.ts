import {test} from "node:test";
import assert from "node:assert/strict";
import {cmsArchiveDigest,verifyCmsArchiveReadback,hasChangedCmsVersions} from "../cms/draft-archive-integrity.ts";

test("CMS backup readback must match exact bytes and size",()=>{
 const original=Buffer.from(JSON.stringify({drafts:[{slug:"about",status:"draft"}],versions:[]}),"utf8");
 const copy=Buffer.from(original);
 assert.equal(verifyCmsArchiveReadback(original,copy),true);
 assert.match(cmsArchiveDigest(original),/^[a-f0-9]{64}$/);
 const edited=Buffer.from(original);
 edited[10]=edited[10]===97?98:97;
 assert.equal(verifyCmsArchiveReadback(original,edited),false);
 assert.equal(verifyCmsArchiveReadback(original,original.subarray(0,original.length-1)),false);
 assert.equal(verifyCmsArchiveReadback(original,Buffer.alloc(0)),false);
});
test("CMS publishing changes or incomplete fresh history prevent prune",()=>{
 const records=[{id:1,version:{_status:"draft",title:"Draft"}}];
 assert.equal(hasChangedCmsVersions(records,structuredClone(records),true),false);
 assert.equal(hasChangedCmsVersions(records,records,false),true);
 assert.equal(hasChangedCmsVersions(records,[...records,{id:2,version:{_status:"published"}}],true),true);
 assert.equal(hasChangedCmsVersions(records,[{id:1,version:{_status:"published",title:"Draft"}}],true),true);
});
