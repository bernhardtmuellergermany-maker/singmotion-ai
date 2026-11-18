import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

test("CMS dashboard replaces built-in collection grid instead of stacking duplicate cards",()=>{
 const config=read("cms/config.ts");
 const dashboard=read("components/cms/dashboard-view.tsx");
 const operations=read("components/cms/operations.tsx");
 const map=read("app/(payload)/admin/importMap.js");
 assert.match(config,/dashboard:\s*\{\s*Component:\s*"\/components\/cms\/dashboard-view\.tsx#CleanDashboardView"/);
 assert.doesNotMatch(config,/beforeDashboard:/);
 assert.match(dashboard,/DefaultTemplate/);
 assert.match(dashboard,/initPageResult\.req\.user/);
 assert.match(map,/customer-insights-view\.tsx#CustomerInsightsView/);
 assert.match(map,/dashboard-view\.tsx#CleanDashboardView/);
 assert.match(operations,/\/admin\/customer-insights/);
 assert.match(operations,/\/support-admin/);
 assert.match(operations,/\/admin\/collections\/pages/);
 assert.match(operations,/\/admin\/showcase/);
 for(const retired of [
  "Completed demo jobs","Pending demo jobs","Active demo workspaces",
  "Workspace activity","Customer operations","Private by design",
  "E-Mail-Vorlagen","Demo only · no paid output"
 ])assert.equal(operations.includes(retired),false,retired);
 assert.doesNotMatch(operations,/readCommerceDashboard|demoMetrics|<PrivateLedger|<ShowcaseManager/);
});

test("Only actual editable destinations are in the basic dashboard",()=>{
 const config=read("cms/config.ts");
 const operations=read("components/cms/operations.tsx");
 const nav=read("components/cms/dashboard-nav.tsx");
 const advanced=read("components/cms/advanced-view.tsx");
 const showcase=read("components/cms/showcase-view.tsx");
 assert.match(config,/slug:\s*"notification-templates"[\s\S]*?hidden:\s*true/);
 assert.match(config,/slug:\s*"audit-events"[\s\S]*?hidden:\s*true/);
 assert.match(config,/slug:\s*"studio-settings"[\s\S]*?group:\s*"Website & Inhalte"/);
 assert.match(operations,/hasRole\(user,\["super-admin"\]\)/);
 assert.match(operations,/hasRole\(user,\["super-admin","editor"\]\)/);
 assert.match(operations,/hasRole\(user,\["super-admin","support"\]\)/);
 assert.match(nav,/href="\/admin"/);
 assert.match(nav,/hasRole\(user,\["super-admin"\]\)/);
 assert.match(advanced,/hasRole\(initPageResult\.req\.user,\["super-admin"\]\)/);
 assert.match(showcase,/hasRole\(initPageResult\.req\.user,\["super-admin"\]\)/);
 assert.match(advanced,/collection:"audit-events"/);
 assert.match(advanced,/PrivateLedger/);
 assert.match(advanced,/CmsPageCleanupInventory/);
 assert.match(showcase,/ShowcaseManager/);
});

test("Mobile CSS uses dense links, single column and dark native menu",()=>{
 const css=read("app/(payload)/cms-control-center.css");
 const theme=read("app/(payload)/admin-theme.css");
 assert.match(css,/\.sm-cms-quick-link\{[\s\S]*?min-height:88px/);
 assert.match(css,/@media\(max-width:640px\)/);
 assert.match(css,/\.sm-cms-quick-link\{min-height:70px/);
 assert.match(css,/\.sm-cms-quick-grid\{grid-template-columns:1fr/);
 assert.match(theme,/@media\(max-width:820px\)/);
 assert.match(theme,/\.nav\{background:#141020!important/);
 assert.match(theme,/\.nav a,.nav button\{/);
});
