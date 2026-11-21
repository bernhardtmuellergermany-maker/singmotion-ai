import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

test("dashboard uses one Payload root and only real internal destinations",()=>{
 const config=read("cms/config.ts"),dashboard=read("components/cms/dashboard-view.tsx");
 const operations=read("components/cms/operations.tsx"),map=read("app/(payload)/admin/importMap.js");
 assert.match(config,/dashboard:\s*\{\s*Component:\s*"\/components\/cms\/dashboard-view\.tsx#CleanDashboardView"/);
 assert.match(dashboard,/initPageResult\.req\.user/);
 assert.match(map,/dashboard-view\.tsx#CleanDashboardView/);
 for(const href of ["/admin/customer-insights","/admin/support","/admin/marketing-actions",
  "/admin/promotions","/admin/showcase","/admin/collections/staff"])
  assert.ok(operations.includes('href:"'+href+'"'),href);
 assert.doesNotMatch(operations,/href:"\/support-admin"|href:"\/promo-admin"/);
 for(const unused of ["Seiten & Texte","Bilder & Medien","Navigation & Footer","Studio-Texte"])
  assert.ok(!operations.includes(unused),unused);
 assert.doesNotMatch(dashboard,/<DefaultTemplate/);
});
test("native sidebar is hidden; every custom view preserves staff role checks",()=>{
 const config=read("cms/config.ts"),css=read("app/(payload)/admin-theme.css");
 const layout=read("app/(payload)/layout.tsx"),back=read("components/cms/back-to-overview.tsx");
 assert.doesNotMatch(config,/beforeNavLinks:/);
 assert.match(css,/\.payload-admin \.nav/);
 assert.match(css,/display:none!important/);
 assert.match(layout,/<CmsBackToOverview/);
 assert.match(back,/pathname!=="\\/admin"/);
 assert.match(back,/\\/api\\/cms\\/staff\\/logout/);
 assert.doesNotMatch(back,/\\/api\\/unified-logout/);
 for(const path of ["support-view.tsx","promotions-view.tsx","advanced-view.tsx","showcase-view.tsx","customer-insights-view.tsx"]){
  const source=read("components/cms/"+path);
  assert.match(source,/hasRole\(initPageResult\.req\.user/);
  assert.match(source,/<Gutter>/);
 }
 for(const slug of ["pages","cms-assets","studio-settings","site-navigation","staff"])
  assert.match(config,new RegExp('slug: "'+slug+'"'));
});
test("support, coupons and campaigns are native CMS views",()=>{
 const config=read("cms/config.ts"),map=read("app/(payload)/admin/importMap.js");
 for(const [key,name] of [["/support","SupportCmsView"],["/promotions","PromotionsCmsView"],
  ["/marketing-actions","CampaignsCmsView"]]){
  assert.ok(config.includes('path: "'+key+'"'),key);
  assert.ok(map.includes("#"+name),name);
 }
});
