import {test} from "node:test";
import assert from "node:assert/strict";
import {planCmsPageCleanup,type CmsPageInventory} from "../cms/page-cleanup-policy.ts";
const page=(slug:string,overrides:Partial<CmsPageInventory>={}):CmsPageInventory=>({
 id:slug,slug,title:slug,status:"draft",hasPublishedVersion:false,versionsComplete:true,...overrides
});
test("CMS cleanup only chooses never-published drafts for deletion",()=>{
 const decisions=planCmsPageCleanup([
  page("about"),page("home",{status:"published"}),
  page("legal",{status:"draft",hasPublishedVersion:true}),
  page("privacy",{versionsComplete:false}),
  page("faq",{status:undefined}),
 ]);
 assert.deepEqual(decisions.map(d=>d.action),[
  "remove-unpublished","keep-online","keep-online","manual-review","manual-review"
 ]);
});
test("CMS cleanup refuses unknown slugs and duplicate records",()=>{
 assert.throws(()=>planCmsPageCleanup([page("anything-secret")]),/unknown or duplicate/);
 assert.throws(()=>planCmsPageCleanup([page("faq"),page("faq")]),/unknown or duplicate/);
 assert.throws(()=>planCmsPageCleanup([page("home",{title:"  "})]),/unknown or duplicate/);
});
test("all ten current routes can remain if they have a published version",()=>{
 const slugs=["home","pricing","faq","about","contact","help","privacy","terms","legal","rights"];
 assert.deepEqual(planCmsPageCleanup(slugs.map(slug=>page(slug,{hasPublishedVersion:true}))).map(p=>p.action),
  slugs.map(()=>"keep-online"));
});
