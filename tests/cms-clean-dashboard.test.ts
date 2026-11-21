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
  "/admin/promotions","/admin/showcase"])
  assert.ok(operations.includes('href:"'+href+'"'),href);
 assert.doesNotMatch(operations,/href:"\/support-admin"|href:"\/promo-admin"/);
 assert.doesNotMatch(operations,/Team & Rechte|href:"\/admin\/collections\/staff"/);
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
 assert.ok(back.includes('pathname!=="/admin"'));
 assert.ok(back.includes('/api/cms/staff/logout'));
 assert.ok(!back.includes('/api/unified-logout'));
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


test("SingMotion CMS uses one dark page design and hides the empty mobile menu",()=>{
 const css=read("app/(payload)/cms-unified-dark.css");
 const layout=read("app/(payload)/layout.tsx");
 const operations=read("components/cms/operations.tsx");
 const promotion=read("components/promotion-admin.tsx");
 const showcase=read("components/cms/showcase-view.tsx");
 const advanced=read("components/cms/advanced-view.tsx");
 assert.ok(layout.includes('import "./cms-unified-dark.css"'));
 assert.match(layout,/htmlProps=\{\{className:"sm-cms-root"\}\}/);
 assert.match(css,/html\.sm-cms-root\[data-theme\]/);
 assert.match(css,/\.template-default--nav-hydrated\.template-default--nav-open/);
 assert.match(css,/grid-template-columns:minmax\(0,1fr\)!important/);
 assert.match(css,/\.template-default__nav-toggler-wrapper/);
 assert.match(css,/\.app-header/);
 assert.doesNotMatch(css,/:has\(\.payload-admin\)/);
 assert.match(css,/html\.sm-cms-root body/);
 assert.match(css,/background:#191526!important/);
 assert.match(css,/html\.sm-cms-root \.nav-toggler/);
 assert.match(css,/button\[aria-label="Toggle navigation"\]/);
 for(const className of ["sm-cms-clean-hero","sm-cms-page-hero","sm-insights-hero","sm-marketing-heading","sm-support-heading"])
  assert.ok(css.includes("."+className),className);
 assert.doesNotMatch(operations,/Team & Rechte|\/admin\/collections\/staff/);
 assert.match(promotion,/className="sm-cms-page-hero"/);
 assert.match(showcase,/className="sm-cms-page-hero"/);
 assert.match(advanced,/className="sm-cms-page-hero"/);
});


test("CMS overview uses one lighter panel with breathing room and a legible native login",()=>{
 const css=read("app/(payload)/cms-unified-dark.css");
 const ops=read("components/cms/operations.tsx");
 assert.match(css,/html\.sm-cms-root \.template-default__wrap\{[\s\S]*?padding:clamp\(28px,3\.2vw,44px\)/);
 assert.match(css,/padding:24px 12px 28px!important/);
 assert.match(css,/html\.sm-cms-root \.sm-cms-clean\{[\s\S]*?background:var\(--sm-surface\)!important;[\s\S]*?border-radius:22px/);
 assert.match(css,/html\.sm-cms-root \.sm-cms-clean-hero\{[\s\S]*?background:transparent;[\s\S]*?border-bottom:/);
 const main=ops.indexOf('<main className="sm-cms-clean"');
 const close=ops.indexOf('</main>',main);
 for(const selector of ['<header className="sm-cms-clean-hero"','<Links items={customers}/>','<Links items={management}/>','<details className="sm-cms-clean-advanced"']){
  const position=ops.indexOf(selector);
  assert.ok(position>main&&position<close,selector+" must stay in the shared overview container");
 }
 assert.match(css,/--theme-elevation-1000:#ffffff!important/);
 assert.match(css,/\.template-minimal \.graphic-logo path\{fill:#f4ebff!important\}/);
 assert.match(css,/html\.sm-cms-root \.login__form\{[\s\S]*?background:#30263f!important/);
 assert.match(css,/--bg-color:#cbb1f6/);
 assert.match(css,/--color:#21172f/);
 assert.match(css,/\.template-minimal input\{[\s\S]*?background:#3b304e!important/);
});
