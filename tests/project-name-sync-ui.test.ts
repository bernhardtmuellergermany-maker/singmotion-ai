import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const load=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

test("generated projects save display-only names via owner-scoped server action",()=>{
 const route=load("app/(site)/api/studio-live/route.ts");
 const studio=load("lib/live/studio.ts");
 const gallery=load("components/my-projects-gallery.tsx");
 const header=load("components/project-header-name.tsx");
 assert.match(route,/body\.action === "rename"/);
 assert.match(route,/service\.renameProject\(body\.id,owner,String\(user!\.id\),body\.name\)/);
 assert.match(studio,/this\.row\(id,owner\)/);
 assert.match(studio,/UPDATE live_studio_projects SET display_name=\? WHERE attempt_id=\? AND owner=\?/);
 assert.match(gallery,/action:"rename",id,name:next/);
 assert.match(header,/action:"rename",id:id\.slice\(5\),name:value/);
 assert.match(gallery,/Old desktop versions kept generated-video titles in localStorage only/);
 assert.match(header,/if\(!p\.displayName&&oldLabel\.trim\(\)/);
});

test("customer titles are account-owned and do not mutate financial order rows",()=>{
 const route=load("app/(site)/api/customer-orders/route.ts");
 const gallery=load("components/my-projects-gallery.tsx");
 assert.match(route,/export async function PATCH/);
 assert.match(route,/req\.headers\.get\("origin"\)!==origin/);
 assert.match(route,/ownedCustomerOrderStatuses\(store\.db,accountId,/);
 assert.match(route,/customer_order_display_names/);
 assert.match(route,/ON CONFLICT\(order_id,account_id\) DO UPDATE/);
 assert.match(gallery,/method:"PATCH",credentials:"same-origin"/);
 assert.match(gallery,/name:o\.displayName\?\.trim\(\)/);
});
