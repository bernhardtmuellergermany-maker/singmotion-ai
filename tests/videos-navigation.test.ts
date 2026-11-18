import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=(file:string)=>readFileSync(new URL("../"+file,import.meta.url),"utf8");

test("video navigation has one public-facing name and canonical route",()=>{
 const menu=read("components/global-menu.tsx");
 const gallery=read("components/my-projects-gallery.tsx");
 const page=read("app/(site)/videos/page.tsx");
 assert.match(menu,/href: "\/videos", label: "Videos"/);
 assert.match(gallery,/<h1>Videos<\/h1>/);
 assert.match(page,/title:"Videos \| SingMotion AI"/);
 assert.match(page,/robots:\{index:false,follow:false\}/);
 assert.doesNotMatch(menu,/My Projects|href: "\/projects"/);
 assert.doesNotMatch(gallery,/My Projects|\/projects\/live_/);
});

test("historical overview and video-detail links permanently redirect",()=>{
 assert.match(read("app/(site)/projects/page.tsx"),/permanentRedirect\("\/videos"\)/);
 assert.match(read("app/(site)/projects/[id]/page.tsx"),/permanentRedirect\("\/videos\/"\+encodeURIComponent\(id\)\)/);
 const video=read("app/(site)/videos/[id]/page.tsx");
 assert.match(video,/<Shell hideWorkspaceNav projectId=\{id\}>/);
 assert.match(video,/<Project id=\{id\} \/>/);
});

test("studio, home, account and email links point to canonical Videos",()=>{
 for(const file of [
  "components/carousel-experience.tsx",
  "components/customer-paid-orders.tsx",
  "components/global-menu.tsx",
  "components/home-collection.tsx",
  "components/my-projects-gallery.tsx",
  "components/projects.tsx",
  "components/studio-live.tsx",
  "components/studio-wizard.tsx",
  "components/studio.tsx",
  "components/generation-dialog.tsx",
  "components/output-project-search.tsx",
  "lib/commerce/notifications.ts",
  "lib/commerce/video-ready-notifications.ts",
 ]){
  const source=read(file);
  assert.doesNotMatch(source,/\/projects(?:\/|["'`])/,
    file+" must not generate new legacy project URLs");
 }
 assert.match(read("lib/commerce/notifications.ts"),/href:"\/videos\/live_"/);
 assert.match(read("lib/commerce/video-ready-notifications.ts"),/origin\+"\/videos\/live_"/);
});

test("notification link validation preserves safety while canonicalizing legacy links",()=>{
 const source=read("components/notification-center.tsx");
 assert.match(source,/\(\?:videos\|projects\)/);
 assert.match(source,/item\.href\.replace\(/);
 assert.match(source,/sm-notice-video-link/);
});

test("guest import is hidden in Account options without altering account security actions",()=>{
 const account=read("components/account-panel.tsx");
 for(const invisible of [
  "Check guest projects for import","Import my guest projects",
  "Guest workspace:","/api/customer-guest-import",
 ])assert.equal(account.includes(invisible),false,invisible);
 for(const retained of [
  "More account options","Change password","Sign out on all devices",
 ])assert.ok(account.includes(retained),retained);
 // Only the account UI is hidden: the server import route and saved data remain.
 const importRoute=read("app/(site)/api/customer-guest-import/route.ts");
 assert.match(importRoute,/mode==="preview"/);
});
